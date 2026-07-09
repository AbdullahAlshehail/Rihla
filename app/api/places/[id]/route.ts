// GET /api/places/:id  → place row from DB only.
// The client triggers /api/places/[id]/enrich in the background when it needs
// fresher Google data, so this hot path stays cached + cheap. Previously every
// detail-sheet open made a synchronous Google Place Details call (~1.2 s tail
// latency, and a hard cap of 4,500 calls/month).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: place, error } = await supabase
    .from("places")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !place) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ place, google_fresh: null });
}
