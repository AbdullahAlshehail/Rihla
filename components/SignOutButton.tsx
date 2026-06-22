"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function SignOutButton() {
  const router = useRouter();
  async function logout() {
    const sb = createClient();
    await sb.auth.signOut();
    router.replace("/login");
  }
  return (
    <button
      onClick={logout}
      className="text-xs text-muted bg-white border border-line px-3 py-2 rounded-pill font-bold"
    >
      خروج
    </button>
  );
}
