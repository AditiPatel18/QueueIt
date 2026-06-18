-- ==============================================================================
-- ADDITIVE UPDATE SCHEMA (Run this in Supabase SQL Editor)
-- Use this if you do NOT want to drop existing data. 
-- It adds missing columns to conform to the canonical schema.
-- ==============================================================================

-- Safely add columns to items table if they don't exist
DO $$
BEGIN
    BEGIN
        ALTER TABLE items ADD COLUMN priority_score INTEGER DEFAULT 0;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
    
    BEGIN
        ALTER TABLE items ADD COLUMN duration_seconds INTEGER;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;

    BEGIN
        ALTER TABLE items ADD COLUMN full_text TEXT;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;

    BEGIN
        ALTER TABLE items ADD COLUMN video_url TEXT;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;

    BEGIN
        ALTER TABLE items ADD COLUMN word_count INTEGER;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;

    BEGIN
        ALTER TABLE items ADD COLUMN published_date TIMESTAMP WITH TIME ZONE;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;

    BEGIN
        ALTER TABLE items ADD COLUMN summary TEXT;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
    
    BEGIN
        ALTER TABLE items ADD COLUMN tags TEXT[] DEFAULT '{}'::TEXT[];
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
END $$;

-- Create indexes if they don't exist (using IF NOT EXISTS syntax for indexes)
CREATE INDEX IF NOT EXISTS items_user_id_idx ON items(user_id);
CREATE INDEX IF NOT EXISTS items_status_idx ON items(status);
CREATE INDEX IF NOT EXISTS items_source_type_idx ON items(source_type);
CREATE INDEX IF NOT EXISTS items_added_at_idx ON items(added_at DESC);
CREATE INDEX IF NOT EXISTS items_priority_score_idx ON items(priority_score DESC);
