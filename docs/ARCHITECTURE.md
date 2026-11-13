# ParkWhere: how it works

For anyone (human or AI) picking this project up. Read this first, then
[ROADMAP.md](ROADMAP.md) for what to do next. The [README](../README.md) covers running and
using the app.

Last reviewed: 14 Nov 2026.

## What it is

A web app for drivers in Singapore. The user enters a destination, arrival and departure times and
a search radius; the app shows nearby car parks on a map with lots left (live or predicted), the
charge for the stay and the distance to the destination.

Live at <https://jtyx99.github.io/parkwhere/>.

## Shape of the system

There is no backend. The site is static files on GitHub Pages; each user's browser calls the data
services directly. Two GitHub Actions jobs do the only server-side work.

```
Browser (React app on GitHub Pages)
  |- api.data.gov.sg ............ HDB live lots + history   (no key, every 60 s)
  |- www.onemap.gov.sg .......... place search + map tiles  (no key today)
  |- ./data/hdb-carparks.json ... HDB car park list         (bundled with the site)
  '- raw.githubusercontent.com/<repo>/data/ ... mall/URA snapshots (when the LTA key is set)

GitHub Actions
  |- deploy.yml ........ on push: test, build, publish to Pages
  |                      weekly: also refresh hdb-carparks.json and commit it
  '- lta-snapshot.yml .. every 5 min: LTA DataMall -> `data` branch (needs LTA_ACCOUNT_KEY secret)
```

Stack: Vite, React 19, TypeScript, Leaflet (used directly, not react-leaflet), Vitest. No UI
framework; plain CSS with light/dark tokens in `src/styles.css`.

## Data sources

| Data | Source | Key | Notes |
|---|---|---|---|
| HDB live lots | `https://api.data.gov.sg/v1/transport/carpark-availability` | none | One response covers ~2,000 car parks (~300 KB). CORS open. Rate-limited for keyless callers; thresholds not checked. |
| HDB history | same URL with `?date_time=YYYY-MM-DDTHH:mm:ss` (Singapore time) | none | Returns the snapshot nearest that time. |
| HDB car park list | data.gov.sg dataset `d_23f946fa557947f93a8043bbef41dd09` via `datastore_search` | none | 2,273 rows. Coordinates are SVY21; converted in the browser. |
| Place search | `https://www.onemap.gov.sg/api/common/elastic/search` | none today | Response already carries an "Authentication token missing" warning. `VITE_ONEMAP_TOKEN` is supported if it becomes mandatory. |
| Map tiles | `https://www.onemap.gov.sg/maps/tiles/{Default|Night}/{z}/{x}/{y}.png` | none | Attribution with the OneMap logo is required and is in `MapView.tsx`. |
| Mall / URA / LTA lots | LTA DataMall `CarParkAvailabilityv2` | `AccountKey` header | No totals, no rates, no history. Not callable from a browser. |
| Mall rate text | data.gov.sg dataset `d_9f6056bdb6b1dfba57f063593e4f34ae` | none | 357 rows of free text; matched to DataMall by normalised name. |

## Code map

```
src/
  App.tsx                 all state: place, radius, times, live snapshots, history, selection
  model.ts                CarparkItem (what the UI renders), labels, status text
  components/
    SearchBar.tsx         debounced OneMap autocomplete, keyboard nav, "use my location"
    MapView.tsx           Leaflet map, lot-count markers, popups, radius ring
    CarparkCard.tsx       list row + expandable detail (availability, levels, charges, facts)
  sources/
    types.ts              Carpark, Snapshot, Availability, Quote, CarparkSource  <- start here
    index.ts              registry of enabled sources
    hdb.ts                HDB list, live and history fetches, payload parsing
    lta.ts                LTA source: static-snapshot mode and live-proxy mode
  lib/
    availability.ts       live / predicted / none decision, fullness grading
    pricing/hdb.ts        HDB charge calculator
    pricing/holidays.ts   public holidays (hardcoded, 2026-2027)
    geo.ts                haversine distance, SVY21 -> WGS84
    time.ts               Singapore-time parsing and formatting
    onemap.ts             place search
scripts/
  fetch-hdb-carparks.mjs  builds public/data/hdb-carparks.json
  snapshot-lta.mjs        one DataMall snapshot + history slot, written to a directory
server/
  lta.mjs                 DataMall fetch/normalise, shared by the job and the proxy
  index.mjs               optional live proxy (Node, no dependencies)
tests/                    Vitest unit tests; smoke.mjs is a Playwright end-to-end test
```

## Key concepts

### Sources

Everything the UI shows comes through the `CarparkSource` interface (`src/sources/types.ts`):

```ts
loadCarparks(): Promise<Carpark[]>
getLive(): Promise<Snapshot>
getHistory(at, now): Promise<Snapshot[]>   // comparable past snapshots
quote(carpark, arrive, depart): Quote
```

To add a data provider (URA, a private operator), implement this and register it in
`sources/index.ts`. The UI needs no changes. `Carpark.id` is `${sourceId}:${code}`.

### Live, predicted, no data (`lib/availability.ts`)

For each car park, `resolveAvailability` returns one of:

- **live**: arrival is within 30 min of now (`LIVE_HORIZON_MS`) and the car park's own reading is
  under 30 min old (`STALE_MS`).
- **predicted**: otherwise, the mean of the history snapshots for the arrival time. For HDB that
  is the same weekday and time over the past 4 weeks (`HISTORY_WEEKS`), fetched on demand and
  cached per 15-minute bucket. History readings that were themselves stale are ignored.
- **none**: neither is available.

