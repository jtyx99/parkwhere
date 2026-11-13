import { describe, expect, it } from 'vitest';
import { resolveAvailability } from '../src/lib/availability';
import { liveToSnapshot, meansToSnapshot, slotOf, totalsToMeans } from '../src/sources/lta';
import { statusText } from '../src/model';
// @ts-expect-error plain JS module shared with the snapshot job
import { accumulate, slotOf as jobSlotOf } from '../server/lta.mjs';

const at = +new Date('2026-11-13T10:40:00+08:00'); // a Friday

describe('LTA snapshots', () => {
  it('maps a time to the same weekday/slot as the snapshot job', () => {
    expect(slotOf(at, 30)).toEqual({ dow: 5, slot: 21 });
    expect(jobSlotOf(at, 30)).toEqual(slotOf(at, 30));
    expect(slotOf(+new Date('2026-11-13T23:59:00+08:00'), 30)).toEqual({ dow: 5, slot: 47 });
    expect(slotOf(+new Date('2026-11-14T00:00:00+08:00'), 30)).toEqual({ dow: 6, slot: 0 });
  });

  it('accumulates samples and averages them', () => {
    const snap = (n: number) => ({ carparks: [{ code: '1', lots: [{ lotType: 'C', available: n }] }] });
    const totals = accumulate(accumulate({}, snap(100)), snap(50));
    expect(totals).toEqual({ '1': { C: [150, 2] } });
    expect(totalsToMeans(totals)).toEqual({ '1': { C: 75 } });
  });

  it('shows a recent snapshot as live with its age, and an old one as predicted', () => {
    const live = liveToSnapshot({
      timestamp: at - 12 * 60_000,
      carparks: [{ code: '1', name: 'Mall', area: '', agency: 'LTA', lat: 1.3, lng: 103.8, lots: [{ lotType: 'C', available: 80 }] }],
    });
    const history = [meansToSnapshot({ '1': { C: 75 } }, at)];
    const fresh = resolveAvailability('1', live, history, at, at);
    expect(fresh).toMatchObject({ status: 'live', available: 80, total: null });
    expect(statusText(fresh, false, at)).toBe('12 min ago');

    const later = at + 40 * 60_000; // snapshot is now 52 minutes old
    expect(resolveAvailability('1', live, history, later, later)).toMatchObject({
      status: 'predicted',
      available: 75,
    });
  });
});
