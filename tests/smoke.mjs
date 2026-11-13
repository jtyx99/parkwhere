// End-to-end smoke test with the external services mocked, so results are repeatable.
// Start the app first (npm run dev), then: npm run smoke [-- http://localhost:5173]
// Needs Playwright: uses a global install if the project has none.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.argv[2] ?? 'http://localhost:5173/';
const { carparks } = JSON.parse(await readFile(new URL('../public/data/hdb-carparks.json', import.meta.url)));

const sgt = (ms) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 19);
// Every car park reports 50 of 100 lots, live and in history.
const availability = (at) => ({
  items: [{
    timestamp: `${sgt(at)}+08:00`,
    carpark_data: carparks.map((c) => ({
      carpark_number: c.code,
      update_datetime: sgt(at - 60_000),
      carpark_info: [{ lot_type: 'C', lots_available: '50', total_lots: '100' }],
    })),
  }],
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.route('https://api.data.gov.sg/**', (route) => {
  const dt = new URL(route.request().url()).searchParams.get('date_time');
  const at = dt ? +new Date(`${dt}+08:00`) : Date.now();
  route.fulfill({ json: availability(at), headers: { 'access-control-allow-origin': '*' } });
});
await page.route('https://www.onemap.gov.sg/api/**', (route) =>
  route.fulfill({
    headers: { 'access-control-allow-origin': '*' },
    json: { results: [{ SEARCHVAL: 'HDB HUB', ADDRESS: '480 LORONG 6 TOA PAYOH HDB HUB SINGAPORE 310480', LATITUDE: '1.33216', LONGITUDE: '103.84852' }] },
  }),
);
await page.route('https://www.onemap.gov.sg/maps/**', (route) => route.abort());

await page.goto(url);
await page.getByRole('combobox').fill('hdb hub');
await page.getByRole('option').first().click();
await page.getByRole('button', { name: '500 m', exact: true }).click();
await page.locator('.pin').first().waitFor();

// 1. Live: every marker shows the mocked count.
const pins = await page.locator('.pin b').allInnerTexts();
assert.ok(pins.length >= 5, `expected several car parks, got ${pins.length}`);
assert.ok(pins.every((t) => t === '50'), `live pins should read 50: ${pins}`);
assert.equal(await page.locator('.card').count(), pins.length);

// 2. Selecting a marker opens the popup and the detail panel, with distance.
await page.locator('.pin').first().click({ force: true });
await page.locator('.popup').waitFor();
assert.match(await page.locator('.popup').innerText(), /50\s+lots left of 100/);
assert.match(await page.locator('.popup').innerText(), /\d+ m away/);
const detail = page.locator('.card.is-selected .detail');
await detail.waitFor();
assert.match(await detail.innerText(), /Live count/);

// 3. A future weekday stay: predicted counts and the charge for the stay.
const now = new Date(Date.now() + 8 * 3600_000);
const wed = new Date(now);
wed.setUTCDate(now.getUTCDate() + ((3 - now.getUTCDay() + 7) % 7 || 7) + 7);
const day = wed.toISOString().slice(0, 10);
const [arrive, leave] = await page.locator('input[type=datetime-local]').all();
await arrive.fill(`${day}T10:00`);
await leave.fill(`${day}T13:00`);
await page.locator('.pin--predicted').first().waitFor();
const predicted = await page.locator('.pin b').allInnerTexts();
assert.ok(predicted.every((t) => t === '~50'), `predicted pins should read ~50: ${predicted}`);
const firstPriced = page.locator('.card-price b').first();
assert.equal(await firstPriced.innerText(), '$3.60');

// 4. Departure before arrival is rejected.
await leave.fill(`${day}T09:00`);
await page.getByRole('alert').waitFor();

assert.deepEqual(errors, []);
await browser.close();
console.log(`Smoke test passed (${pins.length} car parks checked).`);
