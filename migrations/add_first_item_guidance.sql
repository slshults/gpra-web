-- Add first_item_guidance_shown to user_preferences
--
-- Superseded by alembic revision b8e4f2a6c013, which now creates the same
-- column. Guarded so the two can't collide on a rebuild, whichever runs first.
-- (The sibling raw migrations were already guarded this way.)
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS first_item_guidance_shown BOOLEAN NOT NULL DEFAULT FALSE;

-- Removed: a one-time `UPDATE user_preferences SET first_item_guidance_shown = TRUE`,
-- applied to production on the original 2026 run so existing users wouldn't be
-- shown guidance meant for new ones.
--
-- It cannot stay now that the ALTER above is guarded. Previously the ALTER
-- aborted on re-run ("column already exists"), and that error was this file's
-- only re-run guard; with IF NOT EXISTS the ALTER succeeds and the UPDATE would
-- mark every user as already-guided, including genuinely new ones.
