// Scheduled snapshot of LTA DataMall car park availability (malls, URA, LTA),
// for hosting without a server. Writes into the directory given as an argument:
//   lta-live.json               current lots
//   history/<dow>-<slot>.json   running totals per weekday and 30-minute slot
// Run by .github/workflows/lta-snapshot.yml with the key from an Actions secret.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { accumulate, fetchCarparks, loadRates, slotOf } from '../server/lta.mjs';

export const SLOT_MINUTES = 30;

const key = process.env.LTA_ACCOUNT_KEY;
const out = process.argv[2];
if (!key || !out) {
  console.error('Usage: LTA_ACCOUNT_KEY=... node scripts/snapshot-lta.mjs <output-dir>');
  process.exit(1);
}

const rates = await loadRates(process.env.RATES_URL);
const snapshot = await fetchCarparks({ key, upstream: process.env.LTA_BASE_URL, rates });
if (snapshot.carparks.length === 0) throw new Error('DataMall returned no car parks');

await mkdir(join(out, 'history'), { recursive: true });
await writeFile(join(out, 'lta-live.json'), JSON.stringify(snapshot));

const { dow, slot } = slotOf(snapshot.timestamp, SLOT_MINUTES);
const file = join(out, 'history', `${dow}-${slot}.json`);
let totals = {};
try {
  totals = JSON.parse(await readFile(file, 'utf8'));
} catch {
  /* first sample for this slot */
}
await writeFile(file, JSON.stringify(accumulate(totals, snapshot)));
console.log(`Snapshot: ${snapshot.carparks.length} car parks, history slot ${dow}-${slot}`);
