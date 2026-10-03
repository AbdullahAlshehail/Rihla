# AGENTS.md — Rihla (رحلة)

> Instructions for AI coding agents (Codex, etc.) working in this repo.
> Claude Code reads `CLAUDE.md`; this file is the equivalent onboarding for Codex.
> **Read this fully before editing anything.**

## What this is
Rihla / رحلتي — a **mobile-first, Arabic (RTL)** smart travel companion.
**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind · Supabase (Postgres + Auth + RLS) · Google Places/Maps · Groq LLM · deployed on **Netlify**. Current focus city: **London**.

- **iPhone-first is mandatory.** Every UI change must look right on an iPhone viewport before it's "done".
- **Arabic RTL** is the primary language of the UI.

## Run / verify (PowerShell on Windows; deps already installed)
```
npm run dev         # local dev server
npm run typecheck   # tsc --noEmit  ← run before claiming done
npm run build       # production build  ← must pass before any deploy
npm run lint
```
Node 20. Always run `npm run typecheck` **and** `npm run build` before saying a change works.

## Structure map
```
app/                Next.js App Router
  api/              server routes: places, photo, trips, cron, admin, geocode, feed, routes, checkins…
  trips/ plan/ profile/ passport/ login/ auth/   pages
components/         52 React components (place cards, maps, filters, timeline…)
lib/
  supabase/         client.ts (browser, anon) · server.ts (SSR) · database.types.ts
  google/           Google Places/Maps helpers
  discover/         filters.ts  ← Discover chip predicates (food/coffee/solo/…)
  trending/         v2/ (Brave social funnel) · web/curatedScan.ts (curated web trending) · scan.ts (run logging)
  scoring/ plan/ places/ geo/ ai/ budget/ social/ …
supabase/migrations/  SQL migrations (9)
scripts/            seed + one-off scripts
```

## Environment (names only — NEVER print or commit values)
`.env.local` is gitignored — safe to read locally, **never paste keys into chat, logs, or commits.**
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — client, RLS-protected.
- `SUPABASE_SERVICE_ROLE_KEY` — server only. (Placeholder locally.)
- `GOOGLE_MAPS_API_KEY` — **restricted key**, $1 budget alert, most APIs disabled. Stay within free monthly tiers (Place Details 5k/mo, Photo 1k/mo). Don't add calls that hit new billable SKUs.
- `GROQ_API_KEY` — LLM extraction (llama-3.1-8b-instant). (Currently invalid locally — see Current state.)
- `NEXT_PUBLIC_APP_URL`

## 🚫 Hard rules (do NOT violate — data/prod safety)
1. **Never deploy to production without the owner's explicit OK.** Prod = `git push` to `main` (GitHub `AbdullahAlshehail/Rihla`) → the owner's Netlify auto-deploys. Local commits/branches are fine; pushing `main` is a gated action.
2. **Trending data is APPEND-ONLY.** Never DELETE or wipe `trending_*` rows. On a failed/thin scan, write nothing — never clear existing data. The 14-day display window self-cleans.
3. **On a trend refresh, touch ONLY trend fields** (`trending_score/source/evidence/url/updated_at`) of an existing place. Never overwrite an existing row's `name`, `category`, or `photo_url`.
4. **Supabase RLS is enforced.** Anon (client) key may only do constrained INSERTs; never expose anon SELECT/UPDATE/DELETE on PII/orders. Migrations are versioned in `supabase/migrations/` — add a new file, don't edit applied ones. Prod schema changes are a gated action.
5. **No secrets** in code, output, logs, or commits.
6. **Netlify buildless deploy** (`netlify deploy --no-build`) needs the static tree mirrored first (see `.claude/rules/netlify-nextjs-deploy.md`) or CSS 404s: copy `.next/static → .next/_next/static` and `public/* → .next/`.
7. **Don't weaken** tests, types, validation, or RLS to make something pass.

