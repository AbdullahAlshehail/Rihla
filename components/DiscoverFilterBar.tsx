"use client";

// Sticky filter bar for the "اكتشف" tab — Phase 2A redesign.
//
//   Row 1 (city)       — auto-derived, single-select (hidden when 1 city only)
//   Row 2 (category)   — مطاعم / قهاوي / حلويات / معالم / طبيعة / ترفيه / روف توب
//   Row 3 (quick)      — قريب من فندقك / مفتوح الآن / فاخر / اقتصادي / 4.5★+ /
//                        جوهرة مخفية / محفوظ
//   Sheet (فلاتر أكثر) — cuisines, meals, vibes, ميشلان, فاين داينينق,
//                        قهوة مختصة, اختيار محرر, 4.8★+, جديد
//
// The sheet inherits the same chip styling so toggling it back out feels
// continuous with the bar.

import { useMemo, useState } from "react";
import type { Place } from "@/lib/supabase/database.types";
import {
  applyFilters, countPerFilter,
  FILTER_GROUP,
  type DiscoverFilterId, type FilterContext, type FilterGroup,
} from "@/lib/discover/filters";

type Chip = {
  id: DiscoverFilterId;
  ar: string;
  emoji: string;
};

// Central chip registry — labels + emojis. Group membership lives in
// FILTER_GROUP (lib/discover/filters.ts) so adding a new chip = one edit.
const CHIP_LABEL: Record<DiscoverFilterId, { ar: string; emoji: string }> = {
  // categories
  cat_food:   { ar: "مطاعم",         emoji: "🍽" },
  cat_coffee: { ar: "قهاوي",         emoji: "☕" },
  cat_sweet:  { ar: "حلويات",        emoji: "🍰" },
  cat_sight:  { ar: "معالم",         emoji: "🏛" },
  cat_nature: { ar: "طبيعة",         emoji: "🌿" },
  cat_event:  { ar: "ترفيه وعروض",   emoji: "🎭" },
  cat_bar:    { ar: "بارات وروف توب", emoji: "🍸" },
  // quick
  near_hotel:   { ar: "قريب من فندقك",  emoji: "🏨" },
  near_user:    { ar: "قريب منك",        emoji: "📍" },
  popular:      { ar: "مشهور",           emoji: "⭐" },
  open_now:     { ar: "مفتوح الآن",     emoji: "🟢" },
  luxury:       { ar: "فاخر",            emoji: "💰" },
  budget:       { ar: "اقتصادي",         emoji: "💵" },
  rating_4_5:   { ar: "٤.٥★ فأعلى",    emoji: "⭐" },
  hidden_gem:   { ar: "جوهرة مخفية",   emoji: "💎" },
  saved:        { ar: "محفوظ",          emoji: "💝" },
  trending:     { ar: "ترند الآن",     emoji: "🔥" },
  // quality
  michelin:         { ar: "ميشلان",       emoji: "⭐" },
  fine_dining:      { ar: "فاين داينينق", emoji: "🎩" },
  specialty_coffee: { ar: "قهوة مختصة",  emoji: "☕" },
  editor_pick:      { ar: "اختيار محرّر", emoji: "✨" },
  highly_rated:     { ar: "٤.٨★ فأعلى",  emoji: "🌟" },
  new_spot:         { ar: "جديد",         emoji: "🆕" },
  // cuisines
  cuisine_italian:       { ar: "إيطالي",        emoji: "🇮🇹" },
  cuisine_french:        { ar: "فرنسي",          emoji: "🇫🇷" },
  cuisine_japanese:      { ar: "ياباني",         emoji: "🇯🇵" },
  cuisine_chinese:       { ar: "صيني",           emoji: "🇨🇳" },
  cuisine_korean:        { ar: "كوري",           emoji: "🇰🇷" },
  cuisine_thai:          { ar: "تايلندي",        emoji: "🇹🇭" },
  cuisine_indian:        { ar: "هندي",           emoji: "🇮🇳" },
  cuisine_lebanese:      { ar: "لبناني",         emoji: "🇱🇧" },
  cuisine_saudi:         { ar: "سعودي",          emoji: "🇸🇦" },
  cuisine_yemeni:        { ar: "يمني",           emoji: "🇾🇪" },
  cuisine_turkish:       { ar: "تركي",           emoji: "🇹🇷" },
  cuisine_greek:         { ar: "يوناني",         emoji: "🇬🇷" },
  cuisine_mexican:       { ar: "مكسيكي",         emoji: "🇲🇽" },
  cuisine_peruvian:      { ar: "بيروفي",         emoji: "🇵🇪" },
  cuisine_british:       { ar: "بريطاني",        emoji: "🇬🇧" },
  cuisine_mediterranean: { ar: "متوسطي",         emoji: "🫒" },
  cuisine_seafood:       { ar: "مأكولات بحرية",  emoji: "🦞" },
  cuisine_steak:         { ar: "ستيك",           emoji: "🥩" },
  cuisine_pizza:         { ar: "بيتزا",          emoji: "🍕" },
  cuisine_burger:        { ar: "برغر",           emoji: "🍔" },
  cuisine_vegan:         { ar: "نباتي",          emoji: "🌱" },
  // meals
  meal_breakfast:  { ar: "فطور",   emoji: "🌅" },
  meal_brunch:     { ar: "برانش",  emoji: "🥐" },
  meal_lunch:      { ar: "غداء",   emoji: "🍽" },
  meal_snack:      { ar: "سناك",   emoji: "🥪" },
  meal_dinner:     { ar: "عشاء",   emoji: "🌙" },
  offers_pastry:   { ar: "بيستري", emoji: "🥐" },
  offers_dessert:  { ar: "حلى",    emoji: "🍰" },
  // vibes
  vibe_cultural:      { ar: "ثقافي",  emoji: "🧠" },
  vibe_active:        { ar: "حركي",   emoji: "🏃" },
  vibe_scenic:        { ar: "إطلالة", emoji: "🌅" },
  vibe_entertainment: { ar: "ترفيه",  emoji: "🎉" },
  vibe_shopping:      { ar: "تسوّق",   emoji: "🛍" },
};

