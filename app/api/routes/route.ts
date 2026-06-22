// POST /api/routes { origin:{lat,lng}, destination:{lat,lng} }
// Returns walking + driving duration. Cached.
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { computeRoute } from "@/lib/google/routes";

const Coord = z.object({ lat: z.number(), lng: z.number() });
const Body = z.object({ origin: Coord, destination: Coord });

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const route = await computeRoute(
    parsed.data.origin,
    parsed.data.destination,
    user.id
  );
  return NextResponse.json(route);
}
