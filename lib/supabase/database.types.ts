// Database types — hand-written for Phase 1.
// Regenerate later via `npm run db:types` once Supabase is linked.

// Column list for list-mode SELECTs (drops heavy google_reviews JSON column —
// ~400-800 KB saved on a 200-place catalogue fetch). Detail view re-fetches
// google_reviews via enrichment, so cards just hide the snippet meanwhile.
export const PLACE_LIST_COLUMNS = "id,google_place_id,external_source,name,category,kind,city,city_label,lat,lng,address,phone,website,rating,review_count,price_level,cost_estimate,cost_currency,cost_confidence,opening_hours,open_status_cache,photo_url,photo_urls,google_maps_url,tags,highlights,tip,hidden_gem_score,is_editor_pick,data_freshness,review_summary,enriched_at,ai_summary";

// Slim variant used by the trip-level catalogue (1800+ rows). Drops 8 fields
// that PlaceDetailSheet re-fetches via /api/places/[id]/enrich when opened:
// address/phone/website/google_maps_url/photo_urls/highlights/data_freshness/
// enriched_at/external_source/cost_confidence/open_status_cache.
// Saves ~600 bytes/row → ~1 MB lighter on a 1800-row region payload.
export const PLACE_CARD_COLUMNS = "id,google_place_id,name,category,kind,city,city_label,lat,lng,rating,review_count,price_level,cost_estimate,cost_currency,opening_hours,photo_url,tags,tip,hidden_gem_score,is_editor_pick,review_summary,ai_summary";

// MAP-ONLY slim variant. Drops 4 more heavy fields the carousel + markers
// never read: ai_summary (avg 200 B), review_summary (~100 B), tip (~80 B),
// cost_estimate/cost_currency (only shown in the detail sheet). Saves
// ~400 B/row → ~80 KB lighter inline JSON on a 200-row map view.
// PlaceDetailSheet lazy-fetches the full row via /api/places/[id] when
// opened, so detail UX stays unchanged.
//
// We DO keep `highlights` because whyReason() reads it for the carousel
// "why this place?" line — that's the single most decision-relevant signal.
// Also keeps trending_* so the 🔥 filter + badge work without re-fetching.
export const PLACE_MAP_COLUMNS = "id,google_place_id,name,category,kind,city,city_label,lat,lng,rating,review_count,price_level,opening_hours,photo_url,tags,highlights,hidden_gem_score,is_editor_pick,trending_score,trending_source,trending_updated_at,trending_url";

export type Slot = "morning" | "midday" | "afternoon" | "evening" | "night";
export type Category = "food" | "coffee" | "sight" | "nature" | "event" | "sweet" | "bar";
export type BudgetStyle = "economical" | "mid" | "luxury";
export type Confidence = "high" | "medium" | "low";
export type Currency = "SAR" | "EUR" | "USD" | "GBP" | "AED";

export type Trip = {
  id: string;
  user_id: string;
  name: string;
  destination_city: string | null;
  start_date: string | null; // ISO date
  end_date: string | null;
  travelers: number;
  budget_style: BudgetStyle;
  hotel_name: string | null;
  hotel_lat: number | null;
  hotel_lng: number | null;
  hotel_place_id: string | null;
  hotel_address: string | null;
  rates: Record<string, number>;
  rates_updated: string | null;
  preferences: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Place = {
  id: string;
  google_place_id: string | null;
  external_source: string;
  name: string;
  category: Category;
  kind: string | null;
  city: string;
  city_label: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  review_count: number | null;
  price_level: number | null;
  cost_estimate: number | null;
  cost_currency: Currency;
  cost_confidence: Confidence;
  opening_hours: string[] | null;
  open_status_cache: string | null;
  photo_url: string | null;
  photo_urls: string[] | null;
  google_maps_url: string | null;
  tags: string[] | null;
  highlights: string[] | null;
  tip: string | null;
  hidden_gem_score: number | null;
  is_editor_pick: boolean;
  data_freshness: string;
  review_summary: string | null;
  google_reviews: GoogleReviewSnippet[] | null;
  enriched_at: string | null;
  ai_summary: string | null;
  trending_score: number | null;
  trending_source: "tiktok" | "instagram" | "both" | "web" | null;
  trending_updated_at: string | null;
  trending_evidence: TrendingEvidence[] | null;
  /** Best single URL for this place's trend (prefer TikTok video > Insta > web).
   *  Denormalized from trend_sources so the carousel links directly. */
  trending_url: string | null;
};

export type TrendingEvidence = {
  url: string;
  platform: "tiktok" | "instagram" | "web";
  snippet?: string;
  found_at: string;
};

export type GoogleReviewSnippet = {
  author_name?: string;
  rating?: number;
  text: string;
  relative_time?: string;
  language?: string;
};

export type ItineraryDay = {
  id: string;
  trip_id: string;
  day_date: string;
  city: string | null;
  notes: string | null;
  created_at: string;
};

export type ItineraryItem = {
  id: string;
  day_id: string;
  place_id: string;
  slot: Slot;
  position: number;
  user_note: string | null;
  custom_cost_sar: number | null;
  transport_mode: string | null;
  created_at: string;
};

export type SavedPlace = {
  user_id: string;
  place_id: string;
  saved_at: string;
  notes: string | null;
};

export type UserRating = {
  user_id: string;
  place_id: string;
  stars: number | null;
  verdict: "love" | "meh" | "skip" | null;
  tags: string[] | null;
  note: string | null;
  updated_at: string;
};

export type BookingType = "flight" | "hotel" | "event" | "transport" | "expense" | "file";
export type PaidStatus = "paid" | "unpaid" | "partial" | "unknown";

export type TripBooking = {
  id: string;
  user_id: string;
  trip_id: string;
  type: BookingType;
  title: string;
  subtitle: string | null;
  start_at: string | null;          // ISO timestamptz
  end_at: string | null;
  location_name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  amount: number | null;
  currency: Currency | null;
  paid_status: PaidStatus;
  reference: string | null;
  metadata: Record<string, unknown>;
  file_path: string | null;
  file_mime: string | null;
  created_at: string;
  updated_at: string;
};

export type BudgetAssumptions = {
  trip_id: string;
  flight_total_sar: number;
  hotel_per_night_sar: number;
  nights: number;
  transport_daily_sar: number;
  misc_daily_sar: number;
  confidence: Confidence;
  notes: string | null;
};