function chipFor(id: DiscoverFilterId): Chip {
  const m = CHIP_LABEL[id];
  return { id, ar: m.ar, emoji: m.emoji };
}

// Pre-sorted IDs so chip order in each row is stable & deliberate.
const CATEGORY_IDS: DiscoverFilterId[] = [
  "cat_food", "cat_coffee", "cat_sweet", "cat_sight", "cat_nature", "cat_event", "cat_bar",
];
const QUICK_IDS: DiscoverFilterId[] = [
  "near_hotel", "open_now", "luxury", "budget", "rating_4_5", "hidden_gem", "saved",
];
const ADVANCED_QUALITY_IDS: DiscoverFilterId[] = [
  "michelin", "fine_dining", "specialty_coffee", "editor_pick", "highly_rated", "new_spot",
];

const ALL_IDS = (Object.keys(FILTER_GROUP) as DiscoverFilterId[]);

export default function DiscoverFilterBar({
  places,
  allPlaces,
  active,
  onChange,
  ctx,
  activeCity = null,
  onCityChange,
}: {
  places: Place[];
  allPlaces?: Place[];
  active: Set<DiscoverFilterId>;
  onChange: (next: Set<DiscoverFilterId>) => void;
  ctx: FilterContext;
  activeCity?: string | null;
  onCityChange?: (next: string | null) => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const cityRowSource = allPlaces ?? places;
  const counts = useMemo(
    () => countPerFilter(places, active, ctx, ALL_IDS),
    [places, active, ctx],
  );
  const matched = useMemo(
    () => applyFilters(places, active, ctx).length,
    [places, active, ctx],
  );

  function toggle(id: DiscoverFilterId) {
    const next = new Set(active);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  function clear() {
    onChange(new Set());
  }

  const hasActive = active.size > 0;
  const total = places.length;
  // Count of active filters tucked behind the "فلاتر أكثر" sheet — drives a
  // badge so the user knows advanced filters are on even when bar is collapsed.
  const advancedActiveCount = Array.from(active)
    .filter((id) => {
      const g = FILTER_GROUP[id];
      return g === "quality" || g === "cuisine" || g === "meal" || g === "vibe";
    }).length;

  const cityCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of cityRowSource) {
      const label = (p.city_label ?? p.city ?? "").trim();
      if (!label) continue;
      m.set(label, (m.get(label) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [cityRowSource]);
  const showCityRow = onCityChange != null && cityCounts.length >= 2;

  return (
    <>
      <div
        className="sticky top-0 z-10 bg-sand/95 backdrop-blur-sm -mx-4 px-4 pb-2 border-b border-line-soft"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 4px)" }}
      >
        {/* City row */}
        {showCityRow && (
          <div className="flex gap-2 overflow-x-auto pb-1.5 -mx-1 px-1 mt-1 scrollbar-thin snap-x snap-mandatory">
            <button
              onClick={() => onCityChange(null)}
              className={`shrink-0 snap-start px-3 py-2 rounded-pill text-[12px] font-bold border transition active:scale-95 flex items-center gap-1 min-h-[44px] ${
                activeCity == null
                  ? "bg-stone-900 text-white border-stone-900 shadow"
                  : "bg-white text-stone-800 border-stone-300 hover:border-stone-500"
              }`}
            >
              <span>🌍</span>
              <span>كل المدن</span>
              <span className={`text-[9.5px] ${activeCity == null ? "opacity-95" : "opacity-60"}`}>{cityRowSource.length}</span>
            </button>
            {cityCounts.map(([label, n]) => {
              const on = activeCity === label;
              return (
                <button
                  key={label}
                  onClick={() => onCityChange(on ? null : label)}
                  className={`shrink-0 snap-start px-3 py-2 rounded-pill text-[12px] font-bold border transition active:scale-95 flex items-center gap-1 min-h-[44px] ${
                    on
                      ? "bg-stone-900 text-white border-stone-900 shadow"
                      : "bg-white text-stone-800 border-stone-300 hover:border-stone-500"
                  }`}
                >
                  <span>📍</span>
                  <span>{label}</span>
                  <span className={`text-[9.5px] ${on ? "opacity-95" : "opacity-60"}`}>{n}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Row 2 — categories. Hide chips with 0 matches (unless already on). */}
        <Row
          chips={CATEGORY_IDS
            .map(chipFor)
            .filter((c) => (counts[c.id] ?? 0) > 0 || active.has(c.id))}
          active={active} counts={counts} onToggle={toggle} variant="category"
        />

        {/* Row 3 — quick essentials + "فلاتر أكثر" trigger */}
        <div className="flex items-center gap-2 mt-1">
          <div className="flex gap-2 overflow-x-auto pb-1.5 -mx-1 px-1 scrollbar-thin snap-x snap-mandatory flex-1">
            {QUICK_IDS
              .map(chipFor)
              .filter((c) => (counts[c.id] ?? 0) > 0 || active.has(c.id))
              .map((c) => (
                <ChipBtn key={c.id} chip={c} on={active.has(c.id)} n={counts[c.id] ?? 0} onToggle={toggle} variant="quality" />
              ))}
          </div>
          <button
            onClick={() => setSheetOpen(true)}
            className={`shrink-0 px-3 py-2 rounded-pill text-[12px] font-bold border transition active:scale-95 flex items-center gap-1 min-h-[44px] ${
              advancedActiveCount > 0
                ? "bg-sea text-white border-sea shadow"
                : "bg-white text-sea border-sky-200 hover:border-sea"
            }`}
          >
            <span>⚙</span>
            <span>فلاتر أكثر</span>
            {advancedActiveCount > 0 && (
              <span className="text-[9.5px] opacity-95">{advancedActiveCount}</span>
            )}
          </button>
        </div>

        {/* Result summary + clear */}
        <div className="flex items-center justify-between mt-1.5 text-[11px]">
          <span className="text-muted">
            {hasActive ? (
              <>
                <b className="text-ink">{matched}</b> من <b>{total}</b> مكان
              </>
            ) : (
              <>{total} مكان · رتّبها الفلتر</>
            )}
          </span>
          {hasActive && (
            <button
              onClick={clear}
              className="inline-flex items-center text-coral font-bold px-3 min-h-[44px] rounded-pill active:scale-95 transition"
            >
              ✕ مسح ({active.size})
            </button>
          )}
        </div>
      </div>

      {/* ─── More filters sheet ──────────────────────────────────────────── */}
      {sheetOpen && (
        <MoreFiltersSheet
          counts={counts}
          active={active}
          onToggle={toggle}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function ChipBtn({
  chip, on, n, onToggle, variant,
}: {
  chip: Chip;
  on: boolean;
  n: number;
  onToggle: (id: DiscoverFilterId) => void;
  variant: "category" | "quality" | "meal" | "vibe" | "cuisine";
}) {
  const disabled = !on && n === 0;
  const baseColor =
    variant === "category"
      ? on ? "bg-sea text-white border-sea shadow"
           : "bg-white text-sea border-sky-200 hover:border-sea"
      : variant === "meal"
      ? on ? "bg-amber-500 text-white border-amber-500 shadow"
           : "bg-white text-amber-800 border-amber-200 hover:border-amber-500"
      : variant === "vibe"
      ? on ? "bg-violet-500 text-white border-violet-500 shadow"
           : "bg-white text-violet-800 border-violet-200 hover:border-violet-500"
      : variant === "cuisine"
      ? on ? "bg-emerald-600 text-white border-emerald-600 shadow"
           : "bg-white text-emerald-800 border-emerald-200 hover:border-emerald-600"
      : on ? "bg-coral text-white border-coral shadow"
           : "bg-white text-stone-800 border-line hover:border-coral";
  return (
    <button
      onClick={() => onToggle(chip.id)}
      disabled={disabled}
      className={`shrink-0 snap-start px-3 py-2 rounded-pill text-[12px] font-bold border transition active:scale-95 disabled:opacity-35 disabled:cursor-not-allowed flex items-center gap-1 min-h-[44px] ${baseColor}`}
      title={`${chip.ar} · ${n} مكان`}
    >
      <span>{chip.emoji}</span>
      <span>{chip.ar}</span>
      <span className={`text-[9.5px] ${on ? "opacity-95" : "opacity-60"}`}>{n}</span>
    </button>
  );
}

function Row({
  chips, active, counts, onToggle, variant,
}: {
  chips: Chip[];
  active: Set<DiscoverFilterId>;
  counts: Record<string, number>;
  onToggle: (id: DiscoverFilterId) => void;
  variant: "category" | "quality" | "meal" | "vibe" | "cuisine";
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1.5 -mx-1 px-1 mt-1 scrollbar-thin snap-x snap-mandatory">
      {chips.map((c) => (
        <ChipBtn
          key={c.id}
          chip={c}
          on={active.has(c.id)}
          n={counts[c.id] ?? 0}
          onToggle={onToggle}
          variant={variant}
        />
      ))}
    </div>
  );
}

function Section({
  title,
  emoji,
  ids,
  counts,
  active,
  onToggle,
  variant,
}: {
  title: string;
  emoji: string;
  ids: DiscoverFilterId[];
  counts: Record<string, number>;
  active: Set<DiscoverFilterId>;
  onToggle: (id: DiscoverFilterId) => void;
  variant: "category" | "quality" | "meal" | "vibe" | "cuisine";
}) {
  const chips = ids
    .map(chipFor)
    .filter((c) => (counts[c.id] ?? 0) > 0 || active.has(c.id));
  if (chips.length === 0) return null;
  return (
    <section>
      <h3 className="text-[12.5px] font-extrabold text-ink mb-2 flex items-center gap-1.5">
        <span>{emoji}</span>
        <span>{title}</span>
      </h3>
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <ChipBtn
            key={c.id}
            chip={c}
            on={active.has(c.id)}
            n={counts[c.id] ?? 0}
            onToggle={onToggle}
            variant={variant}
          />
        ))}
      </div>
    </section>
  );
}

function MoreFiltersSheet({
  counts, active, onToggle, onClose,
}: {
  counts: Record<string, number>;
  active: Set<DiscoverFilterId>;
  onToggle: (id: DiscoverFilterId) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 grid items-end"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-sand rounded-t-3xl shadow-2xl border-t border-line max-h-[85vh] overflow-y-auto"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      >
        <div className="sticky top-0 bg-sand/95 backdrop-blur-sm border-b border-line-soft px-5 py-3 flex items-center justify-between">
          <h2 className="font-serif font-extrabold text-lg text-ink">⚙ فلاتر أكثر</h2>
          <button
            onClick={onClose}
            className="bg-white border border-line text-muted font-bold text-[12px] px-3 min-h-[44px] rounded-pill active:scale-95"
          >
            ✕ إغلاق
          </button>
        </div>

        <div className="p-5 space-y-5">
          <Section
            title="جودة وتنسيق"
            emoji="⭐"
            ids={ADVANCED_QUALITY_IDS}
            counts={counts}
            active={active}
            onToggle={onToggle}
            variant="quality"
          />
          <Section
            title="مطابخ"
            emoji="🌍"
            ids={(Object.keys(FILTER_GROUP) as DiscoverFilterId[]).filter((id) => FILTER_GROUP[id] === "cuisine")}
            counts={counts}
            active={active}
            onToggle={onToggle}
            variant="cuisine"
          />
          <Section
            title="أوقات وعروض"
            emoji="🍽"
            ids={(Object.keys(FILTER_GROUP) as DiscoverFilterId[]).filter((id) => FILTER_GROUP[id] === "meal")}
            counts={counts}
            active={active}
            onToggle={onToggle}
            variant="meal"
          />
          <Section
            title="أجواء"
            emoji="🎭"
            ids={(Object.keys(FILTER_GROUP) as DiscoverFilterId[]).filter((id) => FILTER_GROUP[id] === "vibe")}
            counts={counts}
            active={active}
            onToggle={onToggle}
            variant="vibe"
          />
        </div>
      </div>
    </div>
  );
}
