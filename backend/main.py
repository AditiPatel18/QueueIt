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
from utils.supabase_client import supabase
from config import FRONTEND_URL, get_settings

app = FastAPI(title="QueueIt API", version="1.0.0")

@app.on_event("startup")
async def startup_event():
    import asyncio
    from api.items import recover_processing_items, quota_retry_scheduler
    from services.vector_service import backfill_all_embeddings
    asyncio.create_task(recover_processing_items())
    asyncio.create_task(backfill_all_embeddings())
    asyncio.create_task(quota_retry_scheduler())


os.makedirs(get_settings().STATIC_AUDIO_PATH, exist_ok=True)
app.mount("/static/audio", StaticFiles(directory=get_settings().STATIC_AUDIO_PATH), name="audio")

os.makedirs("static/favicons", exist_ok=True)
app.mount("/static/favicons", StaticFiles(directory="static/favicons"), name="favicons")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000", "chrome-extension://"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(items_router, prefix="/api")
app.include_router(collections_router, prefix="/api")
app.include_router(notification_router, prefix="/api")
app.include_router(chat_router, prefix="/api")


@app.get("/health")
async def health_check():
    try:
        # Quick DB ping
        supabase.table("items").select("id").limit(1).execute()
        return {"status": "ok", "database": "connected"}
    except Exception as e:
        return {"status": "error", "database": str(e)}


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