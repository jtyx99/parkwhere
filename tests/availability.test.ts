import { describe, expect, it } from 'vitest';
import { fullness, historyTimes, resolveAvailability } from '../src/lib/availability';
import { parseAvailability } from '../src/sources/hdb';
import { DAY, MINUTE } from '../src/lib/time';
import type { Snapshot } from '../src/sources/types';

const now = +new Date('2026-11-13T10:00:00+08:00');
const snap = (timestamp: number, available: number, age = MINUTE): Snapshot => ({
  timestamp,
  byCode: new Map([
    ['A1', { updated: timestamp - age, lots: [{ lotType: 'C', available, total: 100 }, { lotType: 'Y', available: 4, total: 10 }] }],
  ]),
});
const history = [60, 40, 50, 30].map((v, i) => snap(now - (i + 1) * 7 * DAY, v));

describe('resolveAvailability', () => {
  it('uses live data when arriving now and the reading is fresh', () => {
    const a = resolveAvailability('A1', snap(now, 25), history, now, now);
    expect(a).toMatchObject({ status: 'live', available: 25, total: 100 });
  });
  it('predicts from history when arriving later', () => {
    const a = resolveAvailability('A1', snap(now, 25), history, now + 3 * 60 * MINUTE, now);
    expect(a).toMatchObject({ status: 'predicted', available: 45, range: [30, 60], samples: 4 });
    expect(a.lots.find((l) => l.lotType === 'Y')?.available).toBe(4);
  });
  it('falls back to prediction when the live reading is stale', () => {
    const a = resolveAvailability('A1', snap(now, 25, 3 * 60 * MINUTE), history, now, now);
    expect(a.status).toBe('predicted');
  });
  it('ignores history readings that were stale at the time', () => {
    const mixed = [snap(now - 7 * DAY, 80), snap(now - 14 * DAY, 10, 5 * 60 * MINUTE)];
    const a = resolveAvailability('A1', null, mixed, now, now);
    expect(a).toMatchObject({ status: 'predicted', available: 80, samples: 1 });
  });
  it('reports no data when there is neither live nor history', () => {
    expect(resolveAvailability('A1', null, [], now, now).status).toBe('none');
    expect(resolveAvailability('ZZ', snap(now, 25), history, now, now).status).toBe('none');
  });
});

describe('historyTimes', () => {
  it('returns the same time over the previous four weeks', () => {
    expect(historyTimes(now, now)).toEqual([1, 2, 3, 4].map((k) => now - k * 7 * DAY));
  });
  it('only returns past times for a far-future arrival', () => {
    const times = historyTimes(now + 10 * DAY, now);
    expect(times).toHaveLength(4);
    expect(times.every((t) => t < now)).toBe(true);
    expect(times[0]).toBe(now + 10 * DAY - 14 * DAY);
  });
});

describe('fullness', () => {
  const a = (available: number | null, total: number | null) =>
    fullness({ status: 'live', available, total, lots: [] });
  it('grades by share of lots free', () => {
    expect(a(50, 100)).toBe('good');
    expect(a(20, 100)).toBe('low');
    expect(a(5, 100)).toBe('full');
    expect(a(0, 100)).toBe('full');
    expect(a(null, 100)).toBe('unknown');
  });
});

describe('parseAvailability', () => {
  it('parses the data.gov.sg payload and keeps the newest duplicate', () => {
    const s = parseAvailability({
      items: [{
        timestamp: '2026-11-13T10:00:36+08:00',
        carpark_data: [
          { carpark_number: 'A1', update_datetime: '2026-11-13T09:59:00', carpark_info: [{ lot_type: 'C', lots_available: '12', total_lots: '80' }] },
          { carpark_number: 'A1', update_datetime: '2026-11-13T08:00:00', carpark_info: [{ lot_type: 'C', lots_available: '99', total_lots: '80' }] },
        ],
      }],
    })!;
    expect(s.byCode.get('A1')).toEqual({
      updated: +new Date('2026-11-13T09:59:00+08:00'),
      lots: [{ lotType: 'C', available: 12, total: 80 }],
    });
  });
});
