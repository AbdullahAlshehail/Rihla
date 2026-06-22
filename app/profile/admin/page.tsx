// /profile/admin — server entry. Verifies admin email server-side so the page
// never even renders for non-admins. All interactivity lives in AdminPanel.

import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { isAdminEmail } from "@/lib/admin";
import AdminPanel from "@/components/AdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) notFound();
  return <AdminPanel />;
}
