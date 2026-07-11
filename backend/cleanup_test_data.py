"""
One-off script: removes junk test rows inserted during development
that cause Supabase UUID errors in the scheduler loop.
"""
import sqlite3
import sys
import re
sys.path.insert(0, '.')
import config
from utils.schema_fallback import DB_PATH

UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.IGNORECASE)

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# Get all user_ids
cursor.execute("SELECT user_id FROM local_reminder_settings")
all_users = [r[0] for r in cursor.fetchall()]
junk_users = [u for u in all_users if not UUID_RE.match(u)]

print(f"Total users in local_reminder_settings: {len(all_users)}")
print(f"Junk (non-UUID) user_ids to remove: {junk_users}")

for uid in junk_users:
    cursor.execute("DELETE FROM local_reminder_settings WHERE user_id = ?", (uid,))
    cursor.execute("DELETE FROM local_reminder_history WHERE user_id = ?", (uid,))

cursor.execute("SELECT user_id FROM local_reminder_history")
all_history = [r[0] for r in cursor.fetchall()]
junk_history = [u for u in all_history if not UUID_RE.match(u)]
print(f"Junk history rows to remove: {junk_history}")
for uid in junk_history:
    cursor.execute("DELETE FROM local_reminder_history WHERE user_id = ?", (uid,))

conn.commit()
conn.close()
print("Cleanup complete.")
