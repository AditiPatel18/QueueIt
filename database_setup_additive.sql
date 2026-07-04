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

    BEGIN
        ALTER TABLE items ADD COLUMN processing_status TEXT DEFAULT 'completed';
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;

    BEGIN
        ALTER TABLE items ADD COLUMN estimated_time_minutes NUMERIC;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
END $$;

-- Create collections table safely
CREATE TABLE IF NOT EXISTS public.collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT 'blue',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS for collections safely
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;

-- Create policies for collections safely
DROP POLICY IF EXISTS "Users can view own collections" ON public.collections;
CREATE POLICY "Users can view own collections" ON public.collections
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own collections" ON public.collections;
CREATE POLICY "Users can insert own collections" ON public.collections
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own collections" ON public.collections;
CREATE POLICY "Users can update own collections" ON public.collections
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own collections" ON public.collections;
CREATE POLICY "Users can delete own collections" ON public.collections
    FOR DELETE USING (auth.uid() = user_id);

-- Safely add new columns to items table
DO $$
BEGIN
    BEGIN
        ALTER TABLE items ADD COLUMN collection_id UUID REFERENCES collections(id) ON DELETE SET NULL;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
    
    BEGIN
        ALTER TABLE items ADD COLUMN read_progress INTEGER DEFAULT 0 CHECK (read_progress >= 0 AND read_progress <= 100);
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;

    BEGIN
        ALTER TABLE items ADD COLUMN notes TEXT;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;

    BEGIN
        ALTER TABLE items ADD COLUMN estimated_time_minutes NUMERIC;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;

    BEGIN
        ALTER TABLE items ADD COLUMN actual_time_spent NUMERIC DEFAULT 0.0;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS items_user_id_idx ON items(user_id);
CREATE INDEX IF NOT EXISTS items_status_idx ON items(status);
CREATE INDEX IF NOT EXISTS items_source_type_idx ON items(source_type);
CREATE INDEX IF NOT EXISTS items_added_at_idx ON items(added_at DESC);
CREATE INDEX IF NOT EXISTS items_priority_score_idx ON items(priority_score DESC);
CREATE INDEX IF NOT EXISTS items_collection_id_idx ON items(collection_id);
CREATE INDEX IF NOT EXISTS items_is_favorite_idx ON items(is_favorite);
