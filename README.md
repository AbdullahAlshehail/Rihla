# Rihla / رحلتي

Smart Arabic-RTL mobile travel companion. Next.js 14 + TypeScript + Tailwind + Supabase.

This is **Phase 1 MVP**: login, trip CRUD, places browsing with smart score, itinerary save, budget with confidence levels, Google API routes (server-side only) ready for real keys, and caching infrastructure.

The original single-file HTML prototype at `../rihla-travel-app.html` is preserved for reference. Its 82 curated places are seeded into Postgres by the seed script.

---

## What works today (no Google key required)

- Email magic-link login (Supabase Auth)
- Create / list / edit / delete trips
- Browse 82 seeded places (Côte d'Azur + Riyadh) with **smart score 0–100** and Arabic reason
- Save favorites
- Day-by-day itinerary (5 slots × max 3 places, no same-day duplicates)
- Distance/time estimates between consecutive places (local fallback when Routes API absent)
- Budget calculator with editable assumptions + confidence level
- Editable SAR rates per trip

## What activates when you add a Google Maps API key

- Place text search beyond seeded data
- Live opening hours, photos, phone, address from Google Places
- Real driving/walking durations from Google Routes (currently we estimate)
- Hotel geocoding from free-text address

Anywhere a fallback was used, the UI clearly marks it `تقديري`.

---

## Local run

```bash
# 1) Install
cd rihla-app
npm install

# 2) Create .env.local from template and fill Supabase values
cp .env.example .env.local
# → edit .env.local
#   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
#   SUPABASE_SERVICE_ROLE_KEY=...      (server-only)
#   GOOGLE_MAPS_API_KEY=               (optional for now)

# 3) Apply database migrations (Supabase CLI)
#    Install: https://supabase.com/docs/guides/local-development/cli/getting-started
supabase link --project-ref YOUR_PROJECT_REF
supabase db push   # applies supabase/migrations/*

# 4) Seed the 82 places
npm run db:seed

# 5) Run the app
npm run dev
# → open http://localhost:3000
```

If you don't want to install the Supabase CLI yet, you can paste the two SQL files manually:
1. Open Supabase dashboard → SQL Editor
2. Run `supabase/migrations/20260602000001_initial_schema.sql`
3. Run `supabase/migrations/20260602000002_rls_policies.sql`
4. Then locally: `npm run db:seed`

---

## Deploy to Vercel

```bash
# Push the rihla-app folder to a new GitHub repo
cd rihla-app
git init && git add . && git commit -m "Phase 1 MVP"
git remote add origin git@github.com:YOU/rihla-app.git
git push -u origin main

# Then on https://vercel.com:
#   1. New project → import the repo
#   2. Set environment variables (same as .env.local)
#   3. Deploy
```

Vercel auto-detects Next.js. Build command and output dir are default.

---

## Required Google APIs (when you add the key)

Enable in Google Cloud Console:
- **Places API (New)**
- **Routes API** (for `computeRouteMatrix`)
- **Geocoding API**

Then in `.env.local` set `GOOGLE_MAPS_API_KEY=...`.
**Restrict the key** to these three APIs and to your Vercel domain when deploying.

---

## Google API cost estimate (per personal user)

| Operation | Unit price | When called | Monthly estimate |
|---|---|---|---|
| Place Details + Reviews (Pro) | $0.020 / call | Lazy on tap, cached 30 days | $0.60 (30 places) |
| Place Details (Arabic reviews) | $0.020 / call | Same as above, Arabic-first prefetch | $0.60 |
| Place Photos URL fetch | $0.007 / call | Once per place enrichment | $0.21 |
| Text Search (activities discovery) | $0.032 / call | On chip click, cached 7 days | $0.30 (~10 searches) |
| Geocoding (hotel address) | $0.005 / call | Once per trip creation | $0.02 |
| Routes API (when added) | $0.005 / call | Cached 14 days per origin/destination | $0.25 |
| **Total typical month** | | | **~$2-3** |

### Free tier
Google Maps Platform provides **$200 credit/month free**. For personal/family use, you stay well under, effectively making the app **free**.

### How we keep costs low
1. **30-day cache** for Place Details — `api_cache` + `places.enriched_at`
2. **7-day cache** for activity searches
3. **14-day cache** for routes
4. **Strict field masks** — request only fields we actually display
5. **Lazy enrichment** — Google calls only when user taps a place (not on list render)
6. **Seeded base** — 82 hand-curated places work fully offline-of-Google

## Cost-control strategy

| Lever | Implementation |
|---|---|
| DB cache | `api_cache` table holds JSON responses, TTL per operation (1–90 days). Every Google call hits cache first. |
| Logged usage | `api_usage_log` records every cache miss → know exactly what you're spending. |
| Seeded data | 82 places already in DB → no Google call for them. |
| Field masks | Google calls request only the minimum fields. |
| Lazy enrichment | Place details fetched only when user opens a place sheet. |
| Routes batched | Walking + driving computed in one cached parallel request. |

A typical 5-day Riyadh trip with frequent use should stay under **~50 Google API calls** thanks to caching.

---

## Project structure

```
rihla-app/
├── app/                          ← Next.js App Router pages
│   ├── login/                    ← Magic-link login
│   ├── auth/callback/            ← OAuth callback
│   ├── trips/                    ← Trip list + new + detail + plan + places + settings
│   └── api/                      ← Backend routes (server-side only)
│       ├── trips/
│       ├── places/
│       ├── routes/
│       └── geocode/
├── components/                   ← React UI components
│   ├── PlaceCard.tsx
│   ├── ItineraryDayCard.tsx
│   ├── TripSettingsForm.tsx
│   ├── BottomNav.tsx
│   └── SignOutButton.tsx
├── lib/
│   ├── supabase/                 ← Browser + server clients, types
│   ├── google/                   ← Places, Routes, Geocode adapters
│   ├── adapters/                 ← TripAdvisor, Viator, Booking stubs + AI stub
│   ├── scoring/                  ← Transparent 0–100 smart score
│   ├── budget/                   ← SAR budget estimator
│   ├── cache/                    ← Postgres-backed API cache
│   ├── transport.ts              ← Walking-vs-driving recommendation
│   └── utils.ts                  ← Formatters, geo, opening hours
├── supabase/migrations/          ← Schema + RLS
├── data/seed-places.ts           ← 82 curated places (Phase 1 dataset)
├── scripts/seed.ts               ← Run with `npm run db:seed`
├── middleware.ts                 ← Auth guard
└── .env.example
```

---

## Smart score: how it works

`lib/scoring/smartScore.ts` returns `{ score: 0..100, reasonAr, parts[] }`.
Every input adds a **bounded, documented number of points**. No black box.

| Input | Max contribution |
|---|---|
| Google rating | ±18 |
| Review count | +6 / -2 |
| Open now / closed | +8 / -10 |
| Distance from you | ±10 |
| Distance from hotel | ±5 |
| Editor pick | +4 |
| Budget match | ±6 |
| Your past rating | ±12 |
| Verdict love / skip | +5 / -15 |
| Saved by you | +3 |
| Preferred category | +5 |
| Hidden-gem detector | +4 |

The UI surfaces the top 1–2 reasons as a short Arabic sentence (e.g. "تقييمه عالي ٤.٨★ · مفتوح الآن · قريب منك").

---

## Budget engine

`lib/budget/estimator.ts` does **not** claim 5% accuracy. Instead:

- Items use their declared `cost_confidence` (high/medium/low).
- Trip-level confidence is `high` only if **≥3 user inputs** are filled AND no low-confidence items are in the plan.
- Each call returns `assumptions[]` so the user knows what's missing.
- All amounts shown in **SAR**. Native EUR/USD/etc. amounts convert through the trip's locked-in rates snapshot — so historical trips don't shift if exchange rates move.

---

## Status of external integrations

| Integration | State |
|---|---|
| Supabase Auth + Postgres | ✅ ready, awaits keys |
| Google Places API | 🟡 adapter ready, falls back to mock when no key |
| Google Routes API | 🟡 adapter ready, falls back to local time estimate |
| Google Geocoding | 🟡 adapter ready, silently no-op without key |
| TripAdvisor | ⛔ stub only — `lib/adapters/tripadvisor.ts` |
| Viator | ⛔ stub only |
| Booking.com | ⛔ stub only |
| AI summaries | ⛔ abstraction only, no calls in MVP |

---

## Next steps (Phase 2)

- Wire real Google Routes API calls behind the same `/api/routes` route (no UI change required).
- Improve smart-pick scheduler: city-aware, opening-hour aware, meal-time aware.
- Add "Best now" landing tile (current location + open now + scored).
- Add transport recommendation pill on each itinerary hop.
- Add place detail page with Google photos.
- Add Phase 2 adapters (TripAdvisor/Viator) when access is granted.
