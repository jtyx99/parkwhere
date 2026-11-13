// Optional proxy for LTA DataMall car park availability (malls, URA and LTA car parks).
// DataMall needs an account key and blocks browser calls, so the key stays here.
//
//   LTA_ACCOUNT_KEY=... node server/index.mjs
//
// Endpoints:
//   GET /api/lta/carparks                  live lots (cached 60 s)
//   GET /api/lta/history?dow=0-6&bucket=0-95   mean lots for a weekday / 15-minute slot
//
// DataMall has no history endpoint, so this process samples the feed every
// 5 minutes and keeps running means on disk; predictions improve as it runs.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const KEY = process.env.LTA_ACCOUNT_KEY;
const PORT = Number(process.env.PORT ?? 8787);
const ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';
const UPSTREAM =
  process.env.LTA_BASE_URL ?? 'https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2';
const RATES_URL =
  process.env.RATES_URL ??
  'https://data.gov.sg/api/action/datastore_search?resource_id=d_9f6056bdb6b1dfba57f063593e4f34ae&limit=1000';
const HISTORY_FILE = process.env.HISTORY_FILE ?? 'server/data/lta-history.json';
const LIVE_TTL = 60_000;
const SAMPLE_EVERY = 5 * 60_000;

if (!KEY) {
  console.error('Set LTA_ACCOUNT_KEY (free from https://datamall.lta.gov.sg) to run the LTA proxy.');
  process.exit(1);
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** name -> published rate lines, from the data.gov.sg "Carpark Rates" dataset */
let rates = new Map();
async function loadRates() {
  try {
    const res = await fetch(RATES_URL);
    const { result } = await res.json();
    rates = new Map(
      result.records.map((r) => {
        const lines = [];
        const add = (label, v) => v && v !== '-' && lines.push(`${label}: ${v}`);
        add('Weekdays', r.weekdays_rate_1);
        if (r.weekdays_rate_2 !== r.weekdays_rate_1) add('Weekdays (later)', r.weekdays_rate_2);
        add('Saturday', r.saturday_rate);
        add('Sunday / PH', r.sunday_publicholiday_rate);
        return [norm(r.carpark), lines];
      }),
    );
    console.log(`Loaded published rates for ${rates.size} car parks`);
  } catch (e) {
    console.warn('Could not load published rates:', e.message);
  }
}

async function fetchUpstream() {
  const rows = [];
  for (let skip = 0; ; skip += 500) {
    const res = await fetch(`${UPSTREAM}?$skip=${skip}`, {
      headers: { AccountKey: KEY, accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`DataMall responded ${res.status}`);
    const { value } = await res.json();
    rows.push(...value);
    if (value.length < 500) break;
  }
  // One entry per car park; HDB car parks come from data.gov.sg in the app already.
  const byId = new Map();
  for (const r of rows) {
    if (r.Agency === 'HDB') continue;
    const [lat, lng] = String(r.Location).trim().split(/\s+/).map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    let cp = byId.get(r.CarParkID);
    if (!cp) {
      const rateText = rates.get(norm(r.Development));
      cp = {
        code: r.CarParkID,
        name: r.Development,
        area: r.Area ?? '',
        agency: r.Agency,
        lat,
        lng,
        lots: [],
        ...(rateText?.length ? { rateText } : {}),
      };
      byId.set(r.CarParkID, cp);
    }
    cp.lots.push({ lotType: r.LotType, available: Number(r.AvailableLots) });
  }
  return { timestamp: Date.now(), carparks: [...byId.values()] };
}

let live = null;
let livePromise = null;
function getLive() {
  if (live && Date.now() - live.timestamp < LIVE_TTL) return Promise.resolve(live);
  livePromise ??= fetchUpstream()
    .then((v) => (live = v))
    .finally(() => (livePromise = null));
  return livePromise;
}

// history["dow:bucket"][code][lotType] = [sum, samples]
let history = {};
try {
  history = JSON.parse(await readFile(HISTORY_FILE, 'utf8'));
} catch {
  /* first run */
}

const slotOf = (ms) => {
  const sgt = new Date(ms + 8 * 3600_000);
  return `${sgt.getUTCDay()}:${Math.floor((sgt.getUTCHours() * 60 + sgt.getUTCMinutes()) / 15)}`;
};

async function sample() {
  try {
    const snap = await getLive();
    const slot = (history[slotOf(snap.timestamp)] ??= {});
    for (const cp of snap.carparks) {
      const entry = (slot[cp.code] ??= {});
      for (const l of cp.lots) {
        const e = (entry[l.lotType] ??= [0, 0]);
        e[0] += l.available;
        e[1] += 1;
      }
    }
    await mkdir(dirname(HISTORY_FILE), { recursive: true });
    await writeFile(HISTORY_FILE, JSON.stringify(history));
  } catch (e) {
    console.warn('Sampling failed:', e.message);
  }
}

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': ORIGIN,
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });
  try {
    if (url.pathname === '/api/lta/carparks') return send(res, 200, await getLive());
    if (url.pathname === '/api/lta/history') {
      const dow = Number(url.searchParams.get('dow'));
      const bucket = Number(url.searchParams.get('bucket'));
      if (!(dow >= 0 && dow <= 6 && bucket >= 0 && bucket <= 95)) {
        return send(res, 400, { error: 'dow must be 0-6 and bucket 0-95' });
      }
      const means = {};
      for (const [code, types] of Object.entries(history[`${dow}:${bucket}`] ?? {})) {
        means[code] = Object.fromEntries(Object.entries(types).map(([t, [sum, n]]) => [t, sum / n]));
      }
      return send(res, 200, { means });
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    send(res, 502, { error: e.message });
  }
}).listen(PORT, () => console.log(`LTA proxy listening on http://localhost:${PORT}`));

await loadRates();
await sample();
setInterval(sample, SAMPLE_EVERY).unref?.();
