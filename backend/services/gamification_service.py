"""
GamificationService to handle QueueIt reading streaks, freeze grants, XP, levels, and badges.
Persists and manages details on local fallback SQLite database.
"""

import sqlite3
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from utils.schema_fallback import DB_PATH

logger = logging.getLogger(__name__)

class GamificationService:
    """Service to track reading gamification, levels, XP rewards, and streaks."""

    @classmethod
    def get_or_init(cls, user_id: str) -> Dict[str, Any]:
        """Fetch or initialize local gamification status for a user."""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            # Get user's timezone from reminder settings
            tz_name = "UTC"
            try:
                cursor.execute("SELECT timezone FROM local_reminder_settings WHERE user_id = ?", (user_id,))
                sett_row = cursor.fetchone()
                if sett_row and sett_row["timezone"]:
                    tz_name = sett_row["timezone"]
            except Exception:
                pass

            import zoneinfo
            try:
                tz = zoneinfo.ZoneInfo(tz_name)
            except Exception:
                tz = timezone.utc

            now_local = datetime.now(tz)
            today_str = now_local.date().isoformat()

            cursor.execute("SELECT * FROM local_user_gamification WHERE user_id = ?", (user_id,))
            row = cursor.fetchone()
            
            if not row:
                # Initialize defaults
                default_data = {
                    "user_id": user_id,
                    "xp": 0,
                    "level": 1,
                    "streak_freezes_available": 1,
                    "last_freeze_used_at": None,
                    "last_freeze_granted_at": today_str,
                    "daily_goal": 15,
                    "current_streak": 0,
                    "longest_streak": 0,
                    "last_activity_date": None
                }
                cursor.execute("""
                    INSERT INTO local_user_gamification 
                    (user_id, xp, level, streak_freezes_available, last_freeze_used_at, last_freeze_granted_at, daily_goal, current_streak, longest_streak, last_activity_date) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    user_id, default_data["xp"], default_data["level"], 
                    default_data["streak_freezes_available"], default_data["last_freeze_used_at"],
                    default_data["last_freeze_granted_at"], default_data["daily_goal"],
                    default_data["current_streak"], default_data["longest_streak"], default_data["last_activity_date"]
                ))
                conn.commit()
                return default_data

            data = dict(row)
            
            # Check if due for weekly freeze grant (1 freeze/week)
            last_grant = data.get("last_freeze_granted_at")
            granted = False
            if last_grant:
                try:
                    last_grant_date = datetime.fromisoformat(last_grant).date()
                    if (now_local.date() - last_grant_date).days >= 7:
                        # Grant 1 freeze (cap at maximum of 3 freezes)
                        new_freezes = min(3, (data.get("streak_freezes_available") or 0) + 1)
                        cursor.execute("""
                            UPDATE local_user_gamification 
                            SET streak_freezes_available = ?, last_freeze_granted_at = ? 
                            WHERE user_id = ?
                        """, (new_freezes, today_str, user_id))
                        data["streak_freezes_available"] = new_freezes
                        data["last_freeze_granted_at"] = today_str
                        granted = True
                except Exception as ex:
                    logger.warning(f"Error calculating freeze grant: {ex}")
            else:
                cursor.execute("UPDATE local_user_gamification SET last_freeze_granted_at = ? WHERE user_id = ?", (today_str, user_id))
                data["last_freeze_granted_at"] = today_str
                granted = True

            # Process streak logic (did they miss days?)
            last_activity = data.get("last_activity_date")
            current_streak = data.get("current_streak") or 0
            
            if last_activity and current_streak > 0:
                try:
                    last_act_date = datetime.fromisoformat(last_activity).date()
                    days_diff = (now_local.date() - last_act_date).days
                    
                    if days_diff > 1:
                        # Missed day(s)! Can we use a streak freeze?
                        freezes = data.get("streak_freezes_available") or 0
                        
                        # Apply freeze if missed exactly yesterday (days_diff == 2) and freeze is available
                        # Wait, what if it's more than 2? Then streak is lost
                        if days_diff == 2 and freezes > 0:
                            yesterday_str = (now_local - timedelta(days=1)).date().isoformat()
                            cursor.execute("""
                                UPDATE local_user_gamification 
                                SET streak_freezes_available = ?, last_freeze_used_at = ?, last_activity_date = ? 
                                WHERE user_id = ?
                            """, (freezes - 1, yesterday_str, yesterday_str, user_id))
                            data["streak_freezes_available"] = freezes - 1
                            data["last_freeze_used_at"] = yesterday_str
                            data["last_activity_date"] = yesterday_str
                            logger.info(f"Used streak freeze for user {user_id} on {yesterday_str}")
                        else:
                            # Streak breaks!
                            cursor.execute("UPDATE local_user_gamification SET current_streak = 0 WHERE user_id = ?", (user_id,))
                            data["current_streak"] = 0
                            logger.info(f"Streak broken for user {user_id}. Resetting to 0.")
                except Exception as ex:
                    logger.warning(f"Error checking streak freeze fallback: {ex}")

            if granted:
                conn.commit()
                
            return data
        except Exception as e:
            logger.error(f"[GamificationService] Error getting user gamification: {e}")
            return {"user_id": user_id, "xp": 0, "level": 1, "streak_freezes_available": 0}
        finally:
            conn.close()

    @classmethod
    def record_activity(cls, user_id: str, minutes_read: float = 0, item_completed: bool = False) -> Dict[str, Any]:
        """Record activity, award XP, update streak calendar, check level-up."""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            # Get user's timezone from reminder settings
            tz_name = "UTC"
            try:
                cursor.execute("SELECT timezone FROM local_reminder_settings WHERE user_id = ?", (user_id,))
                sett_row = cursor.fetchone()
                if sett_row and sett_row["timezone"]:
                    tz_name = sett_row["timezone"]
            except Exception:
                pass

            import zoneinfo
            try:
                tz = zoneinfo.ZoneInfo(tz_name)
            except Exception:
                tz = timezone.utc

            now_local = datetime.now(tz)
            today_str = now_local.date().isoformat()
            yesterday_str = (now_local - timedelta(days=1)).date().isoformat()

            # 1. Fetch current status
            status = cls.get_or_init(user_id)
            
            # 2. Award XP
            xp_to_add = 0
            if item_completed:
                xp_to_add += 50
            if minutes_read > 0:
                # 2 XP per minute read
                xp_to_add += int(minutes_read * 2)

            # Check if daily goal met (compare today's accumulated reading time)
            # Find today's completed reading minutes
            cursor.execute("SELECT SUM(xp_earned) FROM local_streak_calendar WHERE user_id = ? AND activity_date = ?", (user_id, today_str))
            today_entry = cursor.fetchone()
            today_registered = today_entry[0] is not None
            
            # 3. Add date to calendar
            cursor.execute("""
                INSERT INTO local_streak_calendar (user_id, activity_date, xp_earned) 
                VALUES (?, ?, ?)
                ON CONFLICT(user_id, activity_date) DO UPDATE SET xp_earned = xp_earned + ?
            """, (user_id, today_str, xp_to_add, xp_to_add))

            # 4. Check if daily goal met
            # Retrieve daily goal
            daily_goal = status.get("daily_goal") or 15
            
            # 5. Update streaks
            current_streak = status.get("current_streak") or 0
            longest_streak = status.get("longest_streak") or 0
            last_activity = status.get("last_activity_date")
            
            if last_activity != today_str:
                if last_activity == yesterday_str:
                    current_streak += 1
                elif last_activity is None or current_streak == 0:
                    current_streak = 1
                else:
                    # Gaps occurred but not frozen
                    current_streak = 1
                
                longest_streak = max(longest_streak, current_streak)

            # 6. Apply Level-up logic
            current_xp = (status.get("xp") or 0) + xp_to_add
            current_level = status.get("level") or 1
            
            # Simple level-up threshold: level * 200 XP
            xp_needed = current_level * 200
            while current_xp >= xp_needed:
                current_xp -= xp_needed
                current_level += 1
                xp_needed = current_level * 200
                logger.info(f"User {user_id} leveled up to {current_level}!")

            # 7. Save to DB
            cursor.execute("""
                UPDATE local_user_gamification 
                SET xp = ?, level = ?, current_streak = ?, longest_streak = ?, last_activity_date = ? 
                WHERE user_id = ?
            """, (current_xp, current_level, current_streak, longest_streak, today_str, user_id))
            
            conn.commit()
            
            return {
                "xp": current_xp,
                "level": current_level,
                "current_streak": current_streak,
                "longest_streak": longest_streak,
                "xp_added": xp_to_add
            }
        except Exception as e:
            logger.error(f"[GamificationService] Error recording activity: {e}")
            if conn:
                conn.rollback()
            return {}
        finally:
            conn.close()

    @classmethod
    def get_calendar(cls, user_id: str) -> List[str]:
        """Fetch all dates user completed activity (for calendar render)."""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT activity_date FROM local_streak_calendar WHERE user_id = ? ORDER BY activity_date ASC", (user_id,))
            rows = cursor.fetchall()
            return [r[0] for r in rows]
        except Exception as e:
            logger.error(f"[GamificationService] Error fetching calendar: {e}")
            return []
        finally:
            conn.close()

    @classmethod
    def use_freeze(cls, user_id: str) -> Dict[str, Any]:
        """Manually trigger/use a streak freeze (if user wants to protect today)."""
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            # Get user's timezone from reminder settings
            tz_name = "UTC"
            try:
                cursor.execute("SELECT timezone FROM local_reminder_settings WHERE user_id = ?", (user_id,))
                sett_row = cursor.fetchone()
                if sett_row and sett_row["timezone"]:
                    tz_name = sett_row["timezone"]
            except Exception:
                pass

            import zoneinfo
            try:
                tz = zoneinfo.ZoneInfo(tz_name)
            except Exception:
                tz = timezone.utc

            now_local = datetime.now(tz)
            today_str = now_local.date().isoformat()

            status = cls.get_or_init(user_id)
            freezes = status.get("streak_freezes_available") or 0
            if freezes <= 0:
                raise ValueError("No streak freezes available")
            
            # Consume freeze, mock today as active
            cursor.execute("""
                UPDATE local_user_gamification 
                SET streak_freezes_available = ?, last_freeze_used_at = ?, last_activity_date = ? 
                WHERE user_id = ?
            """, (freezes - 1, today_str, today_str, user_id))
            
            cursor.execute("""
                INSERT OR IGNORE INTO local_streak_calendar (user_id, activity_date, xp_earned) 
                VALUES (?, ?, 0)
            """, (user_id, today_str))
            
            conn.commit()
            return {"success": True, "streak_freezes_available": freezes - 1, "last_freeze_used_at": today_str}
        except Exception as e:
            logger.error(f"[GamificationService] Error using freeze: {e}")
            if conn:
                conn.rollback()
            raise e
        finally:
            conn.close()

    @classmethod
    def sync_streak_data(cls, user_id: str, supabase_client) -> Dict[str, Any]:
        """
        Recalculates user streaks and calendar cells directly from Supabase items 'completed_at' timestamps.
        Persists current_streak, longest_streak, and calendar cells in SQLite fallback database.
        """
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        try:
            # 1. Fetch user's timezone from settings
            tz_name = "UTC"
            try:
                cursor.execute("SELECT timezone FROM local_reminder_settings WHERE user_id = ?", (user_id,))
                sett_row = cursor.fetchone()
                if sett_row and sett_row["timezone"]:
                    tz_name = sett_row["timezone"]
            except Exception:
                pass

            import zoneinfo
            try:
                tz = zoneinfo.ZoneInfo(tz_name)
            except Exception:
                tz = timezone.utc

            # Time references in user's local timezone
            now_local = datetime.now(tz)
            today = now_local.date()
            yesterday = today - timedelta(days=1)

            # 2. Fetch completed items from Supabase
            completed_dates = set()
            try:
                res = supabase_client.table("items").select("completed_at").eq("user_id", user_id).eq("status", "completed").execute()
                items = res.data or []
            except Exception as e:
                logger.warning(f"[GamificationService] Supabase offline/error during streak sync: {e}")
                items = []

            # 3. Parse completion dates to local dates
            for item in items:
                completed_at_str = item.get("completed_at")
                if completed_at_str:
                    try:
                        clean_comp = completed_at_str.replace("Z", "+00:00")
                        comp_dt = datetime.fromisoformat(clean_comp)
                        if comp_dt.tzinfo is None:
                            comp_dt = comp_dt.replace(tzinfo=timezone.utc)
                        local_comp_date = comp_dt.astimezone(tz).date()
                        completed_dates.add(local_comp_date)
                    except Exception:
                        pass

            # 4. Fetch streak freeze dates used from local database
            cursor.execute("SELECT activity_date FROM local_streak_calendar WHERE user_id = ? AND xp_earned = 0", (user_id,))
            freeze_rows = cursor.fetchall()
            for row in freeze_rows:
                try:
                    freeze_date = datetime.fromisoformat(row["activity_date"]).date()
                    completed_dates.add(freeze_date)
                except Exception:
                    pass

            # Also fetch last_freeze_used_at from local_user_gamification
            cursor.execute("SELECT last_freeze_used_at FROM local_user_gamification WHERE user_id = ?", (user_id,))
            user_row = cursor.fetchone()
            if user_row and user_row["last_freeze_used_at"]:
                try:
                    freeze_date = datetime.fromisoformat(user_row["last_freeze_used_at"]).date()
                    completed_dates.add(freeze_date)
                except Exception:
                    pass

            # 5. Calculate contiguous streak from completed_dates
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

            # 6. Update local_user_gamification streaks
            cursor.execute("SELECT xp, level FROM local_user_gamification WHERE user_id = ?", (user_id,))
            status_row = cursor.fetchone()
            if status_row:
                current_xp = status_row["xp"] or 0
                current_level = status_row["level"] or 1
            else:
                current_xp = 0
                current_level = 1

            cursor.execute("""
                INSERT INTO local_user_gamification 
                (user_id, xp, level, streak_freezes_available, current_streak, longest_streak, last_activity_date)
                VALUES (?, ?, ?, 1, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET 
                    current_streak = ?, 
                    longest_streak = ?, 
                    last_activity_date = ?
            """, (
                user_id, current_xp, current_level, current_streak, longest_streak, 
                today.isoformat() if today in completed_dates else None,
                current_streak, longest_streak,
                today.isoformat() if today in completed_dates else None
            ))

            # 7. Rebuild local_streak_calendar for this user
            for d in completed_dates:
                d_str = d.isoformat()
                cursor.execute("""
                    INSERT OR IGNORE INTO local_streak_calendar (user_id, activity_date, xp_earned)
                    VALUES (?, ?, 50)
                """, (user_id, d_str))

            conn.commit()
            return {
                "current_streak": current_streak,
                "longest_streak": longest_streak,
                "calendar": [d.isoformat() for d in completed_dates]
            }
        except Exception as e:
            logger.error(f"[GamificationService] Error syncing streaks: {e}")
            if conn:
                conn.rollback()
            return {}
        finally:
            conn.close()
