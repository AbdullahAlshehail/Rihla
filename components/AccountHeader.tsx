"use client";

// حسابي — gradient profile header (design ref: 04-account.png). Shows the
// avatar, name, tier line ("مسافر منذ {year} · {tierLabel}"), the stat row
// (دولة / مدينة / رحلة / نقطة) and the 🔥 streak chip that opens StreakHub.
// The pencil opens EditProfileSheet (username / avatar / display name).

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { arNum, liveStreak, tierFromCoins } from "@/lib/social/format";
import EditProfileSheet from "@/components/EditProfileSheet";
import StreakHub, { type StreakData } from "@/components/StreakHub";

export default function AccountHeader({
  userId,
  name,
  username,
  avatarEmoji,
  memberYear,
  coins,
  countries,
  cities,
  trips,
  streak,
  todayDone,
  planHref,
}: {
  userId: string;
  name: string;
  username: string | null;
  avatarEmoji: string | null;
  memberYear: number;
  coins: number;
  countries: number;
  cities: number;
  trips: number;
  streak: StreakData;
  todayDone: boolean;
  planHref: string;
}) {
  const [editing, setEditing] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const tier = tierFromCoins(coins);

  // FriendsSection's "set a username" hint opens this sheet via a tiny event
  // bridge — avoids lifting the sheet into a page-wide client wrapper.
  useEffect(() => {
    const open = () => setEditing(true);
    window.addEventListener("rihla:edit-profile", open);
    return () => window.removeEventListener("rihla:edit-profile", open);
  }, []);

  return (
    <>
      <section
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sea to-sea-600 text-white p-5 shadow-lg"
        aria-label="ملفي الشخصي"
      >
        {/* Soft radial glows (design: gradient header with warm accent) */}
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(140px 140px at 12% -10%, rgba(224,182,87,.35), transparent), radial-gradient(180px 180px at 95% 110%, rgba(224,101,74,.25), transparent)",
          }}
        />

        {/* Top row: streak chip (start) + edit (end) */}
        <div className="relative flex items-center justify-between">
          <button
            onClick={() => setHubOpen(true)}
            className={`inline-flex items-center gap-1 min-h-[36px] px-3 rounded-pill text-[13px] font-extrabold active:scale-95 transition ${
              todayDone
                ? "bg-gradient-to-br from-coral to-coral-600 text-white shadow-btn"
                : "bg-white/15 text-white"
            }`}
            aria-label={`سلسلتك اليومية: ${arNum(liveStreak(streak.current, streak.lastActive))} أيام`}
          >
            <span aria-hidden="true">🔥</span>
            <span>{arNum(liveStreak(streak.current, streak.lastActive))}</span>
          </button>
          <button
            onClick={() => setEditing(true)}
            className="w-10 h-10 grid place-items-center rounded-full bg-white/15 active:scale-90 transition"
            aria-label="تعديل ملفي"
          >
            <Pencil size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Identity */}
        <div className="relative flex items-center gap-3.5 mt-3">
          <div
            className="w-[64px] h-[64px] rounded-full bg-gradient-to-br from-gold-400 to-gold grid place-items-center text-[28px] font-extrabold text-sea-700 border-2 border-white/60 shrink-0"
            aria-hidden="true"
          >
            {avatarEmoji ?? name.charAt(0)}
          </div>
          <div className="min-w-0">
            <h1 className="font-extrabold text-[20px] leading-tight truncate">{name}</h1>
            <div className="text-[12.5px] text-white/80 mt-0.5">
              مسافر منذ {arNum(memberYear)} · {tier.label}
            </div>
            {username ? (
              <div className="text-[11.5px] text-white/60 mt-0.5" dir="ltr">@{username}</div>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="mt-1 inline-flex items-center min-h-[28px] px-2.5 rounded-pill bg-white/15 text-[11px] font-bold active:scale-95 transition"
              >
                حدّد اسم مستخدم ليلقونك أصدقاؤك ←
              </button>
            )}
          </div>
        </div>

        {/* Stats: دولة / مدينة / رحلة / نقطة */}
        <div className="relative grid grid-cols-4 mt-5 pt-4 border-t border-white/15">
          <Stat value={countries} label="دولة" />
          <Stat value={cities} label="مدينة" divider />
          <Stat value={trips} label="رحلة" divider />
          <Stat value={coins} label="نقطة 🪙" divider gold />
        </div>
      </section>

      {editing && (
        <EditProfileSheet
          userId={userId}
          initialName={name}
          initialUsername={username}
          initialEmoji={avatarEmoji}
          onClose={() => setEditing(false)}
        />
      )}
      {hubOpen && (
        <StreakHub
          streak={streak}
          todayDone={todayDone}
          planHref={planHref}
          onClose={() => setHubOpen(false)}
        />
      )}
    </>
  );
}

function Stat({ value, label, divider, gold }: { value: number; label: string; divider?: boolean; gold?: boolean }) {
  return (
    <div className={`text-center ${divider ? "border-r border-white/15" : ""}`}>
      <div className={`font-extrabold text-[20px] leading-none ${gold ? "text-gold-400" : "text-white"}`}>
        {arNum(value)}
      </div>
      <div className="text-[11px] text-white/75 mt-1 font-bold">{label}</div>
    </div>
  );
}
