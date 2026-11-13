import type { Carpark, Quote, QuoteLine } from '../../sources/types';
import { MINUTE, sgtDateKey, sgtShift } from '../time';
import { isSundayOrHoliday } from './holidays';

// HDB short-term parking rules for cars, per hdb.gov.sg (charged per minute at
// electronic car parks):
//  - $0.60 per half hour
//  - Central Area car parks: $1.20 per half hour, Mon-Sat 7am-5pm
//  - Night parking (10:30pm-7am) capped at $5 per night where offered
//  - Day parking (7am-10:30pm) capped at $12 per day ($20 in the Central Area)
//  - Free parking on Sundays and public holidays at car parks under the scheme
export const HDB_RATE = 0.6;
export const HDB_CENTRAL_RATE = 1.2;
export const NIGHT_CAP = 5;
export const DAY_CAP = 12;
export const DAY_CAP_CENTRAL = 20;

/** HDB car parks within the Central Area (higher daytime rate). */
export const CENTRAL_AREA = new Set([
  'ACB', 'BBB', 'BRB1', 'CY', 'DUXM', 'HLM', 'KAB', 'KAM', 'KAS', 'PRM', 'SLS', 'SR1', 'SR2',
  'TPM', 'UCS', 'WCB',
]);

const DAY_START = 7 * 60;
const NIGHT_START = 22 * 60 + 30;
const CENTRAL_PEAK_END = 17 * 60;
const MAX_STAY_MIN = 31 * 24 * 60;

const LABEL = {
  standard: 'Standard rate ($0.60 / 30 min)',
  central: 'Central Area rate ($1.20 / 30 min)',
  night: 'Night parking (10:30pm-7am)',
  free: 'Free parking (Sun / public holiday)',
} as const;
type Band = keyof typeof LABEL;

function freeWindow(freeParking: string | undefined): [number, number] | null {
  if (!freeParking || freeParking === 'NO') return null;
  if (freeParking.includes('1PM')) return [13 * 60, NIGHT_START];
  return [DAY_START, NIGHT_START];
}

function shortTermWindow(s: string | undefined): [number, number] | 'all' | 'none' {
  if (s === 'NO') return 'none';
  if (s === '7AM-7PM') return [DAY_START, 19 * 60];
  if (s === '7AM-10.30PM') return [DAY_START, NIGHT_START];
  return 'all';
}

export function isCentral(cp: Pick<Carpark, 'code'>): boolean {
  return CENTRAL_AREA.has(cp.code);
}

export function hdbRateLabel(cp: Carpark): string {
  return isCentral(cp)
    ? '$1.20 / 30 min (Mon-Sat 7am-5pm), $0.60 / 30 min other times'
    : '$0.60 / 30 min ($1.20 / hour)';
}

export function quoteHdb(cp: Carpark, arrive: Date, depart: Date): Quote {
  const central = isCentral(cp);
  const notes: string[] = [];
  const rateLabel = hdbRateLabel(cp);
  const free = freeWindow(cp.freeParking);
  const stWindow = shortTermWindow(cp.shortTermParking);

  if (cp.parkingSystem === 'COUPON PARKING') {
    notes.push('Coupon parking: charged per half-hour coupon, so the actual cost rounds up.');
  }
  if (free) {
    notes.push(
      `Free on Sundays and public holidays, ${free[0] === 13 * 60 ? '1pm' : '7am'}-10:30pm.`,
    );
  }
  if (cp.nightParking) notes.push('Night parking (10:30pm-7am) is capped at $5.');
  else notes.push('No night parking for visitors (10:30pm-7am).');

  if (stWindow === 'none') {
    return {
      total: null,
      rateLabel: 'Season parking only',
      lines: [],
      notes: ['No short-term parking here: season ticket holders only.'],
    };
  }

  const totalMin = Math.round((+depart - +arrive) / MINUTE);
  if (!(totalMin > 0)) return { total: null, rateLabel, lines: [], notes };
  if (totalMin > MAX_STAY_MIN) {
    notes.unshift('Stay is longer than 31 days; total not calculated.');
    return { total: null, rateLabel, lines: [], notes };
  }

  // Walk the stay minute by minute, grouping charges into capped sessions.
  const bands: Record<Band, { minutes: number; amount: number }> = {
    standard: { minutes: 0, amount: 0 },
    central: { minutes: 0, amount: 0 },
    night: { minutes: 0, amount: 0 },
    free: { minutes: 0, amount: 0 },
  };
  // session key -> charge per band, so each day/night cap applies on its own.
  const sessions = new Map<string, { cap: number; parts: Partial<Record<Band, number>> }>();
  let outsideShortTerm = false;
  let nightWithoutScheme = false;

  for (let i = 0; i < totalMin; i++) {
    const t = +arrive + i * MINUTE;
    const s = sgtShift(t);
    const m = s.getUTCHours() * 60 + s.getUTCMinutes();
    const isNight = m >= NIGHT_START || m < DAY_START;
    const sunPh = isSundayOrHoliday(t);

    if (stWindow !== 'all' && (m < stWindow[0] || m >= stWindow[1])) outsideShortTerm = true;

    let band: Band;
    let perMin = HDB_RATE / 30;
    if (!isNight && free && sunPh && m >= free[0] && m < free[1]) {
      band = 'free';
      perMin = 0;
    } else if (isNight) {
      band = 'night';
      if (!cp.nightParking) nightWithoutScheme = true;
    } else if (central && !sunPh && m < CENTRAL_PEAK_END) {
      band = 'central';
      perMin = HDB_CENTRAL_RATE / 30;
    } else {
      band = 'standard';
    }
    bands[band].minutes++;
    if (perMin === 0) continue;

    // A night session belongs to the date it started on.
    const key = isNight
      ? `N${sgtDateKey(m < DAY_START ? t - DAY_START * MINUTE : t)}`
      : `D${sgtDateKey(t)}`;
    let session = sessions.get(key);
    if (!session) {
      const cap = isNight
        ? cp.nightParking
          ? NIGHT_CAP
          : Infinity
        : central
          ? DAY_CAP_CENTRAL
          : DAY_CAP;
      session = { cap, parts: {} };
      sessions.set(key, session);
    }
    session.parts[band] = (session.parts[band] ?? 0) + perMin;
  }

  let capped = false;
  for (const { cap, parts } of sessions.values()) {
    const sum = Object.values(parts).reduce((a, b) => a + b, 0);
    const scale = sum > cap ? cap / sum : 1;
    if (scale < 1) capped = true;
    for (const [band, amount] of Object.entries(parts)) bands[band as Band].amount += amount * scale;
  }

  const lines: QuoteLine[] = (Object.keys(bands) as Band[])
    .filter((b) => bands[b].minutes > 0)
    .map((b) => ({
      label: LABEL[b],
      minutes: bands[b].minutes,
      amount: Math.round(bands[b].amount * 100) / 100,
    }));
  const total = Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;

  if (capped) notes.unshift('A daily or nightly cap was applied.');
  if (outsideShortTerm) {
    notes.unshift(
      `Short-term parking is only allowed ${cp.shortTermParking!.replace('.', ':').toLowerCase()}; part of your stay falls outside it.`,
    );
  }
  if (nightWithoutScheme) {
    notes.unshift('Part of your stay is overnight, which this car park does not offer to visitors.');
  }
  return { total, rateLabel, lines, notes };
}
