# ParkWhere

Find parking near a destination in Singapore: live lots, predicted availability for later
arrivals, charges for your stay and walking distance, on a map.

## Use it

Live at <https://jtyx99.github.io/parkwhere/> once GitHub Pages is switched on for the repo
(Settings → Pages → Source: **GitHub Actions**; the repo must be public or on a paid plan).

## Run it locally

```bash
npm install
npm run dev
```

Open the printed URL, search for a place, set arrival and departure, and pick a radius.

| Command | What it does |
|---|---|
| `npm run dev` | Start the app locally |
| `npm run build` | Typecheck and build to `dist/` (static files, host anywhere) |
| `npm test` | Unit tests: pricing, prediction, coordinates |
| `npm run smoke` | Browser test with mocked services (needs `npm run dev` running and Playwright installed) |
| `npm run data:hdb` | Refresh the bundled HDB car park list |

## How it works

- **Car parks**: about 2,200 HDB car parks, bundled in `public/data/hdb-carparks.json` from
  data.gov.sg ("HDB Carpark Information").
- **Live lots**: data.gov.sg car park availability API, refreshed every minute.
- **Prediction**: when you arrive more than 30 minutes from now, or a car park's live reading is
  over 30 minutes old, the app averages the same weekday and time over the past 4 weeks from the
  same API's history. Car parks with neither are shown as "No data".
- **Charges**: HDB short-term rules for cars (`src/lib/pricing/hdb.ts`): $0.60 per half hour;
  $1.20 per half hour in Central Area car parks Mon-Sat 7am-5pm; night parking capped at $5;
  day parking capped at $12 ($20 Central Area); free Sunday/public-holiday parking where the car
  park offers it. These are estimates; signs at the car park prevail. Public holidays are listed
  in `src/lib/pricing/holidays.ts` and need extending each year.
- **Per-level counts**: no public source publishes them, so the panel shows counts per lot type
  and the number of decks. A per-level table appears automatically if a source supplies `levels`.
- **Search and map**: OneMap. Search currently works without a token; if that changes, set
  `VITE_ONEMAP_TOKEN`.
- All times are Singapore time.

## Keeping data up to date

| Data | How it stays current |
|---|---|
| Lots available | Fetched live, every minute while the app is open |
| Predictions | Read from the past four weeks on demand, so they roll forward |
| HDB car park list | Refreshed every Monday by `.github/workflows/deploy.yml`, which commits any change and redeploys. Run the workflow manually from the Actions tab to refresh sooner. |
| HDB rate rules | Manual: `src/lib/pricing/hdb.ts` (rates, caps, Central Area car parks) |
| Public holidays | Manual: `src/lib/pricing/holidays.ts`, listed to the end of 2027 |

Every push to the default branch also runs the tests and redeploys the site.

## Adding malls and URA car parks (optional)

LTA DataMall covers major malls and URA/LTA car parks but needs a free account key
(<https://datamall.lta.gov.sg>) and cannot be called from a browser, so a small proxy is included.

```bash
LTA_ACCOUNT_KEY=your-key npm run server      # http://localhost:8787
VITE_API_BASE=http://localhost:8787 npm run dev
```

The proxy samples the feed every 5 minutes to build its own history, so predictions for these car
parks appear once it has been running for a week or more. DataMall gives no total lot counts, and
operator rates are published as free text, so these car parks show the rate text without a
calculated total.
