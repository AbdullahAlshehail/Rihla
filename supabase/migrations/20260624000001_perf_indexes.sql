-- Performance indexes — backend audit 2026-06-24
-- Speeds up the main map query (city + city_label OR, ORDER BY rating DESC),
-- trending lookups, and itinerary day fetches.

CREATE INDEX IF NOT EXISTS places_city_label_idx
  ON public.places (city_label);

CREATE INDEX IF NOT EXISTS places_city_rating_idx
  ON public.places (city, rating DESC NULLS LAST, review_count DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS places_trending_score_idx
  ON public.places (trending_score DESC NULLS LAST)
  WHERE trending_score IS NOT NULL;

CREATE INDEX IF NOT EXISTS itinerary_days_trip_date_idx
  ON public.itinerary_days (trip_id, day_date);

ANALYZE public.places;
ANALYZE public.itinerary_days;
