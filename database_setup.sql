-- Run this in your Supabase SQL Editor

-- 1. Create items table
CREATE TABLE IF NOT EXISTS public.items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL, -- references auth.users(id) if you enforce foreign keys
    url TEXT NOT NULL,
    content_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    author TEXT,
    thumbnail_url TEXT,
    source_name TEXT,
    estimated_read_time INTEGER,
    duration_seconds INTEGER,
    extracted_text TEXT,
    status TEXT DEFAULT 'queued',
    processing_status TEXT DEFAULT 'completed' CHECK (processing_status IN ('processing', 'completed', 'failed')),
    tags TEXT[] DEFAULT '{}',
    ai_summary TEXT,
    priority_score FLOAT DEFAULT 50.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS Policies
-- Users can only select their own items
CREATE POLICY "Users can view their own items" 
    ON public.items FOR SELECT 
    USING (auth.uid() = user_id);

-- Users can only insert their own items
CREATE POLICY "Users can insert their own items" 
    ON public.items FOR INSERT 
    WITH CHECK (auth.uid() = user_id);

-- Users can only update their own items
CREATE POLICY "Users can update their own items" 
    ON public.items FOR UPDATE 
    USING (auth.uid() = user_id);

-- Users can only delete their own items
CREATE POLICY "Users can delete their own items" 
    ON public.items FOR DELETE 
    USING (auth.uid() = user_id);

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_items_user_id ON public.items(user_id);
CREATE INDEX IF NOT EXISTS idx_items_status ON public.items(status);
CREATE INDEX IF NOT EXISTS idx_items_created_at ON public.items(created_at DESC);
