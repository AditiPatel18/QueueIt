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
from api.notifications import router as notification_router
from utils.supabase_client import supabase
from config import FRONTEND_URL, get_settings

app = FastAPI(title="QueueIt API", version="1.0.0")

os.makedirs(get_settings().STATIC_AUDIO_PATH, exist_ok=True)
app.mount("/static/audio", StaticFiles(directory=get_settings().STATIC_AUDIO_PATH), name="audio")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000", "chrome-extension://"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(items_router, prefix="/api")
app.include_router(notification_router, prefix="/api")


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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)