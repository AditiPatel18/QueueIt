"""
Content extraction orchestrator.
Detects the source type from a URL and routes to the appropriate extractor.
Falls back to generic extraction if a specific extractor fails.
"""

import asyncio
import logging
from urllib.parse import urlparse

from services.article_extractor import extract_article
from services.youtube_extractor import extract_youtube
from services.twitter_extractor import extract_twitter
from services.reddit_extractor import extract_reddit
from services.github_extractor import extract_github
from services.leetcode_extractor import extract_leetcode
from services.instagram_extractor import extract_instagram
from services.pdf_extractor import extract_pdf
from services.generic_extractor import extract_generic
from services.favicon_service import get_and_cache_favicon

logger = logging.getLogger(__name__)

_YOUTUBE_DOMAINS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}
_TWITTER_DOMAINS = {"twitter.com", "www.twitter.com", "x.com", "www.x.com"}
_REDDIT_DOMAINS = {"reddit.com", "www.reddit.com", "old.reddit.com", "redd.it"}
_GITHUB_DOMAINS = {"github.com", "www.github.com"}


def detect_source_type(url: str) -> str:
    """
    Classify a URL into a source type based on its domain.
    Returns one of: youtube | twitter | reddit | github | leetcode | instagram | pdf | linkedin | medium | google-docs | google-drive | article | generic
    """
    try:
        parsed = urlparse(url)
        domain = (parsed.hostname or "").lower()
        path = parsed.path.lower()
    except Exception:
        return "generic"

    if path.endswith(".pdf") or ".pdf" in path:
        return "pdf"
    if domain in _YOUTUBE_DOMAINS:
        return "youtube"
    if domain in _TWITTER_DOMAINS:
        return "twitter"
    if domain in _REDDIT_DOMAINS:
        return "reddit"
    if domain in _GITHUB_DOMAINS:
        return "github"
    if "leetcode.com" in domain:
        return "leetcode"
    if "instagram.com" in domain or "threads.net" in domain:
        return "instagram"
    if "linkedin.com" in domain:
        return "linkedin"
    if "medium.com" in domain or domain.endswith(".medium.com"):
        return "medium"
    if "docs.google.com" in domain:
        return "google-docs"
    if "drive.google.com" in domain:
        return "google-drive"

    return "article"


def resolve_platform_info(url: str) -> dict:
    """
    Given a URL, detect source platform branding details.
    Returns dict with keys: source_name, source_type, source_domain, logo_url
    """
    try:
        parsed = urlparse(url)
        domain = (parsed.hostname or "").lower()
        path = parsed.path.lower()
    except Exception:
        domain = ""
        path = ""

    source_domain = domain

    # 1. PDF
    if path.endswith(".pdf") or ".pdf" in path:
        return {
            "source_name": "PDF",
            "source_type": "pdf",
            "source_domain": source_domain,
            "logo_url": "https://cdn.simpleicons.org/adobeacrobatreader/FF0000"
        }

    # 2. YouTube
    if any(d in domain for d in ["youtube.com", "youtu.be"]):
        return {
            "source_name": "YouTube",
            "source_type": "youtube",
            "source_domain": source_domain,
            "logo_url": "https://cdn.simpleicons.org/youtube/FF0000"
        }

    # 3. Instagram
    if "instagram.com" in domain:
        return {
            "source_name": "Instagram",
            "source_type": "instagram",
            "source_domain": source_domain,
            "logo_url": "https://cdn.simpleicons.org/instagram/E4405F"
        }

    # 4. Threads
    if "threads.net" in domain:
        return {
            "source_name": "Instagram",  # Match required platform name / source type
            "source_type": "instagram",
            "source_domain": source_domain,
            "logo_url": "https://cdn.simpleicons.org/threads/000000"
        }

    # 5. LinkedIn
    if "linkedin.com" in domain:
        return {
            "source_name": "LinkedIn",
            "source_type": "linkedin",
            "source_domain": source_domain,
            "logo_url": "https://cdn.simpleicons.org/linkedin/0A66C2"
        }

    # 6. X (Twitter)
    if any(d in domain for d in ["twitter.com", "x.com"]):
        return {
            "source_name": "X (Twitter)",
            "source_type": "twitter",
            "source_domain": source_domain,
            "logo_url": "https://cdn.simpleicons.org/x/000000"
        }

    # 7. Reddit
    if any(d in domain for d in ["reddit.com", "redd.it"]):
        return {
            "source_name": "Reddit",
            "source_type": "reddit",
            "source_domain": source_domain,
            "logo_url": "https://cdn.simpleicons.org/reddit/FF4500"
        }

    # 8. GitHub
    if "github.com" in domain:
        return {
            "source_name": "GitHub",
            "source_type": "github",
            "source_domain": source_domain,
            "logo_url": "https://cdn.simpleicons.org/github/181717"
        }

    # 9. Medium
    if "medium.com" in domain or domain.endswith(".medium.com"):
        return {
            "source_name": "Medium",
            "source_type": "medium",
            "source_domain": source_domain,
            "logo_url": "https://cdn.simpleicons.org/medium/000000"
        }

    # 10. Dev.to
    if "dev.to" in domain:
        return {
            "source_name": "Dev.to",
            "source_type": "devto",
            "source_domain": source_domain,
            "logo_url": "https://cdn.simpleicons.org/devto/0A0A0A"
        }

    # 11. Hacker News
    if "news.ycombinator.com" in domain:
        return {
            "source_name": "Hacker News",
            "source_type": "hackernews",
            "source_domain": source_domain,
            "logo_url": "https://cdn.simpleicons.org/hackernews/FF6600"
        }

    # 12. Wikipedia
    if "wikipedia.org" in domain:
        return {
            "source_name": "Wikipedia",
            "source_type": "wikipedia",
            "source_domain": source_domain,
            "logo_url": "https://cdn.simpleicons.org/wikipedia/000000"
        }

    # 13. ChatGPT
    if "chatgpt.com" in domain or "chat.openai.com" in domain:
        return {
            "source_name": "ChatGPT",
            "source_type": "chatgpt",
            "source_domain": source_domain,
            "logo_url": "https://cdn.simpleicons.org/openai/412991"
        }

    # 14. Notion
    if "notion.so" in domain or "notion.site" in domain:
        return {
            "source_name": "Notion",
            "source_type": "notion",
            "source_domain": source_domain,
            "logo_url": "https://cdn.simpleicons.org/notion/000000"
        }

    # 15. LeetCode
    if "leetcode.com" in domain:
        return {
            "source_name": "LeetCode",
            "source_type": "leetcode",
            "source_domain": source_domain,
            "logo_url": "https://cdn.simpleicons.org/leetcode/FFA116"
        }

    # 16. Google Docs / Drive
    if "docs.google.com" in domain:
        return {
            "source_name": "Google Docs",
            "source_type": "google-docs",
            "source_domain": source_domain,
            "logo_url": "https://cdn.simpleicons.org/googledocs/4285F4"
        }
    if "drive.google.com" in domain:
        return {
            "source_name": "Google Drive",
            "source_type": "google-drive",
            "source_domain": source_domain,
            "logo_url": "https://cdn.simpleicons.org/googledrive/34A853"
        }

    # Generic Website (Fetch favicon)
    favicon_url = get_and_cache_favicon(domain)
    
    # Deriving pretty source name from domain (e.g. google.com -> Google)
    domain_parts = domain.split(".")
    if len(domain_parts) >= 2:
        source_name = domain_parts[-2].capitalize()
    else:
        source_name = domain.capitalize() if domain else "Website"

    return {
        "source_name": source_name,
        "source_type": "generic",
        "source_domain": source_domain,
        "logo_url": favicon_url
    }


