"use client";

// اليوم hub — opened from the 🔥 streak chip in حسابي. Everything shown here
// is REAL state: the user's user_streaks row, whether a check-in exists today,
// and (only if friendships exist) friends' actual streaks read under the
// friends-visible RLS policy. No fake leaderboards, no invented urgency.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { arNum, avatarColor, friendlyName, liveStreak, utcDateStr } from "@/lib/social/format";

export type StreakData = {
  current: number;
  longest: number;
  lastActive: string | null; // YYYY-MM-DD (UTC — matches create_checkin)
  freezes: number;
};

type FriendStreak = {
  id: string;
  name: string;
  emoji: string | null;
  current: number;
  lastActive: string | null;
};

const DAY_LABELS = ["أحد", "إثن", "ثلا", "أرب", "خمي", "جمع", "سبت"];
const DAY_MS = 86_400_000;

export default function StreakHub({
  streak,
  todayDone,
  planHref,
  onClose,
}: {
  streak: StreakData;
  /** True when a check-in exists today (the daily quest). */
  todayDone: boolean;
  planHref: string;
  onClose: () => void;
}) {
  const [friends, setFriends] = useState<FriendStreak[] | null>(null);

  // Friends' streaks — only fetched here, only shown when real friends exist.
  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createClient();
      const { data: list, error } = await supabase.rpc("my_friends");
      if (!alive) return;
      if (error || !list || list.length === 0) { setFriends([]); return; }
      const ids = list.map((f: { id: string }) => f.id);
      const { data: rows } = await supabase
        .from("user_streaks")
        .select("user_id, current_streak, last_active")
        .in("user_id", ids);
      if (!alive) return;
      const byId = new Map<string, { current_streak: number; last_active: string | null }>(
        (rows ?? []).map((r: { user_id: string; current_streak: number; last_active: string | null }) => [r.user_id, r]),
      );
      setFriends(
        list
          .map((f: { id: string; display_name: string | null; username: string | null; avatar_emoji: string | null }) => {
            const s = byId.get(f.id);
            return {
              id: f.id,
              name: friendlyName(f.display_name, f.username),
              emoji: f.avatar_emoji,
              current: liveStreak(s?.current_streak ?? 0, s?.last_active ?? null),
              lastActive: s?.last_active ?? null,
            };
          })
          .sort((a: FriendStreak, b: FriendStreak) => b.current - a.current),
      );
    })();
    return () => { alive = false; };
  }, []);

  const today = utcDateStr();
  const liveCurrent = liveStreak(streak.current, streak.lastActive);

  // 7-day flame calendar ending today, derived from last_active + streak span.
  const days = useMemo(() => {
    const out: { label: string; date: string; lit: boolean; isToday: boolean }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * DAY_MS);
      const ds = utcDateStr(d);
      out.push({
        label: DAY_LABELS[d.getUTCDay()],
        date: ds,
        lit: isActiveDay(ds, streak.lastActive, streak.current),
        isToday: ds === today,
      });
    }
    return out;
  }, [streak.lastActive, streak.current, today]);

  return (
    <div
      className="fixed inset-0 z-[1500] bg-black/50 animate-backdrop-fade flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="سلسلتك اليومية"
    >
      <div
        className="w-full max-w-lg bg-card rounded-t-3xl sm:rounded-3xl px-5 pt-3 shadow-[0_-12px_40px_rgba(0,0,0,0.3)] animate-sheet-up max-h-[88dvh] overflow-y-auto overscroll-contain"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)" }}
      >
        <div className="w-9 h-[5px] bg-ink/30 rounded-full mx-auto mb-4" />

        {/* Personal streak */}
        <div className="text-center">
          <div className="text-[44px] leading-none" aria-hidden="true">🔥</div>
          <div className="font-extrabold text-[28px] text-ink mt-1">
            {arNum(liveCurrent)} <span className="text-[15px]">{liveCurrent === 1 ? "يوم" : "أيام"}</span>
          </div>
          <div className="text-[12.5px] text-muted mt-0.5">
            {liveCurrent > 0
              ? todayDone
                ? "سلسلتك مستمرة — سجّلت اليوم ✓"
                : "سجّل حضورك اليوم لتحافظ عليها"
              : "ابدأ سلسلتك بتسجيل حضور اليوم"}
          </div>
        </div>

        {/* 7-day flame calendar */}
        <div className="mt-5 bg-sand rounded-2xl border border-line p-3.5">
          <div className="grid grid-cols-7 gap-1" role="list" aria-label="آخر ٧ أيام">
            {days.map((d) => (
              <div key={d.date} role="listitem" className="flex flex-col items-center gap-1.5">
                <span className="text-[10px] font-bold text-muted">{d.label}</span>
                <span
                  className={`w-9 h-9 grid place-items-center rounded-full text-[16px] ${
                    d.lit ? "bg-coral/15" : "bg-card border border-line"
                  } ${d.isToday ? "ring-2 ring-sea" : ""}`}
                  aria-label={d.lit ? "يوم نشط" : "يوم بلا نشاط"}
                >
                  {d.lit ? "🔥" : <span className="text-line">·</span>}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-line">
            <span className="text-[12px] text-muted font-bold">أطول سلسلة: {arNum(streak.longest)} {streak.longest === 1 ? "يوم" : "أيام"}</span>
            <span className="text-[12px] text-muted font-bold inline-flex items-center gap-1">
              <span aria-hidden="true">❄️</span> رصيد التجميد: {arNum(streak.freezes)}
            </span>
          </div>
        </div>

        {/* Daily quest — one honest contextual task */}
        <h3 className="text-[12.5px] font-extrabold text-ink mt-5 mb-2">مهمة اليوم</h3>
        <div className={`rounded-2xl border p-4 flex items-center gap-3 ${todayDone ? "bg-ok/10 border-ok/40" : "bg-card border-line shadow-sm"}`}>
          <span className="text-[26px]" aria-hidden="true">{todayDone ? "✅" : "📍"}</span>
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-[13.5px] text-ink">سجّل حضورك في مكان اليوم</div>
            <div className="text-[11.5px] text-muted mt-0.5">
              {todayDone ? "أنجزتها — حافظت على شرارتك 🔥" : "حضور واحد يبقي سلسلتك حيّة ويكسبك نقاط"}
            </div>
          </div>
          {!todayDone && (
            <Link
              href={planHref}
              className="shrink-0 min-h-[44px] px-4 inline-flex items-center rounded-pill bg-gradient-to-br from-coral to-coral-600 text-white text-[12.5px] font-extrabold shadow-btn active:scale-95 transition"
            >
              الخريطة
            </Link>
          )}
        </div>

        {/* Friends' streaks — real data only, honest empty state */}
        <h3 className="text-[12.5px] font-extrabold text-ink mt-5 mb-2">سلاسل أصدقائك</h3>
        {friends === null ? (
          <div className="h-[52px] rounded-2xl skeleton-shimmer" aria-hidden="true" />
        ) : friends.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-sand p-4 text-center">
            <div className="text-[13px] font-bold text-ink">ما عندك أصدقاء بعد</div>
            <div className="text-[11.5px] text-muted mt-0.5">أضف أصدقاءك من حسابي وتنافسوا على أطول سلسلة</div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {friends.map((f) => (
              <div key={f.id} className="flex items-center gap-3 bg-card border border-line rounded-2xl px-3.5 py-2.5">
                <span
                  className="w-9 h-9 rounded-full grid place-items-center text-[16px] text-white font-extrabold shrink-0"
                  style={{ backgroundColor: avatarColor(f.id) }}
                  aria-hidden="true"
                >
                  {f.emoji ?? f.name.charAt(0)}
                </span>
                <span className="flex-1 min-w-0 font-bold text-[13.5px] text-ink truncate">{f.name}</span>
                <span className="text-[13px] font-extrabold text-ink inline-flex items-center gap-1">
                  <span aria-hidden="true">🔥</span> {arNum(f.current)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Was `dateStr` inside the recorded streak window ending at last_active? */
function isActiveDay(dateStr: string, lastActive: string | null, current: number): boolean {
  if (!lastActive || current <= 0) return false;
  const d = Date.parse(dateStr);
  const last = Date.parse(lastActive);
  const first = last - (current - 1) * DAY_MS;
  return d >= first && d <= last;
}
