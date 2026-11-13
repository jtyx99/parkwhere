// Shared LTA DataMall access, used by the live proxy (server/index.mjs) and the
// scheduled snapshot job (scripts/snapshot-lta.mjs).
export const DEFAULT_UPSTREAM =
  'https://datamall2.mytransport.sg/ltaodataservice/CarParkAvailabilityv2';
export const DEFAULT_RATES_URL =
  'https://data.gov.sg/api/action/datastore_search?resource_id=d_9f6056bdb6b1dfba57f063593e4f34ae&limit=1000';

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** name -> published rate lines, from the data.gov.sg "Carpark Rates" dataset. */
export async function loadRates(url = DEFAULT_RATES_URL) {
  try {
    const res = await fetch(url);
    const { result } = await res.json();
    return new Map(
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
  } catch (e) {
    console.warn('Could not load published rates:', e.message);
    return new Map();
  }
}

/** Current lots for every non-HDB car park in the DataMall feed. */
export async function fetchCarparks({ key, upstream = DEFAULT_UPSTREAM, rates = new Map() }) {
  const rows = [];
  for (let skip = 0; ; skip += 500) {
    const res = await fetch(`${upstream}?$skip=${skip}`, {
      headers: { AccountKey: key, accept: 'application/json' },
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
        code: String(r.CarParkID),
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

/** Weekday (0 = Sunday) and slot index in Singapore time. */
export function slotOf(ms, slotMinutes) {
  const sgt = new Date(ms + 8 * 3600_000);
  return {
    dow: sgt.getUTCDay(),
    slot: Math.floor((sgt.getUTCHours() * 60 + sgt.getUTCMinutes()) / slotMinutes),
  };
}

/** Add one snapshot to a history slot: slot[code][lotType] = [sum, samples]. */
export function accumulate(slot, snapshot) {
  for (const cp of snapshot.carparks) {
    const entry = (slot[cp.code] ??= {});
    for (const l of cp.lots) {
      const e = (entry[l.lotType] ??= [0, 0]);
      e[0] += l.available;
      e[1] += 1;
    }
  }
  return slot;
}
