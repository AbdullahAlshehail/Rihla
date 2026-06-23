-- Curated dataset metadata columns
-- Added 2026-06-23 to support the hand-picked Riviera dataset (Nice, Monaco,
-- Antibes, Menton, Cannes, Villefranche, Èze, Saint-Paul, Saint-Tropez, …).
-- All new fields default NULL/false so existing rows are unaffected.

ALTER TABLE places
  ADD COLUMN IF NOT EXISTS priority text
    CHECK (priority IS NULL OR priority IN ('P1','P2','P3')),
  ADD COLUMN IF NOT EXISTS best_time text,
  ADD COLUMN IF NOT EXISTS short_ar text,
  ADD COLUMN IF NOT EXISTS practical_warning text,
  ADD COLUMN IF NOT EXISTS seasonal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reservation_level text
    CHECK (reservation_level IS NULL OR reservation_level IN ('required','recommended','walk-in','none')),
  ADD COLUMN IF NOT EXISTS best_for text[],
  ADD COLUMN IF NOT EXISTS country_code text;

-- Backfill country_code: Monaco is MC, rest of the catalogue (Riviera, Var,
-- Riyadh, etc.) is set elsewhere. This keeps Monaco's identity correct.
UPDATE places SET country_code='MC'
  WHERE (city='monaco' OR city_label='موناكو') AND country_code IS NULL;
UPDATE places SET country_code='FR' WHERE country_code IS NULL
  AND city IN ('nice','cannes','antibes','menton','eze','villefranche','grasse','sainttropez','stpaul','capferrat','capdail','mougins','biot');

-- Partial index — curated subset only
CREATE INDEX IF NOT EXISTS places_priority_idx
  ON places (priority)
  WHERE priority IS NOT NULL;
