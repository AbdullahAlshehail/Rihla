"use client";

// نشاط أصدقائك — live friend activity feed, fed by GET /api/feed (friends'
// real geofenced check-ins only). Every number shown (points, rating) comes
// from the actual check-in row; nothing is fabricated. Honest empty state.

import { useEffect, useState } from "react";
import type { FeedItem } from "@/app/api/feed/route";
import { arNum, avatarColor, friendlyName, timeAgoAr } from "@/lib/social/format";

const CAT_EMOJI: Record<string, string> = {
  food: "🍽", coffee: "☕", sight: "🏛", nature: "🌿",
  event: "🎭", sweet: "🍰", bar: "🍸",
};

export default function FriendFeed({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/feed");
        const data = await res.json().catch(() => null);
        if (!alive) return;
        if (res.ok && Array.isArray(data?.items)) setItems(data.items);
        else setError(true);
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey]);

  const hasLive =
    !!items?.some((i) => Date.now() - new Date(i.created_at).getTime() < 3_600_000);

  return (
    <section className="mt-6" aria-label="نشاط أصدقائك">
      <div className="flex items-center justify-between mb-2 px-1">
        <h2 className="font-extrabold text-[16px] text-ink">نشاط أصدقائك</h2>
        {hasLive && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-coral-600">
            <span className="relative flex w-2 h-2" aria-hidden="true">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-coral opacity-75" />
              <span className="relative inline-flex rounded-full w-2 h-2 bg-coral" />
            </span>
            مباشر
          </span>
        )}
      </div>

      {items === null && !error && (
        <div className="flex flex-col gap-2.5" aria-hidden="true">
          <div className="h-[88px] rounded-2xl skeleton-shimmer" />
          <div className="h-[88px] rounded-2xl skeleton-shimmer" />
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-line bg-card p-4 text-center text-[12.5px] text-muted font-bold">
          تعذّر تحميل النشاط — حدّث الصفحة وحاول مرة ثانية
        </div>
      )}

      {items?.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-card p-5 text-center">
          <div className="text-[28px] mb-1" aria-hidden="true">👋</div>
          <div className="font-extrabold text-[14px] text-ink">أضف أصدقاءك لتشوف نشاطهم</div>
          <div className="text-[12px] text-muted mt-1 leading-relaxed">
            حين يسجّل أصدقاؤك حضورهم في الأماكن، يظهر نشاطهم هنا مباشرة
          </div>
          <a
            href="#friends"
            className="inline-flex items-center min-h-[44px] px-5 mt-3 rounded-pill bg-gradient-to-br from-sea to-sea-600 text-white text-[13px] font-extrabold shadow-btn-sea active:scale-95 transition"
          >
            أضف صديق
          </a>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {items.map((item) => (
            <FeedCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function FeedCard({ item }: { item: FeedItem }) {
  const name = friendlyName(item.user.display_name, item.user.username);
  const emoji = item.place ? (CAT_EMOJI[item.place.category] ?? "✦") : "📍";
  return (
    <article className="bg-card border border-line rounded-2xl p-3.5 shadow-sm">
      <div className="flex items-start gap-3">
        <span
          className="w-11 h-11 rounded-full grid place-items-center text-[18px] text-white font-extrabold shrink-0"
          style={{ backgroundColor: avatarColor(item.user.id) }}
          aria-hidden="true"
        >
          {item.user.avatar_emoji ?? name.charAt(0)}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] text-ink leading-snug">
            <span className="font-extrabold">{name}</span>{" "}
            سجّل حضوره في{" "}
            <span className="font-extrabold text-coral-600">
              {item.place?.name ?? "مكان"}
            </span>
          </p>
          <p className="text-[11.5px] text-muted mt-0.5">
            {item.place?.city_label ? `${item.place.city_label} · ` : ""}
            {timeAgoAr(item.created_at)}
          </p>
          {item.shout && (
            <p className="text-[13px] text-ink mt-1.5 leading-relaxed">
              {item.shout} <span aria-hidden="true">{emoji}</span>
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-line-soft">
        {item.rating != null && (
          <span className="inline-flex items-center gap-1 text-[11.5px] font-extrabold text-gold">
            <span aria-hidden="true">★</span> {arNum(item.rating)}
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-[11.5px] font-extrabold text-gold">
          <span aria-hidden="true">🪙</span> +{arNum(item.points_awarded)}
        </span>
        {item.is_first_visit && (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-sea bg-sea/10 px-2 py-0.5 rounded-pill">
            أول زيارة 🎖
          </span>
        )}
      </div>
    </article>
  );
}
