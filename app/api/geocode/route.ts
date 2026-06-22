// POST /api/geocode { address }
// Converts a hotel name/address to lat/lng/place_id.
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { geocode } from "@/lib/google/geocode";

const Body = z.object({ address: z.string().min(2) });

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { result, mock } = await geocode(parsed.data.address, user.id);
  return NextResponse.json({ result, mock });
}
