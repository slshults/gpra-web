-- Add first_item_guidance_shown to user_preferences
ALTER TABLE user_preferences ADD COLUMN first_item_guidance_shown BOOLEAN NOT NULL DEFAULT FALSE;

-- Set TRUE for all existing users so they don't see the modal
-- (This guidance is for NEW users going forward)
UPDATE user_preferences SET first_item_guidance_shown = TRUE;
