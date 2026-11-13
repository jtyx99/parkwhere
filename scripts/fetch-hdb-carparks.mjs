// Builds public/data/hdb-carparks.json from data.gov.sg "HDB Carpark Information".
// Coordinates stay in SVY21 (x, y); the app converts them to WGS84 on load.
import { writeFile, mkdir } from 'node:fs/promises';

const RESOURCE = 'd_23f946fa557947f93a8043bbef41dd09';
const BASE = 'https://data.gov.sg/api/action/datastore_search';

const rows = [];
let offset = 0;
for (;;) {
  const res = await fetch(`${BASE}?resource_id=${RESOURCE}&limit=1000&offset=${offset}`);
  if (!res.ok) throw new Error(`data.gov.sg responded ${res.status}`);
  const { result } = await res.json();
  rows.push(...result.records);
  offset += result.records.length;
  if (result.records.length === 0 || offset >= result.total) break;
}

const out = rows.map((r) => ({
  code: r.car_park_no,
  address: r.address,
  x: Number(r.x_coord),
  y: Number(r.y_coord),
  type: r.car_park_type,
  system: r.type_of_parking_system,
  shortTerm: r.short_term_parking,
  free: r.free_parking,
  night: r.night_parking === 'YES',
  decks: Number(r.car_park_decks),
  gantry: Number(r.gantry_height),
  basement: r.car_park_basement === 'Y',
}));

await mkdir('public/data', { recursive: true });
await writeFile(
  'public/data/hdb-carparks.json',
  JSON.stringify({ fetchedAt: new Date().toISOString(), carparks: out }),
);
console.log(`Wrote ${out.length} HDB car parks`);
