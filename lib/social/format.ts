// Shared formatting + derivation helpers for the social layer (حسابي).
// All display numbers use Arabic-Indic digits to match the design prototype.

const AR_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

/** 340 → "٣٤٠". Accepts numbers or numeric strings. */
export function arNum(n: number | string): string {
  return String(n).replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)]);
}

/** Arabic relative time: الآن / قبل ٥ د / قبل ٣ س / أمس / قبل ٤ أيام. */
export function timeAgoAr(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.floor((now.getTime() - then) / 60_000));
  if (mins < 1) return "الآن";
  if (mins < 60) return `قبل ${arNum(mins)} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "قبل ساعة" : `قبل ${arNum(hours)} س`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "أمس";
  if (days < 7) return `قبل ${arNum(days)} أيام`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return "قبل أسبوع";
  if (days < 30) return `قبل ${arNum(weeks)} أسابيع`;
  return new Date(iso).toLocaleDateString("ar-SA", { day: "numeric", month: "long" });
}

// ── Tier — derived honestly from the coin balance (user_points.coins). ──────
export type Tier = {
  key: "bronze" | "silver" | "gold" | "platinum";
  label: string; // e.g. "مستكشف ذهبي"
  /** Coins needed for the next tier — null at the top tier. */
  next: number | null;
};

const TIERS: { key: Tier["key"]; min: number; name: string }[] = [
  { key: "platinum", min: 1000, name: "بلاتيني" },
  { key: "gold", min: 300, name: "ذهبي" },
  { key: "silver", min: 100, name: "فضّي" },
  { key: "bronze", min: 0, name: "برونزي" },
];

export function tierFromCoins(coins: number): Tier {
  const idx = TIERS.findIndex((t) => coins >= t.min);
  const t = TIERS[idx === -1 ? TIERS.length - 1 : idx];
  const above = TIERS[(idx === -1 ? TIERS.length - 1 : idx) - 1];
  return { key: t.key, label: `مستكشف ${t.name}`, next: above ? above.min : null };
}

/** Deterministic accent color for a user avatar (category accent palette). */
const AVATAR_COLORS = ["#e0654a", "#0c4a63", "#c08a1e", "#3f8f6b", "#c96a8e", "#7a6bd6"];
export function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** Display name fallback: profile name unless it's just the email. */
export function friendlyName(displayName: string | null, username: string | null, email?: string | null): string {
  if (displayName && !displayName.includes("@")) return displayName;
  if (username) return username;
  const source = displayName ?? email ?? "";
  return source.includes("@") ? source.split("@")[0] : source || "مسافر";
}

/** UTC calendar date string (matches the server streak logic, which uses UTC). */
export function utcDateStr(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** A streak is only "alive" if the last activity was today or yesterday (UTC). */
export function liveStreak(current: number, lastActive: string | null): number {
  if (!lastActive) return 0;
  const today = utcDateStr();
  const yesterday = utcDateStr(new Date(Date.now() - 86_400_000));
  return lastActive === today || lastActive === yesterday ? current : 0;
}