## Working alongside Claude Code
Claude Code (Claude + the owner's Fable 5.1 judgment agents) also edits this repo.
- **Do not edit the same files as Claude at the same time** — coordinate by turns; git is the safety net.
- Prefer working on a branch: `git checkout -b codex/work`, commit each change with a clear message. The owner reviews the diff and merges good work into `main`.
- Before starting, `git status` should be clean. Baseline is `main`.

## Definition of done
Diff reviewed · `npm run typecheck` clean · `npm run build` passes · UI verified on iPhone viewport if UI changed · `git status` clean · no secrets/debug left · state explicitly what was NOT verified. Never claim "should work" — show evidence.

## Current state (2026-10-04) — READ THIS FIRST

### Branch truth
- **`main` = `origin/main` = `1a2f5be`** — this is the deploy branch and the source of truth. Everything described below is committed and pushed.
- **`codex/work`** holds Codex's own unfinished work: commit `7a136d1` (paid-calls / map-links / route-cache hardening) plus **uncommitted** `docs/hardening-2026-09-08.md` and **untracked** `scripts/test-paid-call-migration.mjs`. **Commit those before doing anything else** — they are the only unbacked-up work in the repo.
- The voting + geo + PWA commits that also appear in `codex/work` history are **already on `main`** via cherry-pick. `git rebase main` will drop them as patch-id duplicates — that is expected, not data loss.
- `http.version = HTTP/1.1` is set in this repo's git config. Leave it: pushes to GitHub fail with `Recv failure: Connection was reset` over HTTP/2 from this machine.

### What was built and is NOT live yet
All of this is on `main`, typechecked, and builds clean — but **no successful production deploy exists**:
1. **Group voting** — owner shares an unguessable link; friends vote on stops, suggest places, leave anonymous comments, no account needed. `app/api/vote/[token]/`, `app/v/[token]/`, `app/trips/[tripId]/vote/`, `app/api/trips/[tripId]/share/`, `components/VoteBoard.tsx`, `components/ShareLinkPanel.tsx`, `lib/voting/voterId.ts`. Migration `20260908000002_group_voting.sql` **is already applied to the production database** (tables + RLS + `trips.share_token` exist). The owner's London trip already has a `share_token` row value — read it from `trips.share_token`, never hardcode it.
2. **PWA install** — 24 iOS launch images (`public/splash/`, generated by `scripts/gen-splash.mjs`), standalone-only CSS polish in `app/globals.css`, and an Arabic install guide at `app/install/`.
3. **Geolocation fix** (`components/MapScreen.tsx`) — the out-of-plan detector had an 18 km lower bound and **no upper bound**, so the owner at home in Riyadh with a London trip was told "you're outside your plan" and silently redirected on every map open. Now: 18 km lower bound + a self-calibrating upper bound derived from the trip's own place span (centroid + max radius + 60 km margin), and the automatic `router.replace` was removed in favour of the existing tappable banner. Verified against 5 coordinate cases.
4. **Weekly curated web-trending cron** — `lib/trending/web/curatedScan.ts` + `app/api/cron/trending-web/route.ts` + a Sunday schedule in `netlify.toml`.

### The one blocker: deployment
`rihla-travel.netlify.app` still serves an **old build** (`/install` → 307). A second site `rihla-travel-app.netlify.app` was created under the owner's own Netlify account and **two local deploys from Windows both failed**: every server route returns 404 (including `/api/photo` and the unique deploy URL), because the Next runtime v5 server handler was not wired — the CLI published `.next` while the plugin's real output was `.netlify/static` + `.netlify/functions-internal`. A `--no-build --dir=.netlify/static --functions=...` attempt returned a Netlify API 404 and corrupted the site link.

**Do not retry local `netlify deploy` builds from Windows.** Verify in the current `@netlify/plugin-nextjs` docs, then deploy the way the runtime expects: **connect this GitHub repo to a Netlify site so Netlify's own CI (Linux) runs the build**, and let pushes to `main` deploy. There are currently **zero deploy hooks on the repo** (GitHub commit status `total_count: 0`), which is why pushing changes nothing today.

Notes: the build log suggests bumping `@netlify/plugin-nextjs` 5.15.11 → 5.16.0 (your call). Local edge-function bundling also failed to resolve `@opentelemetry/api`; installing it locally silenced that error but did **not** fix the 404, so it may be unnecessary on Linux CI.

### Owner-only steps (an agent cannot do these)
- Link the repo to a Netlify site (browser login). Preferred: the account that owns `rihla-travel.netlify.app`, because its env vars, Supabase auth redirect URLs, and the already-installed PWA all point at that domain. If instead using `rihla-travel-app`, you must also add that origin's `/auth/callback` to Supabase → Auth → URL Configuration and set `GOOGLE_MAPS_API_KEY`, or login and photos break.
- Set **`SUPABASE_SERVICE_ROLE_KEY`** in Netlify env. Without it `createWriteClient()` falls back to the cookie client, anon has no INSERT policy on the vote tables by design, and every vote returns `write_failed`.
- Set **`CRON_SECRET`** and a valid **`GROQ_API_KEY`** for the trending cron (it fails closed without them, which is safe).

### Not verified (state this honestly, don't paper over it)
Nothing above has been confirmed in a live browser: no install at 200, no voting round-trip, no confirmation that the geo banner stays silent in Riyadh. Those checks are only possible after a successful Netlify-CI deploy.
