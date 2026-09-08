"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getVoterId } from "@/lib/voting/voterId";

type Place = { name: string; category: string | null; photo_url: string | null };
type Item = { id: string; slot: string; position: number; places: Place | null };
type Day = { id: string; day_date: string; city: string | null; itinerary_items: Item[] };
type Suggestion = { id: string; name: string; note: string | null; created_at: string };
type Comment = { id: string; body: string; created_at: string };
type Board = {
  trip: { name: string; city: string | null; start_date: string | null; end_date: string | null };
  days: Day[];
  counts: Record<string, number>;
  myVotes: string[];
  suggestions: Suggestion[];
  comments: Comment[];
};

const SLOT_ORDER: Record<string, number> = { morning: 0, midday: 1, afternoon: 2, evening: 3, night: 4 };
const SLOT_AR: Record<string, string> = { morning: "الصباح", midday: "الظهر", afternoon: "العصر", evening: "المساء", night: "الليل" };
const DOW = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function dayLabel(d: string): string {
  const dt = new Date(d + "T00:00:00");
  return `${DOW[dt.getDay()]} ${dt.getDate()}/${dt.getMonth() + 1}`;
}

export default function VoteBoard({ token }: { token: string }) {
  const [voter, setVoter] = useState("");
  const [b, setB] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [sName, setSName] = useState("");
  const [sNote, setSNote] = useState("");
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => setVoter(getVoterId()), []);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/vote/${token}?voter=${voter}`, { cache: "no-store" });
      if (r.status === 404) { setErr("الرابط غير صحيح أو انتهى."); return; }
      const data: Board = await r.json();
      setB(data);
      setMine(new Set(data.myVotes));
    } catch { setErr("تعذّر التحميل، جرّب تحديث الصفحة."); }
  }, [token, voter]);

  useEffect(() => { if (voter) load(); }, [voter, load]);
  // Refetch when the tab regains focus (cheap near-realtime without polling).
  useEffect(() => {
    const on = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [load]);

  const post = (payload: object) =>
    fetch(`/api/vote/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

  const toggleVote = async (itemId: string) => {
    if (!voter || busy.has(itemId)) return;
    const has = mine.has(itemId);
    // optimistic
    setMine((p) => { const n = new Set(p); if (has) n.delete(itemId); else n.add(itemId); return n; });
    setB((p) => p && ({ ...p, counts: { ...p.counts, [itemId]: Math.max(0, (p.counts[itemId] ?? 0) + (has ? -1 : 1)) } }));
    setBusy((p) => new Set(p).add(itemId));
    try {
      await post({ kind: has ? "unvote" : "vote", voter_id: voter, itinerary_item_id: itemId });
    } finally {
      setBusy((p) => { const n = new Set(p); n.delete(itemId); return n; });
    }
  };

  const submitSuggest = async () => {
    if (sName.trim().length < 2 || sending) return;
    setSending(true);
    const r = await post({ kind: "suggest", voter_id: voter, name: sName.trim(), note: sNote.trim() || undefined });
    setSending(false);
    if (r.ok) { setSName(""); setSNote(""); load(); }
    else if (r.status === 429) setErr("وصلت الحد الأقصى للاقتراحات 🙈");
  };

  const submitComment = async () => {
    if (comment.trim().length < 2 || sending) return;
    setSending(true);
    const r = await post({ kind: "comment", voter_id: voter, body: comment.trim() });
    setSending(false);
    if (r.ok) { setComment(""); load(); }
    else if (r.status === 429) setErr("وصلت الحد الأقصى للتعليقات 🙈");
  };

  const maxCount = useMemo(() => Math.max(1, ...Object.values(b?.counts ?? {})), [b]);
  const topPicks = useMemo(() => {
    if (!b) return [];
    const items = b.days.flatMap((d) => d.itinerary_items);
    return items
      .map((it) => ({ it, c: b.counts[it.id] ?? 0 }))
      .filter((x) => x.c > 0)
      .sort((a, z) => z.c - a.c)
      .slice(0, 3);
  }, [b]);

  if (err && !b) return <Shell><p className="text-center text-white/80 mt-20">{err}</p></Shell>;
  if (!b) return <Shell><p className="text-center text-white/60 mt-20 animate-pulse">…جاري التحميل</p></Shell>;

  return (
    <Shell>
      <header className="text-center pt-6 pb-4">
        <div className="text-4xl mb-1">🗳️🔥</div>
        <h1 className="text-2xl font-extrabold text-white">{b.trip.name}</h1>
        <p className="text-white/70 text-sm mt-1">وش أكثر مكان يحمّسكم؟ صوّتوا واقترحوا 👇</p>
        <p className="text-white/50 text-xs mt-1">تصويتكم يوجّهنا — بس القرار النهائي للمنظّم 😉</p>
      </header>

      {topPicks.length > 0 && (
        <section className="mb-5 rounded-2xl bg-white/10 backdrop-blur p-4 border border-white/10">
          <h2 className="text-white font-bold text-sm mb-2">🏆 الأكثر حماساً</h2>
          <ol className="space-y-1">
            {topPicks.map((x, i) => (
              <li key={x.it.id} className="flex items-center gap-2 text-white/90 text-sm">
                <span>{["🥇", "🥈", "🥉"][i]}</span>
                <span className="flex-1 truncate">{x.it.places?.name}</span>
                <span className="font-bold">{x.c} 🔥</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {b.days.map((d, di) => {
        const items = [...d.itinerary_items].sort(
          (a, z) => (SLOT_ORDER[a.slot] ?? 9) - (SLOT_ORDER[z.slot] ?? 9) || a.position - z.position
        );
        return (
          <section key={d.id} className="mb-5">
            <h2 className="text-white font-bold mb-2 flex items-center gap-2">
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">اليوم {di + 1}</span>
              <span className="text-white/70 text-xs font-normal">{dayLabel(d.day_date)}{d.city ? ` · ${d.city}` : ""}</span>
            </h2>
            <div className="space-y-2">
              {items.map((it) => {
                const c = b.counts[it.id] ?? 0;
                const voted = mine.has(it.id);
                return (
                  <button
                    key={it.id}
                    onClick={() => toggleVote(it.id)}
                    className={`w-full text-right rounded-2xl overflow-hidden border transition active:scale-[0.98] ${
                      voted ? "border-orange-400 bg-orange-500/20" : "border-white/10 bg-white/5"
                    }`}
                  >
                    <div className="flex items-stretch gap-3 p-2">
                      <div
                        className="h-16 w-16 shrink-0 rounded-xl bg-cover bg-center bg-white/10"
                        style={it.places?.photo_url ? { backgroundImage: `url(${it.places.photo_url})` } : undefined}
                      />
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <p className="text-white font-semibold truncate">{it.places?.name ?? "—"}</p>
                        <p className="text-white/50 text-xs">{SLOT_AR[it.slot] ?? it.slot}</p>
                        <div className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full bg-gradient-to-l from-orange-400 to-pink-500" style={{ width: `${(c / maxCount) * 100}%` }} />
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-center justify-center w-12">
                        <span className={`text-xl ${voted ? "" : "grayscale opacity-60"}`}>🔥</span>
                        <span className="text-white font-bold text-sm">{c}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Suggest a place */}
      <section className="mb-5 rounded-2xl bg-white/10 p-4 border border-white/10">
        <h2 className="text-white font-bold text-sm mb-2">💡 اقترح مكان زيادة</h2>
        <input
          value={sName} onChange={(e) => setSName(e.target.value)} maxLength={80}
          placeholder="اسم المكان…"
          className="w-full rounded-xl bg-white/10 text-white placeholder-white/40 px-3 py-2 text-sm mb-2 outline-none focus:ring-2 ring-orange-400"
        />
        <input
          value={sNote} onChange={(e) => setSNote(e.target.value)} maxLength={200}
          placeholder="ليش؟ (اختياري)"
          className="w-full rounded-xl bg-white/10 text-white placeholder-white/40 px-3 py-2 text-sm mb-2 outline-none focus:ring-2 ring-orange-400"
        />
        <button onClick={submitSuggest} disabled={sending || sName.trim().length < 2}
          className="w-full rounded-xl bg-orange-500 disabled:opacity-40 text-white font-bold py-2 text-sm active:scale-95 transition">
          أرسل الاقتراح
        </button>
        {b.suggestions.length > 0 && (
          <ul className="mt-3 space-y-1">
            {b.suggestions.map((s) => (
              <li key={s.id} className="text-white/85 text-sm border-t border-white/10 pt-1">
                ➕ <span className="font-semibold">{s.name}</span>{s.note ? <span className="text-white/50"> — {s.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Anonymous comments */}
      <section className="mb-10 rounded-2xl bg-white/10 p-4 border border-white/10">
        <h2 className="text-white font-bold text-sm mb-1">💬 كلمة مجهولة</h2>
        <p className="text-white/40 text-xs mb-2">أحد ما يعرف مين كتبها 🤫</p>
        <textarea
          value={comment} onChange={(e) => setComment(e.target.value)} maxLength={300} rows={2}
          placeholder="اكتب أي شي…"
          className="w-full rounded-xl bg-white/10 text-white placeholder-white/40 px-3 py-2 text-sm mb-2 outline-none focus:ring-2 ring-orange-400 resize-none"
        />
        <button onClick={submitComment} disabled={sending || comment.trim().length < 2}
          className="w-full rounded-xl bg-white/20 disabled:opacity-40 text-white font-bold py-2 text-sm active:scale-95 transition">
          أرسل
        </button>
        <ul className="mt-3 space-y-2">
          {b.comments.map((c) => (
            <li key={c.id} className="text-white/90 text-sm bg-white/5 rounded-xl px-3 py-2">🫥 {c.body}</li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main dir="rtl" className="min-h-screen bg-gradient-to-b from-indigo-900 via-purple-900 to-slate-900">
      <div className="mx-auto max-w-md px-4 pb-8">{children}</div>
    </main>
  );
}
