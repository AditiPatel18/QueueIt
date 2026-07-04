-- migrations/20260622_add_features.sql
-- Migration to add Collections/Folders, Favorites (is_favorite already exists, but we make sure), Read Progress, and Rich Notes

-- 1. Create collections table
CREATE TABLE IF NOT EXISTS public.collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT 'blue',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view their own collections" ON public.collections;
DROP POLICY IF EXISTS "Users can insert their own collections" ON public.collections;
DROP POLICY IF EXISTS "Users can update their own collections" ON public.collections;
DROP POLICY IF EXISTS "Users can delete their own collections" ON public.collections;

-- Create policies for collections
CREATE POLICY "Users can view their own collections" 
    ON public.collections FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own collections" 
    ON public.collections FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own collections" 
    ON public.collections FOR UPDATE 
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own collections" 
    ON public.collections FOR DELETE 
    USING (auth.uid() = user_id);

-- 2. Add columns to items table if they don't exist
DO $$
BEGIN
    BEGIN
        ALTER TABLE public.items ADD COLUMN collection_id UUID REFERENCES public.collections(id) ON DELETE SET NULL;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;

    BEGIN
        ALTER TABLE public.items ADD COLUMN read_progress INTEGER DEFAULT 0 CHECK (read_progress >= 0 AND read_progress <= 100);
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;

    BEGIN
        ALTER TABLE public.items ADD COLUMN notes TEXT;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
END $$;

-- 3. Create indexes for performance
CREATE INDEX IF NOT EXISTS items_collection_id_idx ON public.items(collection_id);
CREATE INDEX IF NOT EXISTS items_is_favorite_idx ON public.items(is_favorite);
