# ParkWhere

Singapore parking finder: static React app on GitHub Pages, no backend.

- Read `docs/ARCHITECTURE.md` before changing anything; `docs/ROADMAP.md` lists what is next.
- Commands: `npm run dev`, `npm test`, `npm run build`, `npm run smoke` (needs the dev server).
- All times are Singapore time. Use the helpers in `src/lib/time.ts`, never local `Date` methods.
- New data providers implement `CarparkSource` in `src/sources/types.ts`; the UI stays untouched.
- Never commit API keys. The LTA key lives only in the `LTA_ACCOUNT_KEY` Actions secret.
- Pricing rules have tests in `tests/pricing.test.ts`; update both together.
- Keep `docs/` current when behaviour, data sources or the roadmap change.
