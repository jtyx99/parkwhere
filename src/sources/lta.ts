// LTA DataMall source (malls, URA and LTA car parks). DataMall needs an account
// key and does not allow browser calls, so this talks to the proxy in /server.
// It is enabled only when VITE_API_BASE is set at build time.
import { sgtShift } from '../lib/time';
import type { Carpark, CarparkReading, CarparkSource, Snapshot } from './types';

export const LTA_API_BASE: string | undefined = import.meta.env.VITE_API_BASE || undefined;

interface ProxyCarpark {
  code: string;
  name: string;
  area: string;
  agency: string;
  lat: number;
  lng: number;
  lots: { lotType: string; available: number }[];
  rateText?: string[];
}
interface ProxyLive {
  timestamp: number;
  carparks: ProxyCarpark[];
}
interface ProxyHistory {
  /** code -> lot type -> mean lots available in this weekday/time bucket */
  means: Record<string, Record<string, number>>;
}

let livePromise: Promise<ProxyLive> | null = null;
let liveAt = 0;

async function getProxyLive(): Promise<ProxyLive> {
  if (!livePromise || Date.now() - liveAt > 30_000) {
    liveAt = Date.now();
    livePromise = fetch(`${LTA_API_BASE}/api/lta/carparks`).then((r) => {
      if (!r.ok) throw new Error(`LTA proxy responded ${r.status}`);
      return r.json();
    });
    livePromise.catch(() => (livePromise = null));
  }
  return livePromise;
}

export const ltaSource: CarparkSource = {
  id: 'lta',
  label: 'LTA DataMall',

  async loadCarparks() {
    const live = await getProxyLive();
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
    const live = await getProxyLive();
    const byCode = new Map<string, CarparkReading>();
    for (const c of live.carparks) {
      byCode.set(c.code, {
        updated: live.timestamp,
        lots: c.lots.map((l) => ({ ...l, total: null })),
      });
    }
    return { timestamp: live.timestamp, byCode };
  },

  async getHistory(at) {
    const s = sgtShift(at);
    const bucket = Math.floor((s.getUTCHours() * 60 + s.getUTCMinutes()) / 15);
    const res = await fetch(`${LTA_API_BASE}/api/lta/history?dow=${s.getUTCDay()}&bucket=${bucket}`);
    if (!res.ok) return [];
    const { means } = (await res.json()) as ProxyHistory;
    const timestamp = +at;
    const byCode = new Map<string, CarparkReading>();
    for (const [code, types] of Object.entries(means)) {
      byCode.set(code, {
        updated: timestamp,
        lots: Object.entries(types).map(([lotType, mean]) => ({
          lotType,
          available: Math.round(mean),
          total: null,
        })),
      });
    }
    const snap: Snapshot = { timestamp, byCode };
    return byCode.size ? [snap] : [];
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
