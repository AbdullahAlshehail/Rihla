// GET /api/feed — friends' recent check-ins (the نشاط أصدقائك feed).
//
// Honesty & security: the `checkins` RLS SELECT policy already restricts rows
// to `auth.uid() = user_id OR is_friend(user_id)`, so this query can never
// leak a stranger's check-in. We additionally exclude the caller's own rows
// (the feed is about friends). Names/avatars come from the `my_friends()`
// SECURITY DEFINER RPC — there is no FK from checkins → user_profiles, and
// this avoids a second RLS-sensitive join.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type FeedUser = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_emoji: string | null;
};

export type FeedItem = {
  id: string;
  created_at: string;
  rating: number | null;
  vibes: string[] | null;
  shout: string | null;
  points_awarded: number;
  is_first_visit: boolean;
  user: FeedUser;
  place: { name: string; city_label: string | null; category: string } | null;
};

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [friendsRes, checkinsRes] = await Promise.all([
    supabase.rpc("my_friends"),
    supabase
      .from("checkins")
      .select(
        "id, user_id, created_at, rating, vibes, shout, points_awarded, is_first_visit, place:places(name, city_label, category)",
      )
      .neq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (friendsRes.error) {
    return NextResponse.json({ error: friendsRes.error.message }, { status: 500 });
  }
  if (checkinsRes.error) {
    return NextResponse.json({ error: checkinsRes.error.message }, { status: 500 });
  }

  const profiles = new Map<string, FeedUser>(
    (friendsRes.data ?? []).map((f: FeedUser) => [f.id, f]),
  );

  const items: FeedItem[] = (checkinsRes.data ?? [])
    // Belt & braces: only rows whose author is a confirmed friend.
    .filter((c: { user_id: string }) => profiles.has(c.user_id))
    .map((c: Record<string, unknown>) => ({
      id: c.id as string,
      created_at: c.created_at as string,
      rating: (c.rating as number | null) ?? null,
      vibes: (c.vibes as string[] | null) ?? null,
      shout: (c.shout as string | null) ?? null,
      points_awarded: (c.points_awarded as number) ?? 0,
      is_first_visit: Boolean(c.is_first_visit),
      user: profiles.get(c.user_id as string)!,
      place: (c.place as FeedItem["place"]) ?? null,
    }));

  return NextResponse.json({ items });
}
