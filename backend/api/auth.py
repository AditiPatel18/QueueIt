"""
Auth routes.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Any, Optional
from utils.supabase_client import supabase
from middleware.auth import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])

class SignupRequest(BaseModel):
    email: str
    password: str
    name: str

class LoginRequest(BaseModel):
    email: str
    password: str

def format_response(success: bool, data: Any = None, error: Optional[str] = None) -> dict:
    return {"success": success, "data": data, "error": error}

@router.post("/signup")
async def signup(req: SignupRequest):
    try:
        res = supabase.auth.sign_up({
            "email": req.email,
            "password": req.password,
            "options": {
                "data": {
                    "name": req.name
                }
            }
        })
        if res.user is None:
            raise Exception("Signup failed")
        # supabase-py sometimes returns an object that can't be directly jsonified without dict()
        return format_response(True, {"user": res.user.model_dump()})
    except Exception as e:
        raise HTTPException(status_code=400, detail=format_response(False, None, str(e)))

@router.post("/login")
async def login(req: LoginRequest):
    try:
        res = supabase.auth.sign_in_with_password({
            "email": req.email,
            "password": req.password
        })
        if res.session is None:
            raise Exception("Login failed")
        return format_response(True, {
            "session": res.session.model_dump(),
            "user": res.user.model_dump() if res.user else None
        })
    except Exception as e:
        raise HTTPException(status_code=401, detail=format_response(False, None, str(e)))

@router.get("/me")
async def get_me(user: dict = Depends(get_current_user)):
    return format_response(True, {"user": user})