The headline number is car lots (`lot_type` C). `App.tsx` only fetches history when it is needed:
a later arrival, or a nearby car park without a fresh live reading.

### Charges (`lib/pricing/hdb.ts`)

`quoteHdb` walks the stay minute by minute in Singapore time, assigns each minute to a band
(standard, Central Area, night, free), groups charges into day and night sessions, applies the
session caps, and returns lines that sum to the total. Rules encoded:

- $0.60 per half hour; $1.20 per half hour at Central Area car parks, Mon-Sat 7am-5pm
- night parking 10:30pm-7am capped at $5 where the car park offers it
- day parking 7am-10:30pm capped at $12, or $20 in the Central Area
- free on Sundays and public holidays where the dataset's `free_parking` says so
- `short_term_parking` = NO gives no total; restricted hours produce a warning

LTA car parks return rate text only (`ltaSource.quote`), never a total.

### Time

Everything is Singapore time (UTC+8, no DST) regardless of the browser's zone. Inputs are
wall-clock strings parsed by `parseSgt`; calculations use `sgtShift` and UTC getters. Do not use
local-time `Date` methods.

### Mall data without a backend

`lta-snapshot.yml` runs `scripts/snapshot-lta.mjs`, which writes `lta-live.json` and
`history/<weekday>-<slot>.json` (30-minute slots holding `[sum, samples]` per car park and lot
type). The job force-pushes them as a single commit to an orphan `data` branch. The site is built
with `VITE_LTA_DATA_URL` pointing at that branch's raw URL. If the files are absent the LTA source
returns nothing and the app behaves as HDB-only.

The proxy (`server/index.mjs`) is the alternative: same data, live, with `VITE_API_BASE`. It uses
15-minute history buckets; the static mode uses 30.

## Environment variables

| Name | Where | Purpose |
|---|---|---|
| `VITE_LTA_DATA_URL` | build | Base URL of published LTA snapshots (set in `deploy.yml`) |
| `VITE_API_BASE` | build | Base URL of the live proxy; takes precedence over snapshots |
| `VITE_ONEMAP_TOKEN` | build | OneMap token, if search starts requiring one. Visible to users in a static build. |
| `LTA_ACCOUNT_KEY` | Actions secret / proxy env | DataMall key. Never commit it. |
| `LTA_BASE_URL`, `RATES_URL` | job / proxy env | Override upstream URLs (used for testing with a fake feed) |

## Testing

- `npm test`: unit tests for pricing, availability rules, coordinate conversion and LTA snapshot
  handling.
- `npm run smoke`: Playwright drives the running dev server with data.gov.sg and OneMap mocked.
  Playwright is not a project dependency; the script loads a global install.
- To exercise the LTA path locally, point `LTA_BASE_URL` and `RATES_URL` at a fake HTTP server,
  run `scripts/snapshot-lta.mjs <dir>`, serve `<dir>` with an `Access-Control-Allow-Origin: *`
  header and start the app with `VITE_LTA_DATA_URL` set to it.

## Deployment

- The repository's only branch, `claude/quirky-carson-vtfl1s`, is also its default branch.
  `deploy.yml` publishes whichever branch is the default.
- Build and publish are separate jobs on purpose: in one job the publish step raced the artifact
  upload and failed with "no artifacts found".
- Re-running a failed deploy with "re-run failed jobs" can fail on a duplicate artifact; re-run
  all jobs, or push again.
- The weekly refresh commits to the default branch with the Actions token; that commit does not
  trigger another run, which is why the refresh and the deploy share a workflow.

## Things to be aware of

Unverified or approximate:

- **Central Area car park list** (`CENTRAL_AREA` in `pricing/hdb.ts`) was written from memory and
  has not been checked against HDB's list.
- **Central Area hours** (Mon-Sat 7am-5pm) come from secondary sources; HDB's page did not state them.
- **Day caps**: HDB says they do not apply at car parks with peak-hour charges; the app applies
  them everywhere.
- **Grace period** is not modelled. **Coupon parking** is priced per minute though coupons are
  per half hour. Charges are for **cars only**.
- **2027 Hari Raya Haji** date was entered from memory. Holidays stop at the end of 2027.
- **DataMall field names** in `server/lta.mjs` (`CarParkID`, `Development`, `Location`,
  `AvailableLots`, `LotType`, `Agency`) have only been tested against a fake feed.
- **`lta-snapshot.yml` has never run on GitHub**, with or without the key.

Behaviour worth knowing:

- About 270 HDB car parks in the list never appear in the availability feed, and a few in the feed
  stopped updating months ago. Both show as "No data" unless history exists.
- The availability feed sometimes lists a car park twice; the newest entry wins.
- Predictions are a plain mean of up to four samples. They ignore public and school holidays.
- LTA history never decays: old samples weigh the same as new ones.
- LTA car parks have no totals, so fullness uses absolute thresholds (5 or fewer = nearly full,
  20 or fewer = filling up).
- Mall rate text is matched by exact normalised name; many DataMall car parks will not match.
- The LTA car park list is loaded once at page load.
- Distance is straight-line, with walking time estimated at 80 m/min plus 30%.
- The app polls the HDB feed every minute from page load, even before a search.
- Per-level availability is not published by any source; `LevelCount` exists in the types and the
  detail panel renders it if a source ever fills it.
- GitHub pauses scheduled workflows after 60 days without repository activity.
- The workflows use action versions that log a Node 20 deprecation warning.
- There is no ESLint config, though one source file carries an eslint-disable comment.

Working in a restricted sandbox: Node's `fetch` ignores `HTTPS_PROXY` unless run with
`NODE_USE_ENV_PROXY=1`; data.gov.sg and OneMap must be on the network allowlist.
