-- Adds the chord_density column that PR #111 introduced on the
-- UserPreferences model (mobile 3/4-across chord grid preference).
-- The model shipped without this migration, so production queries against
-- user_preferences 500'd until it was applied (2026-07-26).
--
-- Superseded by alembic revision f1a2b3c4d5e6, which now creates the same
-- column. Kept for the historical record and guarded so the two can't
-- collide on a rebuild, whichever runs first.
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS chord_density SMALLINT NOT NULL DEFAULT 4;
