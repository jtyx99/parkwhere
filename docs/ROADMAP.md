# ParkWhere: roadmap

What is done, what to do next and what could follow. See [ARCHITECTURE.md](ARCHITECTURE.md) for
how the current system works.

Last reviewed: 14 Nov 2026.

## Done

- Map search by address, building, postal code or current location, with radius 100 m to 1 km
- HDB car parks: live lots, predictions from four weeks of history, "No data" where neither exists
- Lot-count markers with popups; list and detail panel; desktop, phone and dark mode
- Charges for the stay under HDB rules, with breakdown and warnings
- Straight-line distance and walking-time estimate
- GitHub Pages deployment on every push; weekly refresh of the HDB car park list
- Mall / URA / LTA car parks via scheduled DataMall snapshots, dormant until the key is added
- Optional live proxy for DataMall (`server/index.mjs`), not deployed
- Unit tests and a mocked end-to-end smoke test

## Next (small, high value)

1. **Switch on mall data.** Add the `LTA_ACCOUNT_KEY` repository secret, then check the first
   `lta-snapshot.yml` runs: that the `data` branch appears, that field names in `server/lta.mjs`
   match the real feed, and that mall car parks show in the app. Check how many get rate text.
2. **Verify HDB pricing against the source.** Confirm the Central Area car park list, the Central
   Area hours and whether day caps apply at Central Area car parks, on hdb.gov.sg. Fix
   `src/lib/pricing/hdb.ts` and its tests.
3. **Stop unnecessary polling.** Do not fetch the HDB feed until a place is chosen, and skip the
   minute refresh while showing predictions for a later arrival (`src/App.tsx`).
4. **Create a `main` branch** and make it the default, so work no longer lands on a
   session-named branch. `deploy.yml` already follows the default branch.
5. **Extend public holidays** beyond 2027, or load them from data.gov.sg's public holiday dataset
   during the weekly refresh so they never need a manual edit.

## Later (larger pieces)

- **Backend (Cloudflare Worker).** Worth doing when mall lag of 10-30 minutes becomes a problem,
  when the app is shared beyond a small group, when OneMap enforces tokens, or when URA data is
  wanted. Port `server/index.mjs`; fetch the HDB feed once and serve only nearby car parks; keep
  history in Worker storage. The app's proxy mode (`VITE_API_BASE`) is already there.
- **URA Data Service source.** URA car parks with structured rates, so charges can be calculated.
  Needs an access key and a daily token, so it depends on the backend.
- **Mall charge totals.** Parse the simpler published rate patterns ("$X per hour",
  "$X for 1st hr; $Y per sub. 30 min") into a calculated total, and fall back to text otherwise.
  Also loosen the name matching between DataMall and the rates dataset.
- **Better predictions.** Treat public holidays as Sundays, weight recent weeks more, show a
  confidence level, and decay old samples in the LTA history.
- **Real walking distance.** OneMap routing gives walking routes; it needs a token.

## Ideas

- Filters: height limit, hide season-only car parks, free parking now, cheapest within X minutes' walk
- Shareable links (place, times and radius in the URL) and saved favourite places
- Installable app (PWA) with the car park list cached offline
- Motorcycle and heavy-vehicle charges; coupon rounding; grace period
- EV charging points and accessible lots, if a data source is found
- Per-level availability, if any operator publishes it (the UI already supports it)
- Trend hint on each car park ("filling up", "emptying") from consecutive live readings
- ESLint and component tests; add Playwright as a dev dependency so the smoke test runs in CI

## Decisions already made (and why)

| Decision | Reason |
|---|---|
| Responsive web app, not native | Runs anywhere by link, fastest to build and share |
| No backend for now | Free, nothing to maintain, and HDB data is already live from the browser |
| Mall data via scheduled snapshots | Keeps the key in GitHub only; the owner accepted 10-30 minute lag |
| Per-level counts shown only if real | No public source publishes them; the owner chose not to show estimates |
| Default radius 100 m | Matches the original brief; the app offers to widen when nothing is in range |
| Leaflet used directly | Custom lot-count markers and popup syncing were simpler without a React wrapper |
