// GET /api/places/[id]/social — social state for a place:
//   { here_now, mayor:{name,avatar,visits,is_me}|null, friends_here:[…], me:{checked_in_today} }
//
// Global aggregates (here-now count, mayor) are computed by the `place_social`
// SECURITY DEFINER function so RLS doesn't hide them — but it only ever returns
// semi-public profile fields (name/avatar), never raw check-in rows of
// non-friends.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase.rpc("place_social", { p_place_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? {});
}
