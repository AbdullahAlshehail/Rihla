// Server-side Supabase client — reads cookies from Next.js request.
// Use in server components, route handlers, and server actions.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet: CookieToSet[]) {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll throws in pure RSC contexts — safe to ignore;
            // middleware refreshes the session.
          }
        },
      },
    }
  );
}

// Write-capable client.
//
// Prefers SUPABASE_SERVICE_ROLE_KEY (bypasses RLS) when available — used by
// seed scripts and any code that needs to act outside a user session.
// Falls back to the authenticated user's client when the service key is the
// placeholder or missing — RLS policies allow authed users to write to the
// shared catalog (places, api_cache, api_usage_log).
import { createClient as createSbClient } from "@supabase/supabase-js";

function hasRealServiceKey(): boolean {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) return false;
  // Detect the .env placeholder we ship for first-time setup
  if (k.startsWith("PASTE_") || k.includes("PLACEHOLDER")) return false;
  // Supabase service-role JWTs are >150 chars; anything shorter is suspect
  return k.length > 100;
}

/** Returns a Supabase client capable of writing to shared tables.
 *  Service role first (bypasses RLS); falls back to the request's authed client. */
export async function createWriteClient() {
  if (hasRealServiceKey()) {
    return createSbClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
  }
  return await createClient();
}

/** @deprecated — use createWriteClient() instead. Kept for seed scripts that
 *  need to fail loudly when the service role key is missing. */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!hasRealServiceKey()) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY missing or placeholder. Required for seeding."
    );
  }
  return createSbClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key!, {
    auth: { persistSession: false },
  });
}
