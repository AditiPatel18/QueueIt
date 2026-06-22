-- migration_add_processing_status.sql
-- Run this in your Supabase SQL Editor
ALTER TABLE public.items 
ADD COLUMN IF NOT EXISTS processing_status TEXT DEFAULT 'completed' 
CHECK (processing_status IN ('processing', 'completed', 'failed'));
