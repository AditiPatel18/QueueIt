import os
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api.auth import router as auth_router
from api.items import router as items_router
from api.collections import router as collections_router
from api.notifications import router as notification_router
from api.chat import router as chat_router
from api.analytics import router as analytics_router
from api.reminders import router as reminders_router
from utils.supabase_client import supabase
from config import FRONTEND_URL, get_settings

app = FastAPI(title="QueueIt API", version="1.0.0")

background_tasks_store = set()

@app.on_event("startup")
async def startup_event():
    import asyncio
    from api.items import recover_processing_items, quota_retry_scheduler
    from services.vector_service import backfill_all_embeddings
    from services.scheduler_service import start_reminder_scheduler
    
    t1 = asyncio.create_task(recover_processing_items())
    t2 = asyncio.create_task(backfill_all_embeddings())
    t3 = asyncio.create_task(quota_retry_scheduler())
    t4 = asyncio.create_task(start_reminder_scheduler())
    
    for t in (t1, t2, t3, t4):
        background_tasks_store.add(t)
        t.add_done_callback(background_tasks_store.discard)


os.makedirs(get_settings().STATIC_AUDIO_PATH, exist_ok=True)
app.mount("/static/audio", StaticFiles(directory=get_settings().STATIC_AUDIO_PATH), name="audio")

os.makedirs("static/favicons", exist_ok=True)
app.mount("/static/favicons", StaticFiles(directory="static/favicons"), name="favicons")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(items_router, prefix="/api")
app.include_router(collections_router, prefix="/api")
app.include_router(notification_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(analytics_router, prefix="/api")
app.include_router(reminders_router, prefix="/api")


@app.get("/health")
async def health_check():
    from datetime import datetime, timezone
    # 1. DB check
    db_status = "connected"
    db_err = None
    try:
        supabase.table("items").select("id").limit(1).execute()
    except Exception as e:
        db_status = "disconnected"
        db_err = str(e)

    # 2. Scheduler check
    from services.scheduler_service import SCHEDULER_HEALTH
    scheduler_status = "healthy"
    now = datetime.now(timezone.utc)
    sch_last = SCHEDULER_HEALTH.get("scheduler_last_run")
    wrk_last = SCHEDULER_HEALTH.get("worker_last_run")
    if not sch_last or not wrk_last:
        scheduler_status = "starting"
    else:
        try:
            sch_dt = datetime.fromisoformat(sch_last)
            wrk_dt = datetime.fromisoformat(wrk_last)
            if (now - sch_dt).total_seconds() > 120 or (now - wrk_dt).total_seconds() > 120:
                scheduler_status = "unhealthy"
        except Exception:
            scheduler_status = "unhealthy"

    # 3. Email service check
    from services.notification_service import NotificationService
    email_health = NotificationService.get_email_health()

    # 4. Streak service check
    streak_status = "healthy"
    streak_db_status = "connected"
    streak_err = None
    try:
        import sqlite3
        from utils.schema_fallback import DB_PATH
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM local_user_gamification LIMIT 1")
        cursor.fetchone()
        conn.close()
    except Exception as e:
        streak_status = "unhealthy"
        streak_db_status = "disconnected"
        streak_err = str(e)

    overall_status = "ok"
    if db_status == "disconnected" or scheduler_status == "unhealthy" or streak_status == "unhealthy":
        overall_status = "error"

    return {
        "status": overall_status,
        "database": db_status,
        "database_error": db_err,
        "scheduler": {
            "status": scheduler_status,
            "scheduler_last_run": sch_last,
            "worker_last_run": wrk_last
        },
        "email": email_health,
        "streak": {
            "status": streak_status,
            "database": streak_db_status,
            "error": streak_err
        },
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/api/health")
async def api_health_check():
    return await health_check()


@app.get("/api/debug/ingestion/{item_id}")
async def debug_ingestion(item_id: str):
    from api.items import ingestion_debug_info
    from fastapi import HTTPException
    
    if item_id not in ingestion_debug_info:
        try:
            res = supabase.table("items").select("id, processing_status, ai_summary").eq("id", item_id).execute()
            if res.data:
                item = res.data[0]
                return {
                    "pipeline_stage": item.get("processing_status"),
                    "logs": [f"Item exists in database. Current status: {item.get('processing_status')}"],
                    "error": None if item.get("processing_status") == "completed" else "Unknown error/session expired"
                }
        except Exception:
            pass
        raise HTTPException(status_code=404, detail=f"No ingestion debug session found for ID {item_id}")
    return ingestion_debug_info[item_id]


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)