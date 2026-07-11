import sqlite3
import asyncio
from datetime import datetime, timezone, timedelta
import zoneinfo
from utils.supabase_client import supabase
from utils.schema_fallback import DB_PATH

class StreakService:
    @staticmethod
    def get_streak_heatmap(user_id: str) -> dict:
        """
        Calculates streaks and daily completions for the last 365 days.
        Reads only completed_at timestamps from Supabase items.
        """
        try:
            # 1. Fetch only completed_at column from completed items
            res = supabase.table("items").select("completed_at").eq("user_id", user_id).eq("status", "completed").execute()
            items = res.data or []
            
            # 2. Get user timezone from local reminder settings
            tz_name = "UTC"
            try:
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute("SELECT timezone FROM local_reminder_settings WHERE user_id = ?", (user_id,))
                sett_row = cursor.fetchone()
                if sett_row and sett_row[0]:
                    tz_name = sett_row[0]
                conn.close()
            except Exception:
                pass

            try:
                tz = zoneinfo.ZoneInfo(tz_name)
            except Exception:
                tz = timezone.utc

            today = datetime.now(tz).date()
            yesterday = today - timedelta(days=1)
            
            completed_dates = set()
            daily_activity_counts = {}
            
            # 3. Process completed_at timestamps
            for item in items:
                completed_at_str = item.get("completed_at")
                if completed_at_str:
                    try:
                        clean_comp = completed_at_str.replace("Z", "+00:00")
                        comp_dt = datetime.fromisoformat(clean_comp)
                        if comp_dt.tzinfo is None:
                            comp_dt = comp_dt.replace(tzinfo=timezone.utc)
                        comp_date = comp_dt.astimezone(tz).date()
                        completed_dates.add(comp_date)
                        
                        date_str = comp_date.isoformat()
                        daily_activity_counts[date_str] = daily_activity_counts.get(date_str, 0) + 1
                    except Exception:
                        pass
                        
            # 4. Integrate streak freezes from calendar
            try:
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute("SELECT activity_date FROM local_streak_calendar WHERE user_id = ?", (user_id,))
                calendar_rows = cursor.fetchall()
                conn.close()
                for row in calendar_rows:
                    if row[0]:
                        try:
                            c_date = datetime.fromisoformat(row[0]).date()
                            completed_dates.add(c_date)
                            c_date_str = c_date.isoformat()
                            if c_date_str not in daily_activity_counts:
                                daily_activity_counts[c_date_str] = 1  # count streak freeze day as active
                        except Exception:
                            pass
            except Exception:
                pass
                
            # 5. Compute current and longest streaks
            sorted_dates = sorted(list(completed_dates))
            current_streak = 0
            longest_streak = 0
            
            if sorted_dates:
                temp_streak = 1
                longest_streak = 1
                for i in range(1, len(sorted_dates)):
                    if (sorted_dates[i] - sorted_dates[i-1]).days == 1:
                        temp_streak += 1
                    elif (sorted_dates[i] - sorted_dates[i-1]).days > 1:
                        temp_streak = 1
                    longest_streak = max(longest_streak, temp_streak)
                    
                if today in completed_dates:
                    current_streak = 1
                    check_date = yesterday
                    while check_date in completed_dates:
                        current_streak += 1
                        check_date -= timedelta(days=1)
                elif yesterday in completed_dates:
                    current_streak = 1
                    check_date = yesterday - timedelta(days=1)
                    while check_date in completed_dates:
                        current_streak += 1
                        check_date -= timedelta(days=1)
                else:
                    current_streak = 0
                    
            daily_activity = [{"date": k, "count": v} for k, v in sorted(daily_activity_counts.items())]
            
            return {
                "current_streak": current_streak,
                "longest_streak": longest_streak,
                "daily_activity": daily_activity
            }
        except Exception as e:
            import logging
            logging.getLogger("uvicorn").error(f"Error in StreakService: {e}")
            return {
                "current_streak": 0,
                "longest_streak": 0,
                "daily_activity": []
            }
