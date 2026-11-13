import type { Availability, Carpark, Quote } from './sources/types';

/** One car park as shown for the current search. */
export interface CarparkItem {
  carpark: Carpark;
  /** Straight-line metres from the searched location. */
  distance: number;
  availability: Availability;
  quote: Quote;
}

export type SortMode = 'distance' | 'price' | 'lots';

export const RADIUS_OPTIONS = [100, 200, 500, 1000];

export const LOT_TYPE_LABEL: Record<string, string> = {
  C: 'Cars',
  Y: 'Motorcycles',
  H: 'Heavy vehicles',
};

export function lotsLabel(a: Availability, pending: boolean): { value: string; caption: string } {
  if (a.available === null) {
    return pending ? { value: '…', caption: 'checking' } : { value: '–', caption: 'no data' };
  }
  return a.status === 'predicted'
    ? { value: `~${a.available}`, caption: 'lots expected' }
    : { value: String(a.available), caption: a.available === 1 ? 'lot left' : 'lots left' };
}
