import os
import sqlite3
import requests
import logging
from typing import Dict, Any, List, Optional
from config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "local_fallback.db")

class SchemaFallbackManager:
    def __init__(self):
        self.has_collections_table = False
        self.has_collection_id = False
        self.has_read_progress = False
        self.has_notes = False
        self.has_source_type = False
        self.has_source_domain = False
        self.has_logo_url = False
        self.has_audio_url = False
        self.has_is_favorite = False
        self.has_full_summary = False
        self.has_estimated_time_minutes = False
        self.has_actual_time_spent = False
        self.has_normalized_url = False
        self.initialized = False
        self.detect_schema()
        self.init_sqlite()

    def get_optimized_select_string(self) -> str:
        """Return a comma-separated select string of columns excluding heavy text fields."""
        cols = [
            "id", "user_id", "url", "content_type", "title", "description", "author", 
            "thumbnail_url", "source_name", "estimated_read_time", "duration_seconds", 
            "status", "processing_status", "tags", "ai_summary", "priority_score", 
            "created_at", "updated_at"
        ]
        if self.has_source_type:
            cols.append("source_type")
        if self.has_source_domain:
            cols.append("source_domain")
        if self.has_logo_url:
            cols.append("logo_url")
        if self.has_audio_url:
            cols.append("audio_url")
        if self.has_is_favorite:
            cols.append("is_favorite")
        if self.has_collection_id:
            cols.append("collection_id")
        if self.has_read_progress:
            cols.append("read_progress")
        if self.has_notes:
            cols.append("notes")
        if self.has_full_summary:
            cols.append("full_summary")
        if self.has_estimated_time_minutes:
            cols.append("estimated_time_minutes")
        if self.has_actual_time_spent:
            cols.append("actual_time_spent")
        if self.has_normalized_url:
            cols.append("normalized_url")
        return ",".join(cols)

    def detect_schema(self):
        """Query the PostgREST API schema to check what actually exists in Supabase."""
        try:
            url = f"{SUPABASE_URL}/rest/v1/?apikey={SUPABASE_SERVICE_ROLE_KEY}"
            response = requests.get(url, timeout=5)
            if response.status_code == 200:
                schema = response.json()
                definitions = schema.get("definitions", {})
                
                # Check for collections table
                self.has_collections_table = "collections" in definitions
                
                # Check for items columns
                items_def = definitions.get("items", {})
                properties = items_def.get("properties", {})
                self.has_collection_id = "collection_id" in properties
                self.has_read_progress = "read_progress" in properties
                self.has_notes = "notes" in properties
                self.has_source_type = "source_type" in properties
                self.has_source_domain = "source_domain" in properties
                self.has_logo_url = "logo_url" in properties
                self.has_audio_url = "audio_url" in properties
                self.has_is_favorite = "is_favorite" in properties
                self.has_full_summary = "full_summary" in properties
                self.has_estimated_time_minutes = "estimated_time_minutes" in properties
                self.has_actual_time_spent = "actual_time_spent" in properties
                self.has_normalized_url = "normalized_url" in properties
                
                logger.info(
                    f"[SchemaFallback] Remote schema status: "
                    f"collections_table={self.has_collections_table}, "
                    f"collection_id={self.has_collection_id}, "
                    f"read_progress={self.has_read_progress}, "
                    f"notes={self.has_notes}, "
                    f"source_type={self.has_source_type}, "
                    f"source_domain={self.has_source_domain}, "
                    f"logo_url={self.has_logo_url}, "
                    f"audio_url={self.has_audio_url}, "
                    f"is_favorite={self.has_is_favorite}, "
                    f"full_summary={self.has_full_summary}, "
                    f"estimated_time_minutes={self.has_estimated_time_minutes}, "
                    f"actual_time_spent={self.has_actual_time_spent}, "
                    f"normalized_url={self.has_normalized_url}"
                )
            else:
                logger.error(f"[SchemaFallback] Failed to fetch schema: {response.status_code}")
        except Exception as e:
            logger.error(f"[SchemaFallback] Error detecting schema, using local fallback: {e}")

    def init_sqlite(self):
        """Initialize the local SQLite database for fallback storage if needed."""
        conn = None
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            # Local collections table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS local_collections (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    color TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)
            
            # Local item metadata table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS local_item_meta (
                    item_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    collection_id TEXT,
                    read_progress INTEGER DEFAULT 0,
                    notes TEXT,
                    full_summary TEXT
                )
            """)
            try:
                cursor.execute("ALTER TABLE local_item_meta ADD COLUMN full_summary TEXT")
            except sqlite3.OperationalError:
                # Column already exists
                pass
            try:
                cursor.execute("ALTER TABLE local_item_meta ADD COLUMN estimated_time_minutes REAL")
            except sqlite3.OperationalError:
                # Column already exists
                pass
            try:
                cursor.execute("ALTER TABLE local_item_meta ADD COLUMN actual_time_spent REAL DEFAULT 0.0")
            except sqlite3.OperationalError:
                # Column already exists
                pass
            try:
                cursor.execute("ALTER TABLE local_item_meta ADD COLUMN normalized_url TEXT")
            except sqlite3.OperationalError:
                # Column already exists
                pass
            
            # Local item tracking table (opens, recommendations, etc.)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS local_item_tracking (
                    item_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    last_opened_at TEXT,
                    last_recommended_at TEXT,
                    recommendation_count INTEGER DEFAULT 0
                )
            """)

            # Local item embeddings table for vector search
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS local_item_embeddings (
                    item_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    embedding TEXT NOT NULL,
                    text_hash TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_embeddings_user_id ON local_item_embeddings(user_id)")

            # Local reminder settings table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS local_reminder_settings (
                    user_id TEXT PRIMARY KEY,
                    enabled INTEGER DEFAULT 1,
                    reminder_time TEXT DEFAULT '09:00',
                    snoozed_until TEXT,
                    last_reminded_at TEXT
                )
            """)

            # Run settings migrations
            for col_def in [
                ("frequency", "TEXT DEFAULT 'daily'"),
                ("custom_days", "TEXT DEFAULT ''"),
                ("timezone", "TEXT DEFAULT 'UTC'"),
                ("browser_notifications", "INTEGER DEFAULT 1"),
                ("email_reminders", "INTEGER DEFAULT 1"),
                ("sms_reminders", "INTEGER DEFAULT 0"),
                ("phone_number", "TEXT DEFAULT ''"),
                ("email_address", "TEXT DEFAULT ''"),
                ("last_sent_date", "TEXT")
            ]:
                try:
                    cursor.execute(f"ALTER TABLE local_reminder_settings ADD COLUMN {col_def[0]} {col_def[1]}")
                except sqlite3.OperationalError:
                    pass

            # Local user gamification table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS local_user_gamification (
                    user_id TEXT PRIMARY KEY,
                    xp INTEGER DEFAULT 0,
                    level INTEGER DEFAULT 1,
                    streak_freezes_available INTEGER DEFAULT 1,
                    last_freeze_used_at TEXT,
                    last_freeze_granted_at TEXT,
                    daily_goal INTEGER DEFAULT 15,
                    current_streak INTEGER DEFAULT 0,
                    longest_streak INTEGER DEFAULT 0,
                    last_activity_date TEXT
                )
            """)

            # Run gamification table migrations
            for col_def in [
                ("last_freeze_granted_at", "TEXT")
            ]:
                try:
                    cursor.execute(f"ALTER TABLE local_user_gamification ADD COLUMN {col_def[0]} {col_def[1]}")
                except sqlite3.OperationalError:
                    pass

            # Local streak calendar table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS local_streak_calendar (
                    user_id TEXT,
                    activity_date TEXT,
                    xp_earned INTEGER DEFAULT 0,
                    PRIMARY KEY (user_id, activity_date)
                )
            """)

            # Local reminder history table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS local_reminder_history (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    item_id TEXT,
                    title TEXT,
                    scheduled_time TEXT,
                    sent_at TEXT,
                    status TEXT,
                    channel TEXT,
                    completed_at TEXT
                )
            """)

            # Run history migrations
            for col_def in [
                ("retry_count", "INTEGER DEFAULT 0"),
                ("error_message", "TEXT DEFAULT ''"),
                ("delivery_logs", "TEXT DEFAULT ''")
            ]:
                try:
                    cursor.execute(f"ALTER TABLE local_reminder_history ADD COLUMN {col_def[0]} {col_def[1]}")
                except sqlite3.OperationalError:
                    pass
            
            # Create indexes for performance optimization
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_reminder_history_user_status ON local_reminder_history(user_id, status, sent_at)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_streak_calendar_user ON local_streak_calendar(user_id)")
            
            conn.commit()
            self.initialized = True
            logger.info("[SchemaFallback] SQLite fallback database initialized successfully.")
        except Exception as e:
            logger.error(f"[SchemaFallback] Failed to initialize SQLite database: {e}")
            if conn:
                try:
                    conn.rollback()
                except Exception:
                    pass
        finally:
            if conn:
                conn.close()

    # ---------- Collections Fallback Operations ----------
    def list_collections(self, user_id: str, supabase_client) -> List[Dict[str, Any]]:
        if self.has_collections_table:
            try:
                res = supabase_client.table("collections").select("*").eq("user_id", user_id).order("created_at").execute()
                return res.data or []
            except Exception as e:
                logger.error(f"[SchemaFallback] Failed remote collections fetch: {e}")
                # Fallback to local
        
        # Local SQLite fallback
        conn = None
        try:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM local_collections WHERE user_id = ? ORDER BY created_at ASC", (user_id,)
            )
            rows = cursor.fetchall()
            return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"[SchemaFallback] Failed local collections fetch: {e}")
            return []
        finally:
            if conn:
                conn.close()

    def create_collection(self, user_id: str, name: str, color: str, supabase_client) -> Dict[str, Any]:
        import uuid
        from datetime import datetime, timezone
        
        col_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat()
        
        if self.has_collections_table:
            try:
                res = supabase_client.table("collections").insert({
                    "name": name,
                    "color": color,
                    "user_id": user_id
                }).execute()
                if res.data:
                    return res.data[0]
            except Exception as e:
                logger.error(f"[SchemaFallback] Failed remote collection creation: {e}")
        
        # Local SQLite fallback
        conn = None
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO local_collections (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)",
                (col_id, user_id, name, color, created_at)
            )
            conn.commit()
            return {
                "id": col_id,
                "user_id": user_id,
                "name": name,
                "color": color,
                "created_at": created_at
            }
        except Exception as e:
            logger.error(f"[SchemaFallback] Failed local collection creation: {e}")
            if conn:
                try:
                    conn.rollback()
                except Exception:
                    pass
            raise e
        finally:
            if conn:
                conn.close()

    def update_collection(self, user_id: str, col_id: str, name: Optional[str], color: Optional[str], supabase_client) -> Dict[str, Any]:
        if self.has_collections_table:
            try:
                updates = {}
                if name is not None:
                    updates["name"] = name
                if color is not None:
                    updates["color"] = color
                res = supabase_client.table("collections").update(updates).eq("id", col_id).eq("user_id", user_id).execute()
                if res.data:
                    return res.data[0]
            except Exception as e:
                logger.error(f"[SchemaFallback] Failed remote collection update: {e}")
        
        # Local SQLite fallback
        conn = None
        try:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # Fetch existing
            cursor.execute("SELECT * FROM local_collections WHERE id = ? AND user_id = ?", (col_id, user_id))
            existing = cursor.fetchone()
            if not existing:
                raise ValueError("Collection not found")
                
            existing_dict = dict(existing)
            new_name = name if name is not None else existing_dict["name"]
            new_color = color if color is not None else existing_dict["color"]
            
            cursor.execute(
                "UPDATE local_collections SET name = ?, color = ? WHERE id = ? AND user_id = ?",
                (new_name, new_color, col_id, user_id)
            )
            conn.commit()
            
            existing_dict["name"] = new_name
            existing_dict["color"] = new_color
            return existing_dict
        except Exception as e:
            logger.error(f"[SchemaFallback] Failed local collection update: {e}")
            if conn:
                try:
                    conn.rollback()
                except Exception:
                    pass
            raise e
        finally:
            if conn:
                conn.close()

    def delete_collection(self, user_id: str, col_id: str, supabase_client) -> bool:
        if self.has_collections_table:
            try:
                res = supabase_client.table("collections").delete().eq("id", col_id).eq("user_id", user_id).execute()
                if res.data:
                    return True
            except Exception as e:
                logger.error(f"[SchemaFallback] Failed remote collection delete: {e}")
                
        # Local SQLite fallback
        conn = None
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("DELETE FROM local_collections WHERE id = ? AND user_id = ?", (col_id, user_id))
            # Also clear collection_id reference in local item meta
            cursor.execute("UPDATE local_item_meta SET collection_id = NULL WHERE collection_id = ?", (col_id,))
            conn.commit()
            return True
        except Exception as e:
            logger.error(f"[SchemaFallback] Failed local collection delete: {e}")
            if conn:
                try:
                    conn.rollback()
                except Exception:
                    pass
            return False
        finally:
            if conn:
                conn.close()

    # ---------- Item Metadata Fallback Operations ----------
    def merge_items_metadata(self, user_id: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Join SQLite-stored metadata (notes, read_progress, collection_id, full_summary, estimated_time_minutes, actual_time_spent) for items if remote tables are not migrated."""
        if not items:
            return items
            
        needs_collection_id = not self.has_collection_id
        needs_read_progress = not self.has_read_progress
        needs_notes = not self.has_notes
        needs_full_summary = not self.has_full_summary
        needs_estimated_time_minutes = not self.has_estimated_time_minutes
        needs_actual_time_spent = not self.has_actual_time_spent
        
        if not (needs_collection_id or needs_read_progress or needs_notes or needs_full_summary or needs_estimated_time_minutes or needs_actual_time_spent):
            return items # Fully migrated, no fallback merge required
            
        item_ids = [item["id"] for item in items if "id" in item]
        if not item_ids:
            return items
            
        conn = None
        try:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # Batch fetch local metadata
            placeholders = ",".join("?" for _ in item_ids)
            query = f"SELECT * FROM local_item_meta WHERE item_id IN ({placeholders})"
            cursor.execute(query, tuple(item_ids))
            meta_rows = cursor.fetchall()
            
            meta_map = {row["item_id"]: dict(row) for row in meta_rows}
            
            for item in items:
                i_id = item.get("id")
                local_meta = meta_map.get(i_id, {})
                
                if needs_collection_id:
                    item["collection_id"] = local_meta.get("collection_id")
                if needs_read_progress:
                    item["read_progress"] = local_meta.get("read_progress", 0)
                if needs_notes:
                    item["notes"] = local_meta.get("notes")
                if needs_full_summary:
                    item["full_summary"] = local_meta.get("full_summary")
                if needs_estimated_time_minutes:
                    item["estimated_time_minutes"] = local_meta.get("estimated_time_minutes") if local_meta.get("estimated_time_minutes") is not None else 5.0
                if needs_actual_time_spent:
                    item["actual_time_spent"] = local_meta.get("actual_time_spent") if local_meta.get("actual_time_spent") is not None else 0.0
                    
            return items
        except Exception as e:
            logger.error(f"[SchemaFallback] Failed local metadata merge: {e}")
            return items
        finally:
            if conn:
                conn.close()

    def merge_single_item_metadata(self, user_id: str, item: Dict[str, Any]) -> Dict[str, Any]:
        merged = self.merge_items_metadata(user_id, [item])
        return merged[0] if merged else item

    def update_item_metadata(self, user_id: str, item_id: str, updates: Dict[str, Any], supabase_client) -> Dict[str, Any]:
        """Update metadata fields either on remote Supabase or local SQLite depending on schema availability."""
        remote_updates = {}
        local_updates = {}
        
        # Split fields based on schema availability
        for field in ["collection_id", "read_progress", "notes", "full_summary", "estimated_time_minutes", "actual_time_spent"]:
            if field in updates:
                val = updates[field]
                # Is the field available on remote?
                if (field == "collection_id" and self.has_collection_id) or \
                   (field == "read_progress" and self.has_read_progress) or \
                   (field == "notes" and self.has_notes) or \
                   (field == "full_summary" and self.has_full_summary) or \
                   (field == "estimated_time_minutes" and self.has_estimated_time_minutes) or \
                   (field == "actual_time_spent" and self.has_actual_time_spent):
                    remote_updates[field] = val
                else:
                    local_updates[field] = val
                    
        # Apply remote updates if any
        if remote_updates:
            try:
                supabase_client.table("items").update(remote_updates).eq("id", item_id).execute()
            except Exception as e:
                logger.error(f"[SchemaFallback] Failed remote item metadata update: {e}")
                
        # Apply local updates if any
        if local_updates:
            conn = None
            try:
                conn = sqlite3.connect(DB_PATH)
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                # Check if record exists
                cursor.execute("SELECT * FROM local_item_meta WHERE item_id = ?", (item_id,))
                existing = cursor.fetchone()
                
                if existing:
                    existing_dict = dict(existing)
                    new_col = local_updates.get("collection_id", existing_dict.get("collection_id"))
                    new_progress = local_updates.get("read_progress", existing_dict.get("read_progress"))
                    new_notes = local_updates.get("notes", existing_dict.get("notes"))
                    new_full_summary = local_updates.get("full_summary", existing_dict.get("full_summary"))
                    new_est_time = local_updates.get("estimated_time_minutes", existing_dict.get("estimated_time_minutes"))
                    new_time_spent = local_updates.get("actual_time_spent", existing_dict.get("actual_time_spent"))
                    
                    cursor.execute(
                        "UPDATE local_item_meta SET collection_id = ?, read_progress = ?, notes = ?, full_summary = ?, estimated_time_minutes = ?, actual_time_spent = ? WHERE item_id = ?",
                        (new_col, new_progress, new_notes, new_full_summary, new_est_time, new_time_spent, item_id)
                    )
                else:
                    cursor.execute(
                        "INSERT INTO local_item_meta (item_id, user_id, collection_id, read_progress, notes, full_summary, estimated_time_minutes, actual_time_spent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (item_id, user_id, local_updates.get("collection_id"), local_updates.get("read_progress", 0), local_updates.get("notes"), local_updates.get("full_summary"), local_updates.get("estimated_time_minutes", 5.0), local_updates.get("actual_time_spent", 0.0))
                    )
                    
                conn.commit()
            except Exception as e:
                logger.error(f"[SchemaFallback] Failed local item metadata update: {e}")
                if conn:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
            finally:
                if conn:
                    conn.close()
                
        return updates

    def delete_item_metadata(self, item_id: str):
        """Clean up local metadata if an item is deleted."""
        conn = None
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("DELETE FROM local_item_meta WHERE item_id = ?", (item_id,))
            cursor.execute("DELETE FROM local_item_tracking WHERE item_id = ?", (item_id,))
            conn.commit()
        except Exception as e:
            logger.error(f"[SchemaFallback] Failed to delete local metadata for item {item_id}: {e}")
            if conn:
                try:
                    conn.rollback()
                except Exception:
                    pass
        finally:
            if conn:
                conn.close()

    def get_collection_stats(self, user_id: str, supabase_client) -> Dict[str, Dict[str, int]]:
        """Calculate item count and total read time (in minutes) for each collection of a user."""
        select_cols = "id, estimated_read_time, status"
        if self.has_collection_id:
            select_cols = "id, collection_id, estimated_read_time, status"

        try:
            res = supabase_client.table("items").select(select_cols).eq("user_id", user_id).execute()
            items = res.data or []
        except Exception as e:
            logger.error(f"[SchemaFallback] Failed to fetch items for stats calculation: {e}")
            items = []

        if not self.has_collection_id:
            items = self.merge_items_metadata(user_id, items)

        stats_map = {}
        for item in items:
            col_id = item.get("collection_id")
            if not col_id:
                continue
            if item.get("status") == "completed":
                continue

            read_time = item.get("estimated_read_time") or 0
            try:
                read_time = int(read_time)
            except (TypeError, ValueError):
                read_time = 0

            if col_id not in stats_map:
                stats_map[col_id] = {"item_count": 0, "read_time_minutes": 0}

            stats_map[col_id]["item_count"] += 1
            stats_map[col_id]["read_time_minutes"] += read_time

        return stats_map

    # ---------- Recommendation & Tracking Operations ----------
    def record_item_open(self, user_id: str, item_id: str):
        """Record when an item is opened or progress is updated."""
        conn = None
        try:
            from datetime import datetime, timezone
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            now_str = datetime.now(timezone.utc).isoformat()
            cursor.execute("""
                INSERT INTO local_item_tracking (item_id, user_id, last_opened_at)
                VALUES (?, ?, ?)
                ON CONFLICT(item_id) DO UPDATE SET last_opened_at = excluded.last_opened_at
            """, (item_id, user_id, now_str))
            conn.commit()
        except Exception as e:
            logger.error(f"[SchemaFallback] Failed to record item open: {e}")
            if conn:
                try:
                    conn.rollback()
                except Exception:
                    pass
        finally:
            if conn:
                conn.close()

    def record_item_recommendation(self, user_id: str, item_id: str):
        """Record when an item is recommended to a user."""
        conn = None
        try:
            from datetime import datetime, timezone
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            now_str = datetime.now(timezone.utc).isoformat()
            cursor.execute("""
                INSERT INTO local_item_tracking (item_id, user_id, last_recommended_at, recommendation_count)
                VALUES (?, ?, ?, 1)
                ON CONFLICT(item_id) DO UPDATE SET 
                    last_recommended_at = excluded.last_recommended_at,
                    recommendation_count = recommendation_count + 1
            """, (item_id, user_id, now_str))
            conn.commit()
        except Exception as e:
            logger.error(f"[SchemaFallback] Failed to record item recommendation: {e}")
            if conn:
                try:
                    conn.rollback()
                except Exception:
                    pass
        finally:
            if conn:
                conn.close()

    def get_item_tracking(self, user_id: str) -> Dict[str, Dict[str, Any]]:
        """Get all tracking info (last opened, last recommended, count) for the user's items."""
        conn = None
        try:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM local_item_tracking WHERE user_id = ?", (user_id,))
            rows = cursor.fetchall()
            return {row["item_id"]: dict(row) for row in rows}
        except Exception as e:
            logger.error(f"[SchemaFallback] Failed to fetch item tracking: {e}")
            return {}
        finally:
            if conn:
                conn.close()

# Global singleton fallback manager
fallback_db = SchemaFallbackManager()
