from fastapi import Request, HTTPException, status
from utils.supabase_client import supabase as _supabase_client
import logging

logger = logging.getLogger(__name__)


def get_current_user(request: Request) -> dict:
    """
    Validate a Supabase Bearer token from the Authorization header.
    Uses the pre-initialized global Supabase client (with monkeypatch applied)
    to call auth.get_user(token) — the authoritative server-side validation.
    Only returns 401 when Supabase explicitly rejects the token.
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        logger.warning("[AUTH] Missing or malformed Authorization header")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header",
        )

    # Strip 'Bearer ' prefix
    token = auth_header[7:].strip()

    if not token:
        logger.warning("[AUTH] Empty token after stripping Bearer prefix")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Empty authorization token",
        )

    try:
        # Validate token using Supabase's server-side user lookup.
        # Uses the global singleton client to avoid re-running key format validation.
        response = _supabase_client.auth.get_user(token)

        if not response or not response.user:
            logger.warning("[AUTH] Supabase returned no user for token")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
            )

        user_dict = response.user.model_dump()
        user_dict["sub"] = user_dict["id"]  # Compatibility alias used across the codebase
        logger.debug("[AUTH] Authenticated user_id=%s", user_dict["id"])
        return user_dict

    except HTTPException:
        # Re-raise cleanly — don't wrap in another HTTPException
        raise

    except Exception as e:
        err_str = str(e)
        logger.error("[AUTH] Token verification failed: %s", err_str)

        # Distinguish Supabase auth rejection from other failures for precise error messages
        if any(phrase in err_str.lower() for phrase in (
            "invalid", "expired", "jwt", "token", "unauthorized", "forbidden", "not found"
        )):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
            )

        # Unexpected server-side error (network, Supabase outage, etc.) — 500, not 401
        logger.error("[AUTH] Unexpected error during token verification", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication service error. Please try again.",
        )