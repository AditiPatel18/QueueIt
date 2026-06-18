import asyncio
from config import get_settings
from supabase import create_client

def main():
    settings = get_settings()
    supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)
    
    # Try to fetch 1 item
    result = supabase.table("items").select("*").limit(1).execute()
    print("Columns:", result.data[0].keys() if result.data else "No items in table")
    
if __name__ == "__main__":
    main()
