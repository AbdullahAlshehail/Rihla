// GET /api/admin/usage — daily + monthly Google API usage broken down per SKU.
// Reflects post-March-2025 Google pricing (per-SKU free tier, no blanket $200 credit).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDailyUsage } from "@/lib/google/budgetGuard";
import { isAdminEmail } from "@/lib/admin";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const usage = await getDailyUsage();
  return NextResponse.json({
    ...usage,
    safe: usage.monthlyCostUsd < usage.monthlySoftCapUsd * 0.5,
  });
}
