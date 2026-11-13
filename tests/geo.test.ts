import { describe, expect, it } from 'vitest';
import { haversine, svy21ToWgs84 } from '../src/lib/geo';

describe('svy21ToWgs84', () => {
  it('matches OneMap for Tampines Mall', () => {
    const { lat, lng } = svy21ToWgs84(40395.36058725417, 37181.40528376773);
    expect(lat).toBeCloseTo(1.352527372785196, 7);
    expect(lng).toBeCloseTo(103.9446987510717, 7);
  });
  it('maps the projection origin to itself', () => {
    const { lat, lng } = svy21ToWgs84(28001.642, 38744.572);
    expect(lat).toBeCloseTo(1 + 22 / 60, 7);
    expect(lng).toBeCloseTo(103 + 50 / 60, 7);
  });
});

describe('haversine', () => {
  it('is zero for the same point', () => expect(haversine(1.3, 103.8, 1.3, 103.8)).toBe(0));
  it('measures about 111 m per 0.001 degree of latitude', () => {
    expect(haversine(1.3, 103.8, 1.301, 103.8)).toBeGreaterThan(110);
    expect(haversine(1.3, 103.8, 1.301, 103.8)).toBeLessThan(112);
  });
});
