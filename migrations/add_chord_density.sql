-- Adds the chord_density column that PR #111 introduced on the
-- UserPreferences model (mobile 3/4-across chord grid preference).
-- The model shipped without this migration, so production queries against
-- user_preferences 500'd until it was applied (2026-07-26).
ALTER TABLE user_preferences ADD COLUMN chord_density SMALLINT NOT NULL DEFAULT 4;
