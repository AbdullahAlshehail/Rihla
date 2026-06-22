// Transparent 0–100 smart score with Arabic reasoning.
// Every input contributes a documented number of points. Total clamped 0–100.
// The same function returns the breakdown so the UI can show "ليش هذا الاقتراح؟".

import type { Place, BudgetStyle } from "@/lib/supabase/database.types";
import { isOpenNow, haversineKm, estimateTravelTimes } from "@/lib/utils";
import type { UserTaste } from "@/lib/scoring/userTaste";

export type ScoreContext = {
  now?: Date;
  userLocation?: { lat: number; lng: number } | null;
  hotelLocation?: { lat: number; lng: number } | null;
  budgetStyle?: BudgetStyle;
  userRating?: number | null;       // 1..5 stars from user_place_ratings
  userVerdict?: "love" | "meh" | "skip" | null;
  userSaved?: boolean;
  preferredCategories?: string[];   // from trip.preferences.categories
  userTaste?: UserTaste | null;     // derived from history
};

export type ScorePart = { label: string; points: number; tone: "good" | "neut" | "warn" | "bad" };

export type ScoreResult = {
  score: number;          // 0–100
  reasonAr: string;       // ≤ 1 sentence Arabic summary
  parts: ScorePart[];     // human-readable breakdown
};

export function computeSmartScore(place: Place, ctx: ScoreContext = {}): ScoreResult {
  const parts: ScorePart[] = [];
  let s = 50; // baseline

  // 1) Google rating (max +22 / -12) — heaviest factor; this IS the review signal
  if (place.rating != null) {
    const r = place.rating;
    // 4.0 = 6pts, 4.3 = 10pts, 4.5 = 14pts, 4.7 = 18pts, 4.9 = 22pts
    const pts = Math.round(Math.max(-12, Math.min(22, (r - 3.5) * 14)));
    if (pts !== 0) {
      parts.push({
        label: `★ تقييم ${r.toFixed(1)}`,
        points: pts,
        tone: pts > 0 ? "good" : "bad",
      });
      s += pts;
    }
  }

  // 2) Review-count trust (max +10 / -6) — establishes how reliable the rating is
  if (place.review_count != null) {
    const c = place.review_count;
    const pts = c >= 10000 ? 10
      : c >= 3000 ? 8
      : c >= 1000 ? 6
      : c >= 300 ? 4
      : c >= 100 ? 2
      : c >= 30 ? 0
      : -6; // <30 reviews = unreliable
    if (pts !== 0) {
      parts.push({
        label: c >= 1000 ? `${(c / 1000).toFixed(1)}k مراجعة` : `${c.toLocaleString("en")} مراجعة`,
        points: pts,
        tone: pts > 0 ? "good" : "warn",
      });
      s += pts;
    }
  }

  // 2b) Has AI-summarized reviews → +1 (small bump; rating already counts)
  if ((place as Place & { ai_summary?: string | null }).ai_summary) {
    parts.push({ label: "ملخص ذكي متوفر", points: 1, tone: "good" });
    s += 1;
  }

  // 3) Open now (max +8 / -10)
  const status = isOpenNow(place.opening_hours, ctx.now);
  if (status.kind === "open") {
    parts.push({ label: "مفتوح الآن", points: 8, tone: "good" });
    s += 8;
  } else if (status.kind === "shut") {
    parts.push({ label: "مغلق الآن", points: -10, tone: "bad" });
    s -= 10;
  }

  // 4) Distance from current location (max +6 / -5)
  //    Capped so distance can't outweigh the 22-pt rating signal.
  if (ctx.userLocation && place.lat != null && place.lng != null) {
    const km = haversineKm(ctx.userLocation, { lat: place.lat, lng: place.lng });
    const { driveMin } = estimateTravelTimes(km);
    let pts = 0;
    if (km < 1) pts = 6;
    else if (km < 3) pts = 4;
    else if (km < 8) pts = 2;
    else if (km < 20) pts = -1;
    else pts = -5;
    parts.push({
      label: `قريب منك (~${driveMin}د)`,
      points: pts,
      tone: pts >= 2 ? "good" : pts >= 0 ? "neut" : "warn",
    });
    s += pts;
  }

  // 5) Distance from hotel (max +4 / -4)
  if (ctx.hotelLocation && place.lat != null && place.lng != null) {
    const km = haversineKm(ctx.hotelLocation, { lat: place.lat, lng: place.lng });
    let pts = 0;
    if (km < 2) pts = 4;
    else if (km < 8) pts = 2;
    else if (km < 20) pts = 0;
    else pts = -4;
    if (pts !== 0) {
      parts.push({
        label: pts > 0 ? "قريب من فندقك" : "بعيد عن فندقك",
        points: pts,
        tone: pts > 0 ? "good" : "warn",
      });
      s += pts;
    }
  }

  // 6) Editor pick (+4)
  if (place.is_editor_pick) {
    parts.push({ label: "اختيار محرّر", points: 4, tone: "good" });
    s += 4;
  }

  // 7) Budget match (max +6 / -6)
  if (ctx.budgetStyle && place.price_level != null) {
    const expected = ctx.budgetStyle === "economical" ? 1 : ctx.budgetStyle === "mid" ? 2 : 3;
    const diff = Math.abs(place.price_level - expected);
    const pts: number = diff === 0 ? 6 : diff === 1 ? 2 : -6;
    parts.push({
      label: pts > 0 ? "مناسب لميزانيتك" : "أعلى من ميزانيتك",
      points: pts,
      tone: pts > 0 ? "good" : "warn",
    });
    s += pts;
  }

  // 8) User personalization (max +12 / -12)
  if (ctx.userRating != null) {
    const pts = ctx.userRating >= 4 ? 12 : ctx.userRating >= 3 ? 4 : -8;
    parts.push({
      label: `تقييمك السابق ${ctx.userRating}★`,
      points: pts,
      tone: pts > 0 ? "good" : "bad",
    });
    s += pts;
  }
  if (ctx.userVerdict === "love") { s += 5; parts.push({ label: "أحببته سابقاً", points: 5, tone: "good" }); }
  if (ctx.userVerdict === "skip") { s -= 15; parts.push({ label: "تجاوزته سابقاً", points: -15, tone: "bad" }); }
  if (ctx.userSaved) { s += 3; parts.push({ label: "في محفوظاتك", points: 3, tone: "good" }); }

  // 9) Category preference match (+5)
  if (ctx.preferredCategories?.length && ctx.preferredCategories.includes(place.category)) {
    s += 5;
    parts.push({ label: "ضمن اهتماماتك", points: 5, tone: "good" });
  }

  // 10) Hidden-gem bonus: high rating + smaller crowd
  if (
    place.rating != null && place.rating >= 4.6 &&
    place.review_count != null && place.review_count >= 80 && place.review_count <= 1500
  ) {
    s += 6;
    parts.push({ label: "💎 هيدن جيم", points: 6, tone: "good" });
  }

  // 11) Personal taste from history (max +12)
  // Only kicks in after user has built some history (affinityCount >= 3).
  // The category match here can double-count with the trip-level
  // preferredCategories above (each gives +5 for the same signal), so we
  // subtract that overlap so the combined ceiling stays sane (≤ +12).
  if (ctx.userTaste && ctx.userTaste.affinityCount >= 3) {
    let tasteBonus = 0;
    const reasons: string[] = [];
    const catIdx = ctx.userTaste.topCategories.indexOf(place.category);
    const alreadyCountedByPrefs =
      ctx.preferredCategories?.includes(place.category) ?? false;
    if (catIdx === 0 && !alreadyCountedByPrefs) {
      tasteBonus += 5; reasons.push("نوعك المفضّل");
    } else if (catIdx === 0) {
      tasteBonus += 2; reasons.push("نوعك المفضّل");
    } else if (catIdx > 0) {
      tasteBonus += 2;
    }
    if (place.kind && ctx.userTaste.topKinds.includes(place.kind)) {
      tasteBonus += 3;
      reasons.push("تشبه اختياراتك السابقة");
    }
    const placeHl = place.highlights ?? [];
    const hlMatch = placeHl.filter((h) => ctx.userTaste!.topHighlights.includes(h)).length;
    if (hlMatch > 0) tasteBonus += Math.min(4, hlMatch * 2);
    if (
      ctx.userTaste.preferredPriceLevel != null &&
      place.price_level != null &&
      Math.abs(place.price_level - ctx.userTaste.preferredPriceLevel) <= 1
    ) {
      tasteBonus += 2;
    }
    if (tasteBonus > 0) {
      parts.push({
        label: reasons[0] ? `🧠 ${reasons[0]}` : "🧠 يناسب ذوقك",
        points: tasteBonus,
        tone: "good",
      });
      s += tasteBonus;
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(s)));
  const reasonAr = buildReason(place, ctx, status, score);

  return { score, reasonAr, parts };
}

