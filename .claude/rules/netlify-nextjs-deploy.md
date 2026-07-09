# Rule: Rihla Netlify deploy (buildless) — avoid CSS 404

**Scope:** deploying rihla-app to Netlify with `netlify deploy --no-build`.

**Why this exists (evidence / project memory):** a buildless deploy serves `.next` as-is; Next.js expects static assets under `_next/`, so CSS/JS 404 unless the static tree is mirrored first.

## Required pre-deploy steps (in order)
1. `npm run build` locally first (generate a fresh `.next`).
2. Copy static assets so the buildless deploy resolves `_next/`:
   - `.next/static` → `.next/_next/static`
   - `public/*` → `.next/`
3. Then `netlify deploy --no-build --dir=.next` (or the project's configured publish dir).
4. After deploy, open the live URL and confirm **CSS loads** (no 404 on `_next/static/css/*`) before calling it done.

## Notes
- `--no-build` = 0 Netlify build credits (Pro plan pool is 3000, shared).
- Never deploy without explicit user approval (global rule).
- This is buildless-specific; if you switch to a normal `netlify deploy` (with build) this workaround is unnecessary.
