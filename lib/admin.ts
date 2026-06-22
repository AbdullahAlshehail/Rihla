// Admin-only gate for the /api/admin/* routes.
//
// Anyone authenticated could previously trigger budget-spending routes
// (audit 2026-06-15). We gate on email — server-only check, no client UI.
// Override via env if you need a comma-separated allow-list.

const HARDCODED_ADMIN_EMAILS = new Set<string>([
  "abdullah.alshehail@gmail.com",
]);

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (HARDCODED_ADMIN_EMAILS.has(normalized)) return true;
  const fromEnv = (process.env.ADMIN_EMAILS ?? "").trim();
  if (!fromEnv) return false;
  return fromEnv
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}