async def extract_content(url: str) -> dict:
    """
    Main entry point: detect source type, extract content, return standardised dict.
    Falls back to generic extractor if the specific one fails.
    Never raises — always returns usable data.

    Returns dict with canonical fields:
        title, description, full_text, thumbnail_url, author,
        source_type, source_name, video_url, duration_seconds,
        word_count, estimated_read_time, published_date
    """
    source_type = detect_source_type(url)
    logger.info("Detected source_type=%s for url=%s", source_type, url)

    extractor_map = {
        "youtube": lambda: asyncio.to_thread(extract_youtube, url),
        "twitter": lambda: asyncio.to_thread(extract_twitter, url),
        "reddit": lambda: asyncio.to_thread(extract_reddit, url),
        "github": lambda: asyncio.to_thread(extract_github, url),
        "leetcode": lambda: asyncio.to_thread(extract_leetcode, url),
        "instagram": lambda: asyncio.to_thread(extract_instagram, url),
        "pdf": lambda: asyncio.to_thread(extract_pdf, url),
        "linkedin": lambda: asyncio.to_thread(extract_article, url),
        "medium": lambda: asyncio.to_thread(extract_article, url),
        "google-docs": lambda: asyncio.to_thread(extract_article, url),
        "google-drive": lambda: asyncio.to_thread(extract_article, url),
        "article": lambda: asyncio.to_thread(extract_article, url),
    }

    try:
        extractor = extractor_map.get(source_type)
        if extractor:
            result = await extractor()
        else:
            result = await asyncio.to_thread(extract_generic, url, source_type)

        # Ensure branding information is attached
        branding = resolve_platform_info(url)
        result.setdefault("source_type", branding["source_type"])
        result.setdefault("source_name", branding["source_name"])
        result.setdefault("source_domain", branding["source_domain"])
        result.setdefault("logo_url", branding["logo_url"])

        logger.info(
            "Extraction succeeded for %s — title=%s",
            url,
            str(result.get("title", "?"))[:60],
        )
        return result

    except Exception as e:
        logger.warning(
            "Specific extractor failed for %s (%s), falling back to generic: %s",
            url, source_type, e,
        )
        try:
            result = await asyncio.to_thread(extract_generic, url, source_type)
            branding = resolve_platform_info(url)
            result.setdefault("source_type", branding["source_type"])
            result.setdefault("source_name", branding["source_name"])
            result.setdefault("source_domain", branding["source_domain"])
            result.setdefault("logo_url", branding["logo_url"])
            return result
        except Exception as fallback_err:
            logger.error("Generic extractor also failed for %s: %s", url, fallback_err)
            branding = resolve_platform_info(url)
            return {
                "title": url,
                "description": None,
                "full_text": None,
                "thumbnail_url": None,
                "author": "Unknown Author",
                "source_type": branding["source_type"],
                "source_name": branding["source_name"],
                "source_domain": branding["source_domain"],
                "logo_url": branding["logo_url"],
                "video_url": None,
                "duration_seconds": None,
                "word_count": None,
                "estimated_read_time": None,
                "published_date": None,
            }
