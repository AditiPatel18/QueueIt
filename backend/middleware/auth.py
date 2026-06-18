from fastapi import Request, HTTPException, status
from supabase import create_client
from config import get_settings
import logging

logger = logging.getLogger(__name__)

def get_current_user(request: Request) -> dict:
    settings = get_settings()

    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header",
        )

    token = auth_header.split(" ")[1]

    try:
        # Use Supabase client to verify token natively
        supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)
        response = supabase.auth.get_user(token)
        
        if not response.user:
            raise Exception("User not found or token invalid")
            
        user_dict = response.user.model_dump()
        user_dict["sub"] = user_dict["id"] # Compatibility with existing code
        return user_dict
        
    except Exception as e:
        logger.error(f"JWT Verification Error: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )