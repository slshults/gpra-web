-- Add first_item_guidance_shown to user_preferences
--
-- Superseded by alembic revision b8e4f2a6c013, which now creates the same
-- column. Guarded so the two can't collide on a rebuild, whichever runs first.
-- (The sibling raw migrations were already guarded this way.)
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS first_item_guidance_shown BOOLEAN NOT NULL DEFAULT FALSE;

-- Set TRUE for all existing users so they don't see the modal
-- (This guidance is for NEW users going forward)
UPDATE user_preferences SET first_item_guidance_shown = TRUE;
