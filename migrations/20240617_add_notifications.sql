-- migrations/20240617_add_notifications.sql
-- Migration to add notification-related tables and audio_url column to items

-- 1. notification_preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    quiet_hours_start TIME, 
    quiet_hours_end TIME,
    preferred_days TEXT[], -- e.g., '{Monday,Tuesday}'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. notification_history table
CREATE TABLE IF NOT EXISTS notification_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    item_id UUID REFERENCES items(id) ON DELETE CASCADE,
    channel TEXT NOT NULL, -- email, push, whatsapp, sms
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    status TEXT NOT NULL, -- success, failure
    error_message TEXT
);

-- 3. push_subscriptions table (Web Push)
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 4. user_streaks table
CREATE TABLE IF NOT EXISTS user_streaks (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    current_streak INT NOT NULL DEFAULT 0,
    longest_streak INT NOT NULL DEFAULT 0,
    last_completed DATE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 5. Add audio_url column to items
ALTER TABLE items ADD COLUMN IF NOT EXISTS audio_url TEXT;

-- 6. RLS policies (example for notification_preferences)
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_pref_select" ON notification_preferences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_pref_insert" ON notification_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_pref_update" ON notification_preferences FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_pref_delete" ON notification_preferences FOR DELETE USING (auth.uid() = user_id);

-- Similar RLS policies should be added for notification_history, push_subscriptions, and user_streaks.

-- End of migration
