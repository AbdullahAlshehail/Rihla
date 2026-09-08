// Owner view: generate/share the voting link + see aggregate results
// (hype counts, suggestions, anonymous comments). Owner-authed; RLS lets the
// owner read these rows. Votes are advisory — this page never changes the plan.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ShareLinkPanel from "@/components/ShareLinkPanel";

export const dynamic = "force-dynamic";

const SLOT_AR: Record<string, string> = { morning: "الصباح", midday: "الظهر", afternoon: "العصر", evening: "المساء", night: "الليل" };

export default async function Page({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: trip } = await supabase
    .from("trips").select("id, name, share_token").eq("id", tripId).eq("user_id", user.id).single();
  if (!trip) redirect("/trips");

  const [{ data: days }, { data: votes }, { data: suggestions }, { data: comments }] = await Promise.all([
    supabase.from("itinerary_days").select("day_date, itinerary_items(id, slot, places(name))").eq("trip_id", tripId).order("day_date", { ascending: true }),
    supabase.from("trip_votes").select("itinerary_item_id").eq("trip_id", tripId),
    supabase.from("trip_suggestions").select("id, name, note, created_at").eq("trip_id", tripId).order("created_at", { ascending: false }),
    supabase.from("trip_comments").select("id, body, created_at").eq("trip_id", tripId).order("created_at", { ascending: false }),
  ]);

  const counts: Record<string, number> = {};
  for (const v of (votes ?? []) as { itinerary_item_id: string }[]) counts[v.itinerary_item_id] = (counts[v.itinerary_item_id] ?? 0) + 1;

  type Row = { name: string; slot: string; c: number };
  const ranked: Row[] = ((days ?? []) as any[])
    .flatMap((d) => (d.itinerary_items ?? []).map((it: any) => ({ name: it.places?.name ?? "—", slot: it.slot as string, c: counts[it.id] ?? 0 })))
    .sort((a: Row, z: Row) => z.c - a.c);
  const totalVotes = (votes ?? []).length;

  return (
    <main dir="rtl" className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-md px-4 py-6 space-y-4">
        <header>
          <a href={`/trips/${tripId}/plan`} className="text-indigo-600 text-sm">← رجوع للخطة</a>
          <h1 className="text-xl font-extrabold text-slate-900 mt-2">تصويت المجموعة</h1>
          <p className="text-slate-500 text-sm">{trip.name}</p>
        </header>

        <ShareLinkPanel tripId={tripId} initialToken={(trip.share_token as string) ?? null} />

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-bold text-slate-800 mb-2">🔥 الحماس ({totalVotes} صوت)</h2>
          {ranked.length === 0 ? (
            <p className="text-slate-400 text-sm">لا أصوات بعد — شارك الرابط وابدأ 🎉</p>
          ) : (
            <ol className="space-y-1">
              {ranked.map((r, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className="w-6 text-slate-400">{i + 1}</span>
                  <span className="flex-1 truncate text-slate-700">{r.name} <span className="text-slate-400 text-xs">· {SLOT_AR[r.slot] ?? r.slot}</span></span>
                  <span className="font-bold text-slate-800">{r.c} 🔥</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-bold text-slate-800 mb-2">💡 اقتراحات ({suggestions?.length ?? 0})</h2>
          {(suggestions ?? []).length === 0 ? (
            <p className="text-slate-400 text-sm">لا اقتراحات بعد.</p>
          ) : (
            <ul className="space-y-1">
              {(suggestions ?? []).map((s: any) => (
                <li key={s.id} className="text-slate-700 text-sm border-t border-slate-100 pt-1">
                  ➕ <span className="font-semibold">{s.name}</span>{s.note ? <span className="text-slate-400"> — {s.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-bold text-slate-800 mb-2">💬 كلمات مجهولة ({comments?.length ?? 0})</h2>
          {(comments ?? []).length === 0 ? (
            <p className="text-slate-400 text-sm">لا تعليقات بعد.</p>
          ) : (
            <ul className="space-y-2">
              {(comments ?? []).map((c: any) => (
                <li key={c.id} className="text-slate-700 text-sm bg-slate-50 rounded-xl px-3 py-2">🫥 {c.body}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
