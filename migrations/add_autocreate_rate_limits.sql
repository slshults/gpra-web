-- Migration: Add autocreate rate limiting columns to subscriptions table
-- Date: 2026-01-10
-- Purpose: Implement tier-based rate limits for Anthropic API autocreate feature

-- Add rate limiting columns for autocreate
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS autocreate_calls_today INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS autocreate_calls_this_hour INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS autocreate_daily_reset_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS autocreate_hourly_reset_at TIMESTAMP WITH TIME ZONE;

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_subscriptions_autocreate_daily_reset
    ON subscriptions(autocreate_daily_reset_at)
    WHERE autocreate_daily_reset_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_autocreate_hourly_reset
    ON subscriptions(autocreate_hourly_reset_at)
    WHERE autocreate_hourly_reset_at IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN subscriptions.autocreate_calls_today IS 'Count of autocreate API calls made today (resets at midnight UTC)';
COMMENT ON COLUMN subscriptions.autocreate_calls_this_hour IS 'Count of autocreate API calls made this hour (resets every hour)';
COMMENT ON COLUMN subscriptions.autocreate_daily_reset_at IS 'Timestamp of next daily counter reset (midnight UTC)';
COMMENT ON COLUMN subscriptions.autocreate_hourly_reset_at IS 'Timestamp of next hourly counter reset';
