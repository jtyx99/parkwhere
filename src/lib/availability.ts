import type { Availability, CarparkReading, LotCount, Snapshot } from '../sources/types';
import { DAY, MINUTE } from './time';

/** Live data is used when arriving within this window. */
export const LIVE_HORIZON_MS = 30 * MINUTE;
/** A reading older than this is treated as not live. */
export const STALE_MS = 30 * MINUTE;
export const HISTORY_WEEKS = 4;

const carLots = (lots: LotCount[]) => lots.find((l) => l.lotType === 'C') ?? lots[0];

export function isFresh(reading: CarparkReading | undefined, at: number): reading is CarparkReading {
  return !!reading && at - reading.updated <= STALE_MS && carLots(reading.lots) !== undefined;
}

export const wantsLive = (arrival: number, now: number) => arrival - now <= LIVE_HORIZON_MS;

/** The same weekday and time over previous weeks, most recent first, all in the past. */
export function historyTimes(arrival: number, now: number, weeks = HISTORY_WEEKS): number[] {
  const out: number[] = [];
  for (let k = 1; out.length < weeks && k < 60; k++) {
    const t = arrival - k * 7 * DAY;
    if (t < now - 5 * MINUTE) out.push(t);
  }
  return out;
}

/**
 * Decide what to show for one car park:
 *  live      - arriving soon and the live reading is fresh
 *  predicted - average of comparable past snapshots
 *  none      - nothing usable
 */
export function resolveAvailability(
  code: string,
  live: Snapshot | null,
  history: Snapshot[],
  arrival: number,
  now: number,
): Availability {
  const liveReading = live?.byCode.get(code);

  if (wantsLive(arrival, now) && isFresh(liveReading, now)) {
    const car = carLots(liveReading.lots);
    return {
      status: 'live',
      available: car.available,
      total: car.total,
      lots: liveReading.lots,
      levels: liveReading.levels,
      updated: liveReading.updated,
    };
  }

  // Predict from past snapshots, ignoring readings that were stale at the time.
  const byType = new Map<string, { sum: number; n: number; total: number | null }>();
  const carValues: number[] = [];
  for (const snap of history) {
    const r = snap.byCode.get(code);
    if (!isFresh(r, snap.timestamp)) continue;
    carValues.push(carLots(r.lots).available);
    for (const l of r.lots) {
      const e = byType.get(l.lotType) ?? { sum: 0, n: 0, total: l.total };
      e.sum += l.available;
      e.n++;
      e.total = l.total ?? e.total;
      byType.set(l.lotType, e);
    }
  }

  if (carValues.length > 0) {
    const lots: LotCount[] = [...byType].map(([lotType, e]) => ({
      lotType,
      available: Math.round(e.sum / e.n),
      total: e.total,
    }));
    const car = carLots(lots);
    return {
      status: 'predicted',
      available: car.available,
      total: car.total,
      lots,
      range: [Math.min(...carValues), Math.max(...carValues)],
      samples: carValues.length,
    };
  }

  const lastKnown = liveReading && carLots(liveReading.lots);
  return {
    status: 'none',
    available: null,
    total: lastKnown?.total ?? null,
    lots: [],
    updated: liveReading?.updated,
  };
}

export type Level = 'good' | 'low' | 'full' | 'unknown';

export function fullness(a: Availability): Level {
  if (a.available === null) return 'unknown';
  if (a.available <= 0) return 'full';
  if (a.total && a.total > 0) {
    const ratio = a.available / a.total;
    if (ratio < 0.1 || a.available <= 5) return 'full';
    return ratio < 0.3 ? 'low' : 'good';
  }
  return a.available <= 5 ? 'full' : a.available <= 20 ? 'low' : 'good';
}
