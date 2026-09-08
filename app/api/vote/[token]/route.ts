// GET  /api/vote/:token          → participant board (trip + stops + hype counts
//                                   + suggestions + anonymous comments)
// POST /api/vote/:token          → { kind: vote | unvote | suggest | comment }
//
// The share token is the ONLY gate. trip_id is derived server-side from the
// token — never trusted from the client. Writes use the service role (the vote
// tables have no anon RLS). voter_id is accepted for de-dupe/caps but is NEVER
// returned in any payload → anonymity is enforced at this boundary, not just in
// the UI. Invalid tokens get a uniform 404 (no enumeration). (Fable Option C.)
import { NextResponse } from "next/server";
import { z } from "zod";
import { createWriteClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAME_MAX = 80, NOTE_MAX = 200, BODY_MAX = 300;
const MAX_SUGGESTIONS_PER_VOTER = 10, MAX_COMMENTS_PER_VOTER = 8;

const uuid = z.string().uuid();
const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("vote"), voter_id: uuid, itinerary_item_id: uuid }),
  z.object({ kind: z.literal("unvote"), voter_id: uuid, itinerary_item_id: uuid }),
  z.object({ kind: z.literal("suggest"), voter_id: uuid, name: z.string().trim().min(2).max(NAME_MAX), note: z.string().trim().max(NOTE_MAX).optional() }),
  z.object({ kind: z.literal("comment"), voter_id: uuid, body: z.string().trim().min(2).max(BODY_MAX) }),
]);

async function tripFromToken(db: Awaited<ReturnType<typeof createWriteClient>>, token: string) {
  if (!token || token.length < 16) return null;
  const { data } = await db
    .from("trips")
    .select("id, name, destination_city, start_date, end_date")
    .eq("share_token", token)
    .maybeSingle();
  return data ?? null;
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const db = await createWriteClient();
  const trip = await tripFromToken(db, token);
  if (!trip) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const voter = new URL(req.url).searchParams.get("voter") ?? "";

  const [{ data: days }, { data: votes }, { data: suggestions }, { data: comments }] = await Promise.all([
    db.from("itinerary_days")
      .select("id, day_date, city, itinerary_items(id, slot, position, places(name, category, photo_url))")
      .eq("trip_id", trip.id).order("day_date", { ascending: true }),
    db.from("trip_votes").select("itinerary_item_id, voter_id").eq("trip_id", trip.id),
    db.from("trip_suggestions").select("id, name, note, created_at").eq("trip_id", trip.id).order("created_at", { ascending: false }),
    db.from("trip_comments").select("id, body, created_at").eq("trip_id", trip.id).order("created_at", { ascending: false }),
  ]);

  const counts: Record<string, number> = {};
  const mine: string[] = [];
  for (const v of votes ?? []) {
    counts[v.itinerary_item_id] = (counts[v.itinerary_item_id] ?? 0) + 1;
    if (voter && v.voter_id === voter) mine.push(v.itinerary_item_id);
  }

  return NextResponse.json({
    trip: { name: trip.name, city: trip.destination_city, start_date: trip.start_date, end_date: trip.end_date },
    days: days ?? [],
    counts,
    myVotes: mine,
    suggestions: suggestions ?? [], // no voter_id
    comments: comments ?? [],       // no voter_id
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const db = await createWriteClient();
  const trip = await tripFromToken(db, token);
  if (!trip) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const b = parsed.data;

  if (b.kind === "vote") {
    // Idempotent: unique(trip,item,voter) makes a repeat a no-op.
    const { error } = await db.from("trip_votes")
      .upsert({ trip_id: trip.id, itinerary_item_id: b.itinerary_item_id, voter_id: b.voter_id },
        { onConflict: "trip_id,itinerary_item_id,voter_id", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: "write_failed" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (b.kind === "unvote") {
    await db.from("trip_votes").delete()
      .eq("trip_id", trip.id).eq("itinerary_item_id", b.itinerary_item_id).eq("voter_id", b.voter_id);
    return NextResponse.json({ ok: true });
  }

  if (b.kind === "suggest") {
    const { count } = await db.from("trip_suggestions")
      .select("id", { count: "exact", head: true }).eq("trip_id", trip.id).eq("voter_id", b.voter_id);
    if ((count ?? 0) >= MAX_SUGGESTIONS_PER_VOTER)
      return NextResponse.json({ error: "limit_reached" }, { status: 429 });
    const { error } = await db.from("trip_suggestions")
      .insert({ trip_id: trip.id, voter_id: b.voter_id, name: b.name, note: b.note || null });
    if (error) return NextResponse.json({ error: "write_failed" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // comment
  const { count } = await db.from("trip_comments")
    .select("id", { count: "exact", head: true }).eq("trip_id", trip.id).eq("voter_id", b.voter_id);
  if ((count ?? 0) >= MAX_COMMENTS_PER_VOTER)
    return NextResponse.json({ error: "limit_reached" }, { status: 429 });
  const { error } = await db.from("trip_comments")
    .insert({ trip_id: trip.id, voter_id: b.voter_id, body: b.body });
  if (error) return NextResponse.json({ error: "write_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
