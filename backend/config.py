import os
import re
from pathlib import Path
from dotenv import load_dotenv

# Monkeypatch supabase client's regex to support local Supabase keys starting with sb_secret_ or sb_publishable_
try:
    import supabase._sync.client as sync_client
    original_sync_match = re.match
    def custom_sync_match(pattern, string, flags=0):
        if pattern == r"^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$":
            if string.startswith("sb_secret_") or string.startswith("sb_publishable_"):
                class DummyMatch:
                    pass
                return DummyMatch()
        return original_sync_match(pattern, string, flags)
    sync_client.re.match = custom_sync_match
except Exception:
    pass

try:
    import supabase._async.client as async_client
    original_async_match = re.match
    def custom_async_match(pattern, string, flags=0):
        if pattern == r"^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$":
            if string.startswith("sb_secret_") or string.startswith("sb_publishable_"):
                class DummyMatch:
                    pass
                return DummyMatch()
        return original_async_match(pattern, string, flags)
    async_client.re.match = custom_async_match
except Exception:
    pass


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
# Support both SUPABASE_ANON_KEY and legacy SUPABASE_KEY
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

# Validate required config
if not SUPABASE_URL:
    raise ValueError("SUPABASE_URL is required in .env")
if not SUPABASE_SERVICE_ROLE_KEY:
    raise ValueError("SUPABASE_SERVICE_ROLE_KEY is required in .env")
if not GEMINI_API_KEY:
    print("WARNING: GEMINI_API_KEY not set. AI features will be disabled.")


class Settings:
    # Directory for static audio files
    STATIC_AUDIO_PATH: str = os.getenv("STATIC_AUDIO_PATH", "static/audio")
    supabase_url = SUPABASE_URL
    supabase_anon_key = SUPABASE_ANON_KEY
    supabase_service_role_key = SUPABASE_SERVICE_ROLE_KEY
    supabase_jwt_secret = SUPABASE_JWT_SECRET
    gemini_api_key = GEMINI_API_KEY
    frontend_url = FRONTEND_URL


_settings = Settings()


def get_settings():
    return _settings