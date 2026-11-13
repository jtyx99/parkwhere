// LTA DataMall source (malls, URA and LTA car parks). DataMall needs an account
// key and does not allow browser calls, so the app reads it one of two ways:
//   VITE_LTA_DATA_URL  static snapshots published by a scheduled job (10-30 min old)
//   VITE_API_BASE      the live proxy in /server
import { MINUTE, sgtShift } from '../lib/time';
import type { Carpark, CarparkReading, CarparkSource, Snapshot } from './types';

const trim = (s: string | undefined) => s?.replace(/\/+$/, '') || undefined;
const API_BASE = trim(import.meta.env.VITE_API_BASE);
const DATA_URL = trim(import.meta.env.VITE_LTA_DATA_URL);
export const ltaEnabled = !!(API_BASE || DATA_URL);

/** Slot length of the published history files (must match scripts/snapshot-lta.mjs). */
export const STATIC_SLOT_MINUTES = 30;
const PROXY_SLOT_MINUTES = 15;

interface LtaCarpark {
  code: string;
  name: string;
  area: string;
  agency: string;
  lat: number;
  lng: number;
  lots: { lotType: string; available: number }[];
  rateText?: string[];
}
export interface LtaLive {
  timestamp: number;
  carparks: LtaCarpark[];
}
/** code -> lot type -> [sum of lots available, number of samples] */
export type LtaHistoryTotals = Record<string, Record<string, [number, number]>>;

export function slotOf(at: Date | number, slotMinutes: number): { dow: number; slot: number } {
  const s = sgtShift(at);
  return {
    dow: s.getUTCDay(),
    slot: Math.floor((s.getUTCHours() * 60 + s.getUTCMinutes()) / slotMinutes),
  };
}

export function liveToSnapshot(live: LtaLive): Snapshot {
  const byCode = new Map<string, CarparkReading>();
  for (const c of live.carparks) {
    byCode.set(c.code, {
      updated: live.timestamp,
      lots: c.lots.map((l) => ({ ...l, total: null })),
    });
  }
  return { timestamp: live.timestamp, byCode };
}

/** Turn mean lots per car park into a snapshot dated `at`. */
export function meansToSnapshot(means: Record<string, Record<string, number>>, at: number): Snapshot {
  const byCode = new Map<string, CarparkReading>();
  for (const [code, types] of Object.entries(means)) {
    byCode.set(code, {
      updated: at,
      lots: Object.entries(types).map(([lotType, mean]) => ({
        lotType,
        available: Math.round(mean),
        total: null,
      })),
    });
  }
  return { timestamp: at, byCode };
}

export function totalsToMeans(totals: LtaHistoryTotals): Record<string, Record<string, number>> {
  const means: Record<string, Record<string, number>> = {};
  for (const [code, types] of Object.entries(totals)) {
    means[code] = {};
    for (const [type, [sum, n]] of Object.entries(types)) if (n > 0) means[code][type] = sum / n;
  }
  return means;
}

const EMPTY: LtaLive = { timestamp: 0, carparks: [] };
let cached: { at: number; ttl: number; value: Promise<LtaLive> } | null = null;

/** Latest data, or an empty set when none has been published yet. */
function getLiveData(): Promise<LtaLive> {
  if (cached && Date.now() - cached.at < cached.ttl) return cached.value;
  const url = API_BASE ? `${API_BASE}/api/lta/carparks` : `${DATA_URL}/lta-live.json`;
  const entry = {
    at: Date.now(),
    ttl: 45_000,
    value: fetch(url).then(
      (r) => {
        if (r.ok) return r.json() as Promise<LtaLive>;
        // No snapshot yet (key not configured): look again in a while.
        entry.ttl = 10 * MINUTE;
        return EMPTY;
      },
      () => {
        entry.ttl = 2 * MINUTE;
        return EMPTY;
      },
    ),
  };
  cached = entry;
  return entry.value;
}

export const ltaSource: CarparkSource = {
  id: 'lta',
  label: 'LTA DataMall',

  async loadCarparks() {
    const live = await getLiveData();
    return live.carparks.map(
      (c): Carpark => ({
        id: `lta:${c.code}`,
        sourceId: 'lta',
        code: c.code,
        name: c.name,
        address: c.area ? `${c.name}, ${c.area}` : c.name,
        agency: c.agency,
        lat: c.lat,
        lng: c.lng,
        rateText: c.rateText,
      }),
    );
  },

  async getLive() {
    return liveToSnapshot(await getLiveData());
  },

  async getHistory(at) {
    try {
      let means: Record<string, Record<string, number>>;
      if (API_BASE) {
        const { dow, slot } = slotOf(at, PROXY_SLOT_MINUTES);
        const res = await fetch(`${API_BASE}/api/lta/history?dow=${dow}&bucket=${slot}`);
        if (!res.ok) return [];
        means = ((await res.json()) as { means: typeof means }).means;
      } else {
        const { dow, slot } = slotOf(at, STATIC_SLOT_MINUTES);
        const res = await fetch(`${DATA_URL}/history/${dow}-${slot}.json`);
        if (!res.ok) return [];
        means = totalsToMeans((await res.json()) as LtaHistoryTotals);
      }
      const snap = meansToSnapshot(means, +at);
      return snap.byCode.size ? [snap] : [];
    } catch {
      return [];
    }
  },

  quote(cp) {
    return {
      total: null,
      rateLabel: cp.rateText?.length ? cp.rateText[0] : 'Rates not published for this car park',
      lines: [],
      notes: cp.rateText?.length
        ? [...cp.rateText.slice(1), 'Operator rates are published as text, so no total is calculated.']
        : ['Check the rates on site.'],
    };
  },
};
