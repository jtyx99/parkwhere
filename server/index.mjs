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
import { DEFAULT_RATES_URL, DEFAULT_UPSTREAM, accumulate, fetchCarparks, loadRates, slotOf } from './lta.mjs';

const KEY = process.env.LTA_ACCOUNT_KEY;
const PORT = Number(process.env.PORT ?? 8787);
const ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';
const UPSTREAM = process.env.LTA_BASE_URL ?? DEFAULT_UPSTREAM;
const RATES_URL = process.env.RATES_URL ?? DEFAULT_RATES_URL;
const HISTORY_FILE = process.env.HISTORY_FILE ?? 'server/data/lta-history.json';
const LIVE_TTL = 60_000;
const SAMPLE_EVERY = 5 * 60_000;

if (!KEY) {
  console.error('Set LTA_ACCOUNT_KEY (free from https://datamall.lta.gov.sg) to run the LTA proxy.');
  process.exit(1);
}

let rates = new Map();
let live = null;
let livePromise = null;
function getLive() {
  if (live && Date.now() - live.timestamp < LIVE_TTL) return Promise.resolve(live);
  livePromise ??= fetchCarparks({ key: KEY, upstream: UPSTREAM, rates })
    .then((v) => (live = v))
    .finally(() => (livePromise = null));
  return livePromise;
}

// history["dow:bucket"][code][lotType] = [sum, samples], in 15-minute buckets
let history = {};
try {
  history = JSON.parse(await readFile(HISTORY_FILE, 'utf8'));
} catch {
  /* first run */
}

async function sample() {
  try {
    const snap = await getLive();
    const { dow, slot } = slotOf(snap.timestamp, 15);
    accumulate((history[`${dow}:${slot}`] ??= {}), snap);
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

rates = await loadRates(RATES_URL);
console.log(`Loaded published rates for ${rates.size} car parks`);
await sample();
setInterval(sample, SAMPLE_EVERY).unref?.();
