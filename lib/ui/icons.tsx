// Icon map — replaces semantic emoji (🍽☕🚗🚶💰🧠🙈❤️🔥⭐) with a single
// lucide-react set: stroke, currentColor, RTL-safe. Emoji survive ONLY in
// expressive social content (check-in reactions), never as UI labels.
//
// Usage:
//   import { CategoryIcon, Icon } from "@/lib/ui/icons";
//   <CategoryIcon category="food" className="w-4 h-4" />
//   <Icon name="drive" className="w-4 h-4" />
import {
  Utensils, Coffee, Landmark, TreePine, CalendarDays, IceCreamCone, Wine,
  Car, Footprints, Clock, Heart, EyeOff, Flame, Star, Award, MapPin,
  Sparkles, Wallet, Users, Navigation, Bookmark, Check,
  type LucideIcon,
} from "lucide-react";

// Place categories (keys match place.category across the app).
export const CATEGORY_ICON: Record<string, LucideIcon> = {
  food: Utensils,
  coffee: Coffee,
  sight: Landmark,
  nature: TreePine,
  event: CalendarDays,
  sweet: IceCreamCone,
  bar: Wine,
};

// Semantic UI icons keyed by intent (not by glyph).
export const ICON: Record<string, LucideIcon> = {
  // transport
  drive: Car,
  walk: Footprints,
  navigate: Navigation,
  // meta
  time: Clock,
  price: Wallet,
  area: MapPin,
  rating: Star,
  trending: Flame,
  editor: Award,
  new: Sparkles,
  people: Users,
  // actions
  save: Heart,
  saved: Heart,
  hide: EyeOff,
  bookmark: Bookmark,
  check: Check,
};

export function CategoryIcon({
  category,
  className = "w-4 h-4",
  strokeWidth = 2,
}: {
  category: string | null | undefined;
  className?: string;
  strokeWidth?: number;
}) {
  const Cmp = (category && CATEGORY_ICON[category]) || MapPin;
  return <Cmp className={className} strokeWidth={strokeWidth} aria-hidden="true" />;
}

export function Icon({
  name,
  className = "w-4 h-4",
  strokeWidth = 2,
  fill,
}: {
  name: keyof typeof ICON;
  className?: string;
  strokeWidth?: number;
  fill?: boolean;
}) {
  const Cmp = ICON[name] || MapPin;
  return (
    <Cmp
      className={className}
      strokeWidth={strokeWidth}
      aria-hidden="true"
      {...(fill ? { fill: "currentColor" } : {})}
    />
  );
}
