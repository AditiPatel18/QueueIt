"""
Centralized Supabase client — singleton pattern.
Uses the service-role key so the backend can bypass RLS.
Auth is validated at the API layer via JWT tokens.
"""

from supabase import create_client, Client
from config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

_client: Client | None = None


def get_supabase_client() -> Client:
    """Return the singleton Supabase client using the service-role key."""
    global _client
    if _client is None:
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    return _client


# Legacy alias — some modules import `supabase` directly
def get_supabase() -> Client:
    return get_supabase_client()


# Pre-built singleton used by api modules via `from utils.supabase_client import supabase`
supabase: Client = get_supabase_client()
