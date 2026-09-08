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

## Current state (2026-09-08)
- `main` builds green. Latest feature: **weekly curated web-trending cron** for London — `lib/trending/web/curatedScan.ts` + `app/api/cron/trending-web/route.ts` + weekly schedule in `netlify.toml`. Code-verified (tsc + build), **not deployed**.
- Blocked on: a valid `GROQ_API_KEY` + a `CRON_SECRET` set in the owner's Netlify env, then a gated prod deploy. Local `GROQ_API_KEY` is invalid (401), so the live Groq extraction is untested.
- All ~870 London places already have real Google photos (within free tier). Trending display predicate lives in `lib/trending` (score ≥ 50, specific evidence, 14-day window). **Do not lower trending thresholds** — it breaks accuracy.