function buildReason(
  place: Place,
  ctx: ScoreContext,
  status: ReturnType<typeof isOpenNow>,
  score: number
): string {
  // Tier prefix — sets expectation upfront
  const tier = score >= 85 ? "ممتاز"
    : score >= 75 ? "جيد جداً"
    : score >= 65 ? "جيد"
    : score >= 50 ? "متوسط"
    : "ضعيف";

  const bits: string[] = [];

  // Always lead with the rating + review evidence (the WHY behind the tier)
  if (place.rating != null && place.review_count != null) {
    const c = place.review_count;
    const cStr = c >= 1000 ? `${(c / 1000).toFixed(1)}k` : c.toString();
    bits.push(`${place.rating.toFixed(1)}★ من ${cStr} زائر`);
  } else if (place.rating != null) {
    bits.push(`${place.rating.toFixed(1)}★`);
  } else if (place.review_count != null && place.review_count >= 200) {
    bits.push(`${place.review_count} زائر`);
  }

  if (status.kind === "shut") {
    return `${tier} · مغلق الآن`;
  }
  if (status.kind === "open") bits.push("مفتوح");

  // Hidden gem callout
  if (place.rating != null && place.rating >= 4.6 &&
      place.review_count != null && place.review_count >= 80 && place.review_count <= 1500) {
    bits.push("💎 هيدن جيم");
  }

  if (ctx.hotelLocation && place.lat != null && place.lng != null) {
    const km = haversineKm(ctx.hotelLocation, { lat: place.lat, lng: place.lng });
    if (km < 2) bits.push("جنب فندقك");
    else if (km > 20) bits.push("بعيد");
  }

  if (ctx.userVerdict === "love") bits.push("أحببته");
  if (place.is_editor_pick) bits.push("اختيار محرّر");

  return bits.length > 0 ? `${tier} · ${bits.join(" · ")}` : tier;
}
