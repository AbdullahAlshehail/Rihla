"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function SignOutButton() {
  const router = useRouter();
  async function logout() {
    const sb = createClient();
    await sb.auth.signOut();
    // Tell the service worker to drop this user's cached data + pages so the
    // next device user can't read them offline. Best-effort; never blocks exit.
    try {
      navigator.serviceWorker?.controller?.postMessage({ type: "PURGE_USER_CACHE" });
    } catch { /* no SW / unsupported — ignore */ }
    router.replace("/login");
  }
  return (
    <button
      onClick={logout}
      className="text-xs text-muted bg-card border border-line px-3 py-2 rounded-pill font-bold"
    >
      خروج
    </button>
  );
}
