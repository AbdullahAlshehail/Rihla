"use client";

// 📍 أماكني — city-coverage profile built from REAL activity only:
// check-ins, saved places, and personal ratings vs the places catalogue.
// No fake districts, no invented numbers — empty sections encourage instead.

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Bookmark, Star, X as XIcon, MapPinned, Compass } from "lucide-react";
import {
  computeBadges, TIER_LABELS, TIER_EMOJI,
  type MyPlacesData, type CityAgg, type EngagedPlace, type BadgeState,
} from "@/lib/places/myPlaces";
import { getCategoryDisplay } from "@/lib/highlights";
import { CategoryIcon } from "@/lib/ui/icons";

// One accent: sea is the structural fill for progress/taste bars (matches the
// CityTile bar). Categories are distinguished by their lucide icon, not a hue.
const CAT_SHORT: Record<string, string> = {
  food: "مطاعم", coffee: "قهاوي", sight: "معالم", nature: "طبيعة",
  sweet: "حلويات", event: "ترفيه", bar: "بار",
};

export default function MyPlacesScreen({ data, planHref }: { data: MyPlacesData; planHref?: string }) {
  const [openCity, setOpenCity] = useState<CityAgg | null>(null);
  const [openBadge, setOpenBadge] = useState<BadgeState | null>(null);

  const hero = data.cities[0] ?? null;
  const badges = computeBadges(data.stats);
  const earned = badges.filter((b) => b.earnedTier > 0).length;
  const mapHref = planHref ?? "/plan";

  return (
    <main className="max-w-2xl mx-auto px-4 pt-3 pb-28">
      {/* ── Coverage hero — dark gradient card + conic % ring ─────────── */}
      {hero ? (
        <CoverageCard city={hero} />
      ) : (
        <section
          className="rounded-3xl overflow-hidden relative shadow-[0_14px_32px_var(--elev2)]"
          style={{ background: "linear-gradient(160deg,#0b4a62,#15252b 78%)" }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(150px 130px at 90% 6%,rgba(224,101,74,.35),transparent)" }}
          />
          <div className="relative p-5 text-center">
            <Compass size={34} className="mx-auto text-[#e0b657]" aria-hidden="true" />
            <h2 className="text-white font-extrabold text-[17px] mt-2">ما بدأت تستكشف بعد</h2>
            <p className="text-white/75 text-[12.5px] mt-1 leading-relaxed">
              سجّل حضورك في أول مكان تزوره — وشوف استكشافك يكبر هنا 🧭
            </p>
            <Link
              href={mapHref}
              className="inline-flex items-center gap-1.5 mt-4 min-h-[44px] px-5 rounded-pill bg-coral text-white font-extrabold text-[13px] shadow-btn active:translate-y-px active:shadow-btn-press transition-all"
            >
              <MapPinned size={16} aria-hidden="true" /> افتح الخريطة
            </Link>
          </div>
        </section>
      )}

      {/* ── City coverage grid ────────────────────────────────────────── */}
      {(data.cities.length > 0 || data.teasers.length > 0) && (
        <section className="mt-4">
          <h2 className="text-[14px] font-extrabold text-ink mb-2.5 px-0.5">مدنك</h2>
          <div className="grid grid-cols-2 gap-2.5">
            {data.cities.map((c) => (
              <CityTile key={c.key} city={c} onOpen={() => setOpenCity(c)} />
            ))}
            {data.teasers.map((t) => (
              <div
                key={t.key}
                className="border-2 border-dashed border-line rounded-2xl p-3.5 min-h-[104px] flex flex-col justify-center"
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[18px] leading-none" aria-hidden="true">{t.flag}</span>
                  <span className="font-extrabold text-muted text-[13.5px]">{t.label}</span>
                </div>
                <div className="text-[11px] text-muted font-bold mt-1.5">لم تستكشفها بعد 🔒</div>
                <div className="text-[10.5px] text-muted mt-0.5 tabular-nums">{t.total} مكان بانتظارك</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Stats row ─────────────────────────────────────────────────── */}
      <section className="grid grid-cols-3 gap-2.5 mt-4" aria-label="إحصائياتك">
        <StatTile n={data.stats.places} label="مكان زرته" tone="text-sea" />
        <StatTile n={data.stats.cities} label="مدينة" tone="text-coral-600" />
        <StatTile n={data.stats.countries} label="دولة" tone="text-gold" />
      </section>

      {/* ── Taste chart ───────────────────────────────────────────────── */}
      <section className="mt-4 bg-card border border-line rounded-2xl p-4 shadow-[0_4px_12px_var(--elev)]">
        <h2 className="text-[14px] font-extrabold text-ink mb-3.5">تذوّقك حسب التصنيف</h2>
        {data.taste.length === 0 ? (
          <p className="text-[12.5px] text-muted leading-relaxed">
            سجّل حضورك أو قيّم أماكن — ويظهر ذوقك هنا حسب التصنيف ☕🍽
          </p>
        ) : (
          <div className="flex flex-col gap-3" role="list">
            {data.taste.map((t) => {
              const max = data.taste[0].count;
              const cat = getCategoryDisplay(t.cat);
              return (
                <div key={t.cat} role="listitem" className="flex items-center gap-2.5">
                  <span className="w-6 grid place-items-center text-muted shrink-0">
                    <CategoryIcon category={t.cat} className="w-4 h-4" />
                  </span>
                  <span className="text-[12.5px] text-ink font-bold w-14 shrink-0">
                    {CAT_SHORT[t.cat] ?? cat.ar}
                  </span>
                  <div className="flex-1 h-3.5 rounded-pill bg-sand overflow-hidden">
                    <div
                      className="h-full rounded-pill bg-sea"
                      style={{ width: `${Math.max(8, (t.count / max) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[12px] text-muted font-bold w-6 text-left tabular-nums">{t.count}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Badges rail ───────────────────────────────────────────────── */}
      <section className="mt-5">
        <div className="flex items-center justify-between mb-2.5 px-0.5">
          <h2 className="text-[14px] font-extrabold text-ink">أوسمتك</h2>
          <span className="text-[12px] text-gold font-extrabold tabular-nums">{earned}/{badges.length} 🏅</span>
        </div>
        <div className="flex gap-2.5 overflow-x-auto pb-1.5 -mx-4 px-4 scrollbar-thin">
          {badges.map((b) => (
            <BadgeCard key={b.def.key} badge={b} onOpen={() => setOpenBadge(b)} />
          ))}
        </div>
      </section>

      {openCity && <CitySheet city={openCity} onClose={() => setOpenCity(null)} />}
      {openBadge && <BadgeSheet badge={openBadge} onClose={() => setOpenBadge(null)} />}
    </main>
  );
}

// ─── Coverage hero card ───────────────────────────────────────────────
// «زرت X» counts VISITED places only (canonical: has a check-in) — the same
// definition behind the stat row and جوازي, so all numbers agree.
function CoverageCard({ city }: { city: CityAgg }) {
  const covered = city.visited;
  const total = Math.max(city.total, city.places.length);
  const pct = total > 0 ? Math.min(100, Math.round((covered / total) * 100)) : 0;
  return (
    <section
      className="rounded-3xl overflow-hidden relative shadow-[0_14px_32px_var(--elev2)]"
      aria-label={`استكشافك في ${city.label}`}
      style={{ background: "linear-gradient(160deg,#0b4a62,#15252b 78%)" }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(150px 130px at 90% 6%,rgba(224,101,74,.35),transparent)" }}
      />
      <div className="relative flex items-center gap-3.5 p-4">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center shrink-0"
          style={{ background: `conic-gradient(#e0b657 ${pct * 3.6}deg, rgba(255,255,255,.16) 0)` }}
          role="img"
          aria-label={`نسبة الاستكشاف ${pct}٪`}
        >
          <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "#0b3243" }}>
            <span className="text-white text-[14px] font-bold leading-none tabular-nums">{pct}٪</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-bold text-[16px]">استكشافك في {city.label}</h2>
          <p className="text-white/80 text-[12px] mt-1">
            زرت <span className="text-[#e0b657] font-bold tabular-nums">{covered}</span> من {total} مكان — واصل تكشف! 🧭
          </p>
        </div>
      </div>
    </section>
  );
}

// ─── City tile ────────────────────────────────────────────────────────
function CityTile({ city, onOpen }: { city: CityAgg; onOpen: () => void }) {
  const covered = city.visited; // visited = checked-in (canonical)
  const total = Math.max(city.total, city.places.length);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="bg-card border border-line rounded-2xl p-3.5 text-right min-h-[104px] flex flex-col justify-between active:scale-[0.97] hover:border-sea/40 transition shadow-[0_4px_12px_var(--elev)]"
    >
      <div className="flex items-center gap-1.5 w-full">
        <span className="text-[18px] leading-none" aria-hidden="true">{city.flag}</span>
        <span className="font-extrabold text-ink text-[13.5px] line-clamp-1">{city.label}</span>
      </div>
      <div className="w-full mt-2">
        <div className="text-[11.5px] font-bold text-ok tabular-nums">{covered} مكان ✓</div>
        <div className="h-1.5 bg-sand rounded-full overflow-hidden mt-1.5">
          <span className="block bg-sea h-full rounded-full" style={{ width: `${total > 0 ? (covered / total) * 100 : 0}%` }} />
        </div>
        <div className="text-[10px] text-muted font-bold mt-1 tabular-nums">من {total} في الكتالوج</div>
      </div>
    </button>
  );
}

// ─── Stat tile ────────────────────────────────────────────────────────
function StatTile({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="bg-card border border-line rounded-2xl py-3 text-center shadow-[0_4px_12px_var(--elev)]">
      <div className={`text-[24px] font-bold leading-none tabular-nums ${tone}`}>{n}</div>
      <div className="text-[11px] text-muted font-bold mt-1.5">{label}</div>
    </div>
  );
}

// ─── Badge card ───────────────────────────────────────────────────────
function BadgeCard({ badge, onOpen }: { badge: BadgeState; onOpen: () => void }) {
  const { def, value, earnedTier, next } = badge;
  const locked = earnedTier === 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="shrink-0 w-[118px] bg-card border border-line rounded-2xl p-3 text-center active:scale-95 transition shadow-[0_4px_12px_var(--elev)]"
      aria-label={`وسام ${def.name}${locked ? " — مقفل" : ` — ${TIER_LABELS[earnedTier - 1]}`}`}
    >
      <div
        className={`w-11 h-11 rounded-full mx-auto flex items-center justify-center text-[22px] ${
          locked ? "bg-sand border border-line grayscale opacity-60" : ""
        }`}
        style={locked ? undefined : { background: "linear-gradient(135deg,#e0b657,#bd8a1e)" }}
        aria-hidden="true"
      >
        {def.icon}
      </div>
      <div className="font-bold text-[12px] text-ink mt-2 truncate">{def.name}</div>
      {locked ? (
        <>
          <div className="h-[5px] rounded-pill bg-sand overflow-hidden mt-2">
            <span
              className="block h-full bg-gold rounded-pill"
              style={{ width: `${next ? Math.min(100, (value / next) * 100) : 0}%` }}
            />
          </div>
          <div className="text-[10px] text-muted font-bold mt-1 tabular-nums">{value}/{next}</div>
        </>
      ) : (
        <div className="text-[10px] text-gold font-extrabold mt-1.5">
          {TIER_EMOJI[earnedTier - 1]} {TIER_LABELS[earnedTier - 1]}
        </div>
      )}
    </button>
  );
}

// ─── Shared sheet chrome ──────────────────────────────────────────────
function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[1200] bg-black/45 flex items-end sm:items-center justify-center animate-backdrop-fade"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div
        className="bg-sand w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[88dvh] overflow-y-auto animate-sheet-up"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      >
        <div className="w-9 h-[5px] bg-ink/30 rounded-full mx-auto mt-3 mb-2" />
        {children}
      </div>
    </div>
  );
}

// ─── City sheet — the user's engaged places in one city ──────────────
function CitySheet({ city, onClose }: { city: CityAgg; onClose: () => void }) {
  const covered = city.visited; // visited = checked-in (canonical)
  const total = Math.max(city.total, city.places.length);
  const remaining = total - covered;
  return (
    <Sheet label={`أماكنك في ${city.label}`} onClose={onClose}>
      <div className="px-5 pb-3 flex items-center gap-2.5">
        <span className="text-[30px] leading-none" aria-hidden="true">{city.flag}</span>
        <div className="flex-1 min-w-0">
          <h2 className="font-extrabold text-ink text-[18px]">{city.label}</h2>
          <p className="text-[11.5px] text-muted font-bold mt-0.5 tabular-nums">زرت {covered} من {total} مكان</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          className="w-11 h-11 inline-flex items-center justify-center rounded-full bg-card border border-line active:scale-90 transition"
        >
          <XIcon size={16} className="text-ink" aria-hidden="true" />
        </button>
      </div>

      <div className="px-5 flex flex-col gap-2">
        {city.places.map((p) => <PlaceRow key={p.id} place={p} />)}
      </div>

      {remaining > 0 && (
        <p className="text-center text-[11.5px] text-muted font-bold mt-4 px-5 tabular-nums">
          باقي {remaining} مكان تكتشفه في {city.label} 🧭
        </p>
      )}
    </Sheet>
  );
}

function PlaceRow({ place }: { place: EngagedPlace }) {
  const cat = getCategoryDisplay(place.category);
  return (
    <div className="bg-card border border-line rounded-2xl px-3 py-2.5 flex items-center gap-2.5 min-h-[56px]">
      <span className="w-10 h-10 rounded-xl bg-sand flex items-center justify-center text-muted shrink-0" aria-hidden="true">
        <CategoryIcon category={place.category} className="w-5 h-5" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-ink text-[13.5px] line-clamp-1">{place.name}</div>
        <div className="text-[11px] text-muted font-bold mt-0.5 flex items-center gap-1.5">
          <span>{CAT_SHORT[place.category] ?? cat.ar}</span>
          {place.stars != null && (
            <span className="inline-flex items-center gap-0.5 text-gold">
              <Star size={11} fill="currentColor" aria-hidden="true" /> {place.stars}
            </span>
          )}
          {place.checkins > 1 && <span className="tabular-nums">· {place.checkins} زيارات</span>}
        </div>
      </div>
      <span className="inline-flex items-center gap-1 shrink-0">
        {place.checkins > 0 && (
          <CheckCircle2 size={18} className="text-ok" aria-label="سجّلت حضورك هنا" strokeWidth={2.5} />
        )}
        {place.saved && <Bookmark size={16} className="text-coral-600" fill="currentColor" aria-label="محفوظ" />}
      </span>
    </div>
  );
}

// ─── Badge detail sheet ───────────────────────────────────────────────
function BadgeSheet({ badge, onClose }: { badge: BadgeState; onClose: () => void }) {
  const { def, value, earnedTier } = badge;
  return (
    <Sheet label={`وسام ${def.name}`} onClose={onClose}>
      <div className="px-5 pb-4 text-center">
        <div
          className={`w-16 h-16 rounded-full mx-auto flex items-center justify-center text-[32px] ${
            earnedTier === 0 ? "bg-card border border-line grayscale opacity-70" : ""
          }`}
          style={earnedTier === 0 ? undefined : { background: "linear-gradient(135deg,#e0b657,#bd8a1e)" }}
          aria-hidden="true"
        >
          {def.icon}
        </div>
        <h2 className="font-extrabold text-ink text-[19px] mt-2.5">{def.name}</h2>
        <p className="text-[12px] text-muted mt-1">{def.desc}</p>
        <p className="text-[13px] font-extrabold text-sea mt-2 tabular-nums">رصيدك الآن: {value} {def.unit}</p>
      </div>

      <div className="px-5 flex flex-col gap-2">
        {def.tiers.map((need, i) => {
          const done = value >= need;
          return (
            <div
              key={need}
              className={`rounded-2xl border px-3.5 py-3 flex items-center gap-3 ${
                done ? "bg-card border-gold/50" : "bg-card border-line"
              }`}
            >
              <span className="text-[22px] leading-none" aria-hidden="true">{TIER_EMOJI[i]}</span>
              <div className="flex-1 min-w-0">
                <div className="font-extrabold text-ink text-[13px]">{TIER_LABELS[i]}</div>
                <div className="text-[11px] text-muted font-bold tabular-nums">{need} {def.unit}</div>
              </div>
              {done ? (
                <CheckCircle2 size={20} className="text-ok" aria-label="محقّق" strokeWidth={2.5} />
              ) : (
                <span className="text-[11.5px] text-muted font-extrabold tabular-nums">{value}/{need}</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-5 pt-4">
        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[48px] rounded-xl bg-card border border-line text-ink font-extrabold text-[13.5px] active:scale-95 transition"
        >
          تم
        </button>
      </div>
    </Sheet>
  );
}
