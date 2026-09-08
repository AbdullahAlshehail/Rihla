// POST /api/trips/:tripId/share  → owner generates (or rotates) the share token
//
// Owner-only (authed). Returns the participant voting URL. Rotating the token
// instantly revokes any leaked link. The token is a crypto-random 128-bit hex
// string — not guessable, not enumerable.
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Ownership check + current token in one read (RLS also enforces ownership).
  const { data: trip, error } = await supabase
    .from("trips").select("id, share_token").eq("id", tripId).eq("user_id", user.id).single();
  if (error || !trip) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let rotate = false;
  try { rotate = (await req.json())?.rotate === true; } catch { /* no body → generate if absent */ }

  let token = trip.share_token as string | null;
  if (!token || rotate) {
    token = randomBytes(16).toString("hex");
    const { error: upErr } = await supabase
      .from("trips").update({ share_token: token }).eq("id", tripId).eq("user_id", user.id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ token, path: `/v/${token}` });
}
