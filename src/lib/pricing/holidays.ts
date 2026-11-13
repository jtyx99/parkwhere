import { sgtDateKey, sgtShift } from '../time';

// Singapore gazetted public holidays (Ministry of Manpower). Extend yearly.
const HOLIDAYS = new Set([
  // 2026
  '2026-01-01', '2026-02-17', '2026-02-18', '2026-03-21', '2026-04-03', '2026-05-01',
  '2026-05-27', '2026-05-31', '2026-08-09', '2026-11-08', '2026-12-25',
  // 2027 (Hari Raya dates are subject to confirmation)
  '2027-01-01', '2027-02-06', '2027-02-07', '2027-03-10', '2027-03-26', '2027-05-01',
  '2027-05-17', '2027-05-20', '2027-08-09', '2027-10-28', '2027-12-25',
]);

export const isPublicHoliday = (d: Date | number) => HOLIDAYS.has(sgtDateKey(d));
export const isSunday = (d: Date | number) => sgtShift(d).getUTCDay() === 0;
export const isSundayOrHoliday = (d: Date | number) => isSunday(d) || isPublicHoliday(d);
