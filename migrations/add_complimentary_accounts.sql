-- Add complimentary account fields to subscriptions table
-- Created: 2025-12-05
-- Purpose: Support free-forever accounts for beta testers, friends, and contributors

-- Add is_complimentary column
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS is_complimentary BOOLEAN NOT NULL DEFAULT FALSE;

-- Add complimentary_reason column
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS complimentary_reason VARCHAR(255);

-- Add comments for documentation
COMMENT ON COLUMN subscriptions.is_complimentary IS 'True for free-forever accounts (beta testers, friends, contributors)';
COMMENT ON COLUMN subscriptions.complimentary_reason IS 'Reason for complimentary access (e.g., "Beta tester", "Friend", "Contributor")';
