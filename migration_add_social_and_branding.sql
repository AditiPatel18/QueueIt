-- Migration to add social platform and favicon branding fields to items table
-- Run this in your Supabase SQL Editor

ALTER TABLE items ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS source_domain TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Backfill source_type using content_type for existing records
UPDATE items SET source_type = content_type WHERE source_type IS NULL;
