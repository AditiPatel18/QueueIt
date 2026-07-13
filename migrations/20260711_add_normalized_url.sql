-- migrations/20260711_add_normalized_url.sql
-- Add normalized_url column to items table and populate it

-- 1. Add normalized_url column if not exists
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS normalized_url TEXT;

-- 2. Clean up any existing duplicates (keep the oldest one based on created_at or id)
DELETE FROM public.items a
USING public.items b
WHERE a.id > b.id
  AND a.user_id = b.user_id
  AND LOWER(TRIM(a.url)) = LOWER(TRIM(b.url));

-- 3. Populate normalized_url
UPDATE public.items SET normalized_url = LOWER(TRIM(url)) WHERE normalized_url IS NULL;

-- 4. Add unique constraint (user_id, normalized_url)
ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_user_id_normalized_url_key;
ALTER TABLE public.items ADD CONSTRAINT items_user_id_normalized_url_key UNIQUE (user_id, normalized_url);
