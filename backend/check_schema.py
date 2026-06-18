import requests
from config import get_settings
import json

settings = get_settings()
url = settings.supabase_url + "/rest/v1/?apikey=" + settings.supabase_service_role_key

response = requests.get(url)
if response.status_code == 200:
    data = response.json()
    print(json.dumps(data, indent=2))
else:
    print("Failed to fetch schema:", response.status_code, response.text)
