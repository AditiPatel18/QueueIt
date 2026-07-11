"""
Service for computing reading analytics.
Calculates totals, streaks, daily breakdowns, and productivity scores.
"""

import math
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List
from utils.schema_fallback import fallback_db


class AnalyticsService:
    """Service to compute reading analytics metrics for a user."""

    @staticmethod
    def get_item_reading_time(item: Dict[str, Any]) -> float:
        """Helper to calculate estimated reading time of an item in minutes."""
        est_min = item.get("estimated_time_minutes")
        if est_min is not None:
            try:
                return float(est_min)
            except (ValueError, TypeError):
                pass
        
        # Fallback to estimated_read_time (seconds) or duration_seconds (seconds)
        est_sec = item.get("estimated_read_time") or item.get("duration_seconds")
        if est_sec is not None:
            try:
                return float(est_sec) / 60.0
            except (ValueError, TypeError):
                pass
        
        # Fallback based on content type or text split length if available
        text = item.get("extracted_text")
        if text:
            words = len(text.split())
            if words > 0:
                source_type = item.get("source_type") or item.get("content_type") or "generic"
                wpm = 180.0 if source_type == "pdf" else 200.0
                return float(math.ceil(words / wpm))
                
        return 5.0  # Default to 5 minutes

    @classmethod
    def calculate_dashboard_metrics(cls, user_id: str, supabase_client) -> Dict[str, Any]:
        """Fetch queue items for the user, merge local metadata, and calculate metrics."""
        # 1. Fetch user items
        # To calculate streaks and counts accurately, we query id, status, added_at, completed_at, and time fields
        select_cols = ["id", "status", "added_at", "completed_at", "estimated_read_time", "duration_seconds", "content_type"]
        if fallback_db.has_estimated_time_minutes:
            select_cols.append("estimated_time_minutes")
        if fallback_db.has_actual_time_spent:
            select_cols.append("actual_time_spent")
        if fallback_db.has_source_type:
            select_cols.append("source_type")

        res = supabase_client.table("items").select(",".join(select_cols)).eq("user_id", user_id).execute()
        items = res.data or []
        items = fallback_db.merge_items_metadata(user_id, items)

        # Get user's timezone from settings
        from utils.schema_fallback import DB_PATH
        import sqlite3
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

        import zoneinfo
        try:
            tz = zoneinfo.ZoneInfo(tz_name)
        except Exception:
            import datetime as dt
            tz = dt.timezone.utc

        now = datetime.now(tz)
        today = now.date()
        yesterday = today - timedelta(days=1)

        daily_goal = 15 # default daily reading goal (minutes)
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("SELECT daily_goal FROM local_user_gamification WHERE user_id = ?", (user_id,))
            goal_row = cursor.fetchone()
            if goal_row and goal_row[0]:
                daily_goal = goal_row[0]
            conn.close()
        except Exception:
            pass

        # 2. Metric Accumulation
        total_items = 0
        completed_items = 0
        total_reading_time = 0.0
        time_completed = 0.0
        remaining_time = 0.0
        completed_dates = set()

        # Day-by-day charts maps
        last_7_days_dates = [today - timedelta(days=i) for i in range(6, -1, -1)]
        last_30_days_dates = [today - timedelta(days=i) for i in range(29, -1, -1)]
        
        time_by_day_7 = {d: 0.0 for d in last_7_days_dates}
        completions_by_day_7 = {d: 0 for d in last_7_days_dates}
        
        time_by_day_30 = {d: 0.0 for d in last_30_days_dates}
        completions_by_day_30 = {d: 0 for d in last_30_days_dates}
        
        daily_completion_counts = {}

        for item in items:
            status = item.get("status")
            if status == "archived":
                # Typically, archived items are excluded from total queue unless requested.
                # However, let's treat "unread", "reading", "completed" as the main queue.
                # We'll skip archived unread, but if it is completed, we want to count it for streaks.
                pass
            
            # We filter for active queue (unread, reading, completed)
            if status not in ("unread", "reading", "completed"):
                continue

            total_items += 1
            est_minutes = cls.get_item_reading_time(item)
            total_reading_time += est_minutes

            if status == "completed":
                completed_items += 1
                spent = item.get("actual_time_spent")
                actual_spent = float(spent) if spent is not None and spent > 0.0 else est_minutes
                time_completed += actual_spent

                completed_at_str = item.get("completed_at")
                if completed_at_str:
                    try:
                        clean_comp = completed_at_str.replace("Z", "+00:00")
                        comp_dt = datetime.fromisoformat(clean_comp)
                        if comp_dt.tzinfo is None:
                            comp_dt = comp_dt.replace(tzinfo=timezone.utc)
                        comp_date = comp_dt.astimezone(tz).date()
                        completed_dates.add(comp_date)
                        
                        # General calendar map
                        comp_date_str = comp_date.strftime("%Y-%m-%d")
                        daily_completion_counts[comp_date_str] = daily_completion_counts.get(comp_date_str, 0) + 1
                        
                        # 7-day breakdown
                        if comp_date in time_by_day_7:
                            time_by_day_7[comp_date] += actual_spent
                            completions_by_day_7[comp_date] += 1
                            
                        # 30-day breakdown
                        if comp_date in time_by_day_30:
                            time_by_day_30[comp_date] += actual_spent
                            completions_by_day_30[comp_date] += 1
                    except Exception:
                        pass
            elif status in ("unread", "reading"):
                progress = item.get("read_progress") or 0
                item_remaining = est_minutes * (1.0 - (progress / 100.0))
                remaining_time += item_remaining

        # 3. Synchronize and fetch streaks from GamificationService to ensure perfect sync
        from services.gamification_service import GamificationService
        GamificationService.sync_streak_data(user_id, supabase_client)
        gamification = GamificationService.get_or_init(user_id)
        current_reading_streak = gamification.get("current_streak") or 0
        longest_streak = gamification.get("longest_streak") or 0
        
        # Load all dates from the calendar database to build completion footprint chart
        calendar_dates = GamificationService.get_calendar(user_id)
        for d_str in calendar_dates:
            try:
                c_date = datetime.fromisoformat(d_str).date()
                completed_dates.add(c_date)
                c_date_str = c_date.strftime("%Y-%m-%d")
                if c_date_str not in daily_completion_counts:
                    daily_completion_counts[c_date_str] = 0
            except Exception:
                pass

        completion_percentage = (completed_items / total_items * 100) if total_items > 0 else 0.0
        average_reading_time_item = (total_reading_time / total_items) if total_items > 0 else 0.0

        # 4. Productivity Score (0-100)
        # Based on:
        # - Completion rate (40%)
        # - Daily Reading Goal Met (40%) - number of days in last 7 days where reading_minutes >= daily_goal
        # - Streak score (20%) - current streak out of 7 days
        goal_met_days = sum(1 for d in last_7_days_dates if time_by_day_7[d] >= daily_goal)
        goal_score = (goal_met_days / 7.0) * 100
        streak_score = min(100.0, (current_reading_streak / 7.0) * 100.0)
        
        productivity_score = round(
            (completion_percentage * 0.40) + 
            (goal_score * 0.40) + 
            (streak_score * 0.20)
        )
        productivity_score = min(100, max(0, productivity_score))

        # 5. Format Breakdown Lists
        last_7_days_list = [
            {
                "date": d.strftime("%Y-%m-%d"),
                "completed_count": completions_by_day_7[d],
                "reading_minutes": round(time_by_day_7[d], 1)
            }
            for d in last_7_days_dates
        ]

        last_30_days_list = [
            {
                "date": d.strftime("%Y-%m-%d"),
                "completed_count": completions_by_day_30[d],
                "reading_minutes": round(time_by_day_30[d], 1)
            }
            for d in last_30_days_dates
        ]

        weekly_reading_minutes = round(sum(time_by_day_7.values()), 1)
        monthly_reading_minutes = round(sum(time_by_day_30.values()), 1)

        return {
            "total_items": total_items,
            "completed_items": completed_items,
            "completion_percentage": round(completion_percentage, 1),
            "total_reading_time": round(total_reading_time, 1),
            "time_completed": round(time_completed, 1),
            "remaining_time": round(remaining_time, 1),
            "average_reading_time_item": round(average_reading_time_item, 1),
            "current_reading_streak": current_reading_streak,
            "longest_streak": longest_streak,
            "productivity_score": productivity_score,
            "last_7_days": last_7_days_list,
            "last_30_days": last_30_days_list,
            "weekly_reading_minutes": weekly_reading_minutes,
            "monthly_reading_minutes": monthly_reading_minutes,
            "daily_completion_counts": daily_completion_counts,
            "daily_activity": [{"date": k, "count": v} for k, v in sorted(daily_completion_counts.items())]
        }
