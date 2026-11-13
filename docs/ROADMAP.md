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
2. **Calculated charges for mall and other non-HDB car parks.** Requested by the owner; not
   started. Depends on item 1. Today these car parks show the operator's rate text and no total.
   - **Goal**: every car park with published rates shows an estimated total for the stay and a
     breakdown, as HDB car parks do. The original rate text stays visible beside it.
   - **Why it is feasible**: the rates dataset (357 car parks, free text) follows a few recurring
     shapes. In a sample of the weekday column, about 275 entries use time windows
     ("7am-6pm: ...", "Aft 6pm: ...") and about 195 use first-period then subsequent-period
     pricing ("$3.30 for 1st hr; $1.10 for sub. ½ hr"). The rest are flat "per entry" charges,
     per-minute rates, "Free", "Closed", and cross-references ("Same as wkdays", "Same as
     Saturday", "same as wkdays, but $2.40 per entry after 2pm").
   - **Approach**: convert the text into structured rules ahead of time, not in the browser.
     A build script parses the dataset into a rules file: time windows per day type (weekday,
     Saturday, Sunday/PH), each with a first-period charge, a subsequent-period charge and unit,
     a per-entry charge, a per-minute rate, or free/closed; "same as" references are resolved.
     Entries the parser cannot handle go into a small hand-maintained overrides file. A calculator
     walks the stay across the windows, following the pattern of `quoteHdb` in
     `src/lib/pricing/hdb.ts`, and replaces the text-only `ltaSource.quote` in
     `src/sources/lta.ts`.
   - **Rules to settle**: "or part thereof" rounding (round up by default); how a per-entry
     charge applies when a stay crosses windows; stays spanning midnight or several days; public
     holidays (reuse `src/lib/pricing/holidays.ts`); closed periods.
   - **Presentation**: label the total "Estimated", show the dataset's date, and say "cannot be
     estimated" only where the text is unparseable or absent. "Cheapest" sorting then includes
     these car parks.
   - **Also needed**: looser name matching between DataMall and the rates dataset (it is exact
     normalised-name matching today), and a build report of how many car parks parsed, were
     overridden, or failed.
   - **Acceptance**: unit tests using real rows for each text shape; coverage figure reported;
     no total ever shown without its source text.
   - **Known limits**: the text has typos (for example "7pm-6pm") and is not kept current by
     operators, so totals can be out of date. Car parks missing from the dataset still get no
     total until another rate source (URA, below) is added.
3. **Verify HDB pricing against the source.** Confirm the Central Area car park list, the Central
   Area hours and whether day caps apply at Central Area car parks, on hdb.gov.sg. Fix
   `src/lib/pricing/hdb.ts` and its tests.
4. **Stop unnecessary polling.** Do not fetch the HDB feed until a place is chosen, and skip the
   minute refresh while showing predictions for a later arrival (`src/App.tsx`).
5. **Create a `main` branch** and make it the default, so work no longer lands on a
   session-named branch. `deploy.yml` already follows the default branch.
6. **Extend public holidays** beyond 2027, or load them from data.gov.sg's public holiday dataset
   during the weekly refresh so they never need a manual edit.

## Later (larger pieces)

- **Backend (Cloudflare Worker).** Worth doing when mall lag of 10-30 minutes becomes a problem,
  when the app is shared beyond a small group, when OneMap enforces tokens, or when URA data is
  wanted. Port `server/index.mjs`; fetch the HDB feed once and serve only nearby car parks; keep
  history in Worker storage. The app's proxy mode (`VITE_API_BASE`) is already there.
- **URA Data Service source.** URA car parks with structured rates, so charges can be calculated
  exactly instead of estimated from text.
  Needs an access key and a daily token, so it depends on the backend.
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
| Non-HDB totals are estimates from published text, always shown with that text | The text is irregular and may be out of date; the owner wants a total shown regardless |
| Leaflet used directly | Custom lot-count markers and popup syncing were simpler without a React wrapper |
