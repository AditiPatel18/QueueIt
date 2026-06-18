-- Add missing columns to match required schema
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_favorite boolean default false;
ALTER TABLE items ADD COLUMN IF NOT EXISTS updated_at timestamptz default now();

-- Ensure other columns are correct (already present in DB)
-- (id, user_id, url, title, description, author, thumbnail_url, source_name, content_type, estimated_read_time, duration_seconds, extracted_text, tags, ai_summary, priority_score, status, created_at)
