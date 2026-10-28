-- Migration: Add processing_error and notes columns to items table
-- This provides dedicated persistence for extraction and generation errors in Supabase.
-- Run this in the Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

-- 1. Add dedicated processing_error column
ALTER TABLE items ADD COLUMN IF NOT EXISTS processing_error TEXT;

-- 2. Add notes column for legacy compatibility
ALTER TABLE items ADD COLUMN IF NOT EXISTS notes TEXT;

-- 3. Ensure updated_at column exists and defaults to now()
ALTER TABLE items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 4. Create an index on processing_status for fast filtering of queued/processing/failed items
CREATE INDEX IF NOT EXISTS idx_items_processing_status ON items (processing_status);
