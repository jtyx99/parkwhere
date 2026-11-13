import { describe, expect, it } from 'vitest';
import { quoteHdb } from '../src/lib/pricing/hdb';
import { parseSgt } from '../src/lib/time';
import type { Carpark } from '../src/sources/types';

const base: Carpark = {
  id: 'hdb:XX1', sourceId: 'hdb', code: 'XX1', name: 'Test', address: 'Test', agency: 'HDB',
  lat: 1.3, lng: 103.8, parkingSystem: 'ELECTRONIC PARKING', shortTermParking: 'WHOLE DAY',
  freeParking: 'NO', nightParking: true,
};
const t = (s: string) => parseSgt(s)!;
const total = (cp: Carpark, a: string, d: string) => quoteHdb(cp, t(a), t(d)).total;

// 2026-11-11 is a Wednesday, 2026-11-15 a Sunday, 2026-12-25 a public holiday (Friday).
describe('quoteHdb', () => {
  it('charges $1.20 an hour outside the Central Area', () => {
    expect(total(base, '2026-11-11T10:00', '2026-11-11T12:00')).toBe(2.4);
  });
  it('charges per minute', () => {
    expect(total(base, '2026-11-11T10:00', '2026-11-11T10:45')).toBe(0.9);
  });
  it('doubles the rate in the Central Area until 5pm, Mon-Sat', () => {
    const central = { ...base, code: 'ACB' };
    expect(total(central, '2026-11-11T10:00', '2026-11-11T12:00')).toBe(4.8);
    // 4-5pm at $2.40/h, 5-6pm at $1.20/h
    expect(total(central, '2026-11-11T16:00', '2026-11-11T18:00')).toBe(3.6);
    // Sunday: standard rate all day
    expect(total(central, '2026-11-15T10:00', '2026-11-15T12:00')).toBe(2.4);
  });
  it('is free on Sundays and public holidays under the free parking scheme', () => {
    const free = { ...base, freeParking: 'SUN & PH FR 7AM-10.30PM' };
    expect(total(free, '2026-11-15T10:00', '2026-11-15T12:00')).toBe(0);
    expect(total(free, '2026-12-25T10:00', '2026-12-25T12:00')).toBe(0);
    expect(total(free, '2026-11-11T10:00', '2026-11-11T12:00')).toBe(2.4);
    const afternoon = { ...base, freeParking: 'SUN & PH FR 1PM-10.30PM' };
    expect(total(afternoon, '2026-11-15T12:00', '2026-11-15T14:00')).toBe(1.2);
  });
  it('caps night parking at $5', () => {
    // 10:30pm-7am = 8.5 h = $10.20 uncapped
    expect(total(base, '2026-11-11T22:30', '2026-11-12T07:00')).toBe(5);
    // 9:30-10:30pm ($1.20) + capped night ($5) + 7-8am ($1.20)
    expect(total(base, '2026-11-11T21:30', '2026-11-12T08:00')).toBe(7.4);
    // no night scheme: no cap
    expect(total({ ...base, nightParking: false }, '2026-11-11T22:30', '2026-11-12T07:00')).toBe(10.2);
  });
  it('caps day parking at $12 ($20 in the Central Area)', () => {
    // 7am-10:30pm = 15.5 h = $18.60 uncapped
    expect(total(base, '2026-11-11T07:00', '2026-11-11T22:30')).toBe(12);
    expect(total({ ...base, code: 'ACB' }, '2026-11-11T07:00', '2026-11-11T22:30')).toBe(20);
  });
  it('handles multi-day stays', () => {
    // Wed 9am -> Fri 9am: day1 9am-10:30pm capped 12, night 5, day2 capped 12, night 5, day3 7-9am 2.40
    expect(total(base, '2026-11-11T09:00', '2026-11-13T09:00')).toBe(36.4);
  });
  it('returns no total where short-term parking is not allowed', () => {
    const q = quoteHdb({ ...base, shortTermParking: 'NO' }, t('2026-11-11T10:00'), t('2026-11-11T12:00'));
    expect(q.total).toBeNull();
  });
  it('warns when the stay runs outside short-term hours', () => {
    const q = quoteHdb({ ...base, shortTermParking: '7AM-7PM' }, t('2026-11-11T18:00'), t('2026-11-11T20:00'));
    expect(q.notes.join(' ')).toMatch(/falls outside/);
  });
  it('returns no total for an empty or reversed stay', () => {
    expect(total(base, '2026-11-11T12:00', '2026-11-11T10:00')).toBeNull();
  });
  it('breaks the total into lines that add up', () => {
    const q = quoteHdb(base, t('2026-11-11T21:30'), t('2026-11-12T08:00'));
    expect(q.lines.reduce((a, l) => a + l.amount, 0)).toBeCloseTo(q.total!, 2);
    expect(q.lines.reduce((a, l) => a + l.minutes, 0)).toBe(630);
  });
});
