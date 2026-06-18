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
    if "instagram.com" in domain:
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

        # Ensure source_type is always set
        result.setdefault("source_type", source_type)

        # Standardize source_name metadata based on type
        source_name_map = {
            "youtube": "YouTube",
            "twitter": "X/Twitter",
            "reddit": "Reddit",
            "github": "GitHub",
            "leetcode": "LeetCode",
            "instagram": "Instagram",
            "pdf": "PDF",
            "linkedin": "LinkedIn",
            "medium": "Medium",
            "google-docs": "Google Docs",
            "google-drive": "Google Drive",
        }
        if source_type in source_name_map:
            result["source_name"] = source_name_map[source_type]
        # Logo URL mapping per source_name
        logo_url_map = {
            "YouTube": "https://example.com/logos/youtube.png",
            "X/Twitter": "https://example.com/logos/twitter.png",
            "Reddit": "https://example.com/logos/reddit.png",
            "GitHub": "https://example.com/logos/github.png",
            "LeetCode": "https://example.com/logos/leetcode.png",
            "Instagram": "https://example.com/logos/instagram.png",
            "PDF": "https://example.com/logos/pdf.png",
            "LinkedIn": "https://example.com/logos/linkedin.png",
            "Medium": "https://example.com/logos/medium.png",
            "Google Docs": "https://example.com/logos/googledocs.png",
            "Google Drive": "https://example.com/logos/googledrive.png",
        }
        if result.get("source_name") in logo_url_map:
            result["logo_url"] = logo_url_map[result["source_name"]]
        else:
            result["logo_url"] = None
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
            return result
        except Exception as fallback_err:
            logger.error("Generic extractor also failed for %s: %s", url, fallback_err)
            domain = urlparse(url).hostname or "unknown"
            return {
                "title": url,
                "description": None,
                "full_text": None,
                "thumbnail_url": None,
                "author": "Unknown Author",
                "source_type": source_type,
                "source_name": domain.removeprefix("www."),
                "video_url": None,
                "duration_seconds": None,
                "word_count": None,
                "estimated_read_time": None,
                "published_date": None,
            }

