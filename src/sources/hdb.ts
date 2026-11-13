import { historyTimes } from '../lib/availability';
import { svy21ToWgs84 } from '../lib/geo';
import { quoteHdb } from '../lib/pricing/hdb';
import { MINUTE, parseSgt, toSgtApi } from '../lib/time';
import type { Carpark, CarparkReading, CarparkSource, Snapshot } from './types';

const AVAILABILITY_URL = 'https://api.data.gov.sg/v1/transport/carpark-availability';

interface RawCarpark {
  code: string;
  address: string;
  x: number;
  y: number;
  type: string;
  system: string;
  shortTerm: string;
  free: string;
  night: boolean;
  decks: number;
  gantry: number;
  basement: boolean;
}

interface RawAvailability {
  items: {
    timestamp: string;
    carpark_data: {
      carpark_number: string;
      update_datetime: string;
      carpark_info: { lot_type: string; lots_available: string; total_lots: string }[];
    }[];
  }[];
}

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bBlk\b/g, 'Blk');

export function parseAvailability(raw: RawAvailability): Snapshot | null {
  const item = raw.items?.[0];
  if (!item?.carpark_data) return null;
  const byCode = new Map<string, CarparkReading>();
  for (const c of item.carpark_data) {
    const updated = +(parseSgt(c.update_datetime) ?? 0);
    const prev = byCode.get(c.carpark_number);
    // The feed occasionally repeats a car park; keep the most recent entry.
    if (prev && prev.updated >= updated) continue;
    byCode.set(c.carpark_number, {
      updated,
      lots: c.carpark_info.map((l) => ({
        lotType: l.lot_type,
        available: Number(l.lots_available),
        total: Number(l.total_lots) || null,
      })),
    });
  }
  return { timestamp: +new Date(item.timestamp), byCode };
}

async function fetchSnapshot(at?: number): Promise<Snapshot | null> {
  const url = at ? `${AVAILABILITY_URL}?date_time=${encodeURIComponent(toSgtApi(at))}` : AVAILABILITY_URL;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Car park availability service responded ${res.status}`);
  return parseAvailability(await res.json());
}

// Past snapshots never change, so cache them by 15-minute bucket.
const BUCKET = 15 * MINUTE;
const historyCache = new Map<number, Promise<Snapshot | null>>();

export const hdbSource: CarparkSource = {
  id: 'hdb',
  label: 'HDB',

  async loadCarparks() {
    const res = await fetch(`${import.meta.env.BASE_URL}data/hdb-carparks.json`);
    if (!res.ok) throw new Error('Could not load the HDB car park list');
    const { carparks } = (await res.json()) as { carparks: RawCarpark[] };
    return carparks
      .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && r.x > 0 && r.y > 0)
      .map((r): Carpark => {
        const { lat, lng } = svy21ToWgs84(r.x, r.y);
        const address = titleCase(r.address);
        return {
          id: `hdb:${r.code}`,
          sourceId: 'hdb',
          code: r.code,
          name: address,
          address,
          agency: 'HDB',
          lat,
          lng,
          type: titleCase(r.type),
          parkingSystem: r.system,
          shortTermParking: r.shortTerm,
          freeParking: r.free,
          nightParking: r.night,
          decks: r.decks,
          gantryHeight: r.gantry,
          basement: r.basement,
        };
      });
  },

  async getLive() {
    const snap = await fetchSnapshot();
    if (!snap) throw new Error('Car park availability service returned no data');
    return snap;
  },

  async getHistory(at, now) {
    const times = historyTimes(+at, +now).map((t) => Math.round(t / BUCKET) * BUCKET);
    const results = await Promise.all(
      times.map((t) => {
        let p = historyCache.get(t);
        if (!p) {
          p = fetchSnapshot(t).catch(() => {
            historyCache.delete(t);
            return null;
          });
          historyCache.set(t, p);
        }
        return p;
      }),
    );
    return results.filter((s): s is Snapshot => s !== null);
  },

  quote: quoteHdb,
};
