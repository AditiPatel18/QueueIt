-- ==============================================================================
-- CLEAN REBUILD SCHEMA (Run this in Supabase SQL Editor)
-- WARNING: This will drop your existing items and profiles tables!
-- ==============================================================================

-- 1. DROP EXISTING TABLES (if they exist)
DROP TABLE IF EXISTS items;
DROP TABLE IF EXISTS collections;
DROP TABLE IF EXISTS profiles;

-- 2. CREATE PROFILES TABLE
CREATE TABLE profiles (
    id UUID REFERENCES auth.users(id) PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. CREATE COLLECTIONS TABLE
CREATE TABLE collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT 'blue',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. CREATE ITEMS TABLE
CREATE TABLE items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    source_type TEXT NOT NULL,
    source_name TEXT,
    thumbnail_url TEXT,
    estimated_read_time INTEGER, -- In seconds
    estimated_time_minutes NUMERIC,
    actual_time_spent NUMERIC DEFAULT 0.0,
    duration_seconds INTEGER,
    full_text TEXT,
    author TEXT,
    video_url TEXT,
    word_count INTEGER,
    published_date TIMESTAMP WITH TIME ZONE,
    tags TEXT[] DEFAULT '{}'::TEXT[],
    summary TEXT,
    priority_score INTEGER DEFAULT 0,
    status TEXT DEFAULT 'unread' CHECK (status IN ('unread', 'reading', 'completed', 'archived')),
    processing_status TEXT DEFAULT 'completed' CHECK (processing_status IN ('processing', 'completed', 'failed')),
    is_favorite BOOLEAN DEFAULT false,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    collection_id UUID REFERENCES collections(id) ON DELETE SET NULL,
    read_progress INTEGER DEFAULT 0 CHECK (read_progress >= 0 AND read_progress <= 100),
    notes TEXT
);

-- 5. ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

-- 6. CREATE POLICIES
-- Profiles: Users can only view and update their own profile
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- Collections: Users can only CRUD their own collections
CREATE POLICY "Users can view own collections" ON collections
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own collections" ON collections
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own collections" ON collections
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own collections" ON collections
    FOR DELETE USING (auth.uid() = user_id);

-- Items: Users can only CRUD their own items
CREATE POLICY "Users can view own items" ON items
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own items" ON items
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own items" ON items
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own items" ON items
    FOR DELETE USING (auth.uid() = user_id);

-- 7. CREATE AUTO-PROFILE TRIGGER FOR NEW SIGNUPS
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'name');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists to prevent errors
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 8. CREATE INDEXES FOR PERFORMANCE
CREATE INDEX items_user_id_idx ON items(user_id);
CREATE INDEX items_status_idx ON items(status);
CREATE INDEX items_source_type_idx ON items(source_type);
CREATE INDEX items_added_at_idx ON items(added_at DESC);
CREATE INDEX items_priority_score_idx ON items(priority_score DESC);
CREATE INDEX items_collection_id_idx ON items(collection_id);
CREATE INDEX items_is_favorite_idx ON items(is_favorite);
