import os
import logging
import httpx
from bs4 import BeautifulSoup
from urllib.parse import urlparse, urljoin
from pathlib import Path

logger = logging.getLogger(__name__)

# Ensure favicons directory exists on startup
FAVICONS_DIR = Path("static/favicons")
os.makedirs(FAVICONS_DIR, exist_ok=True)

# Write generic globe SVG if it doesn't exist
GLOBE_SVG_PATH = FAVICONS_DIR / "generic_globe.svg"
if not GLOBE_SVG_PATH.is_file():
    globe_svg = """<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>"""
    try:
        GLOBE_SVG_PATH.write_text(globe_svg, encoding="utf-8")
    except Exception as e:
        logger.error("Failed to write generic_globe.svg: %s", e)


def get_and_cache_favicon(domain: str) -> str:
    """
    Fetch favicon for the domain, cache it locally under static/favicons/{domain}.png,
    and return the relative path.
    Falls back to a generic globe icon if unavailable.
    """
    if not domain:
        return "/static/favicons/generic_globe.svg"

    # Standardize domain name (lowercase, no www.)
    domain = domain.lower().strip()
    if domain.startswith("www."):
        domain = domain[4:]

    if not domain:
        return "/static/favicons/generic_globe.svg"

    cached_file_name = f"{domain}.png"
    cached_path = FAVICONS_DIR / cached_file_name
    relative_url = f"/static/favicons/{cached_file_name}"

    # Return cached icon if exists
    if cached_path.is_file():
        return relative_url

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    # Attempt 1: Google Favicon service
    google_favicon_url = f"https://www.google.com/s2/favicons?sz=64&domain={domain}"
    try:
        with httpx.Client(timeout=5.0, follow_redirects=True) as client:
            resp = client.get(google_favicon_url, headers=headers)
            # Make sure it's a valid non-empty response
            if resp.status_code == 200 and len(resp.content) > 100:
                # Save to cache
                cached_path.write_bytes(resp.content)
                logger.info("Successfully cached favicon via Google for %s", domain)
                return relative_url
    except Exception as e:
        logger.warning("Google favicon service failed for %s: %s", domain, e)

    # Attempt 2: Site HTML parsing
    try:
        site_url = f"https://{domain}"
        with httpx.Client(timeout=5.0, follow_redirects=True) as client:
            resp = client.get(site_url, headers=headers)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                icon_link = None
                
                # Check for rel="icon" or rel="shortcut icon"
                for link in soup.find_all("link"):
                    rel = [r.lower() for r in (link.get("rel") or [])]
                    if "icon" in rel or "shortcut" in rel:
                        href = link.get("href")
                        if href:
                            icon_link = urljoin(site_url, href)
                            break
                
                # Fallback to standard /favicon.ico path
                if not icon_link:
                    icon_link = urljoin(site_url, "/favicon.ico")

                if icon_link:
                    icon_resp = client.get(icon_link, headers=headers)
                    if icon_resp.status_code == 200 and len(icon_resp.content) > 100:
                        cached_path.write_bytes(icon_resp.content)
                        logger.info("Successfully cached favicon via site HTML for %s", domain)
                        return relative_url
    except Exception as e:
        logger.warning("Site HTML favicon parsing failed for %s: %s", domain, e)

    # Fallback to generic globe icon
    return "/static/favicons/generic_globe.svg"
