"""
Reddit content extractor.
Uses Reddit's public JSON API (append .json to any reddit URL) — no auth needed.
"""

import logging
import httpx
from urllib.parse import urlparse, urljoin

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "QueueIt/1.0 (content aggregator; contact@queueit.app)"
}


def extract_reddit(url: str) -> dict:
    """
    Extract Reddit post metadata using the public .json API.
    Works for posts at reddit.com/r/*/comments/*
    """
    # Normalise URL: remove query params, strip trailing slash
    parsed = urlparse(url)
    clean_path = parsed.path.rstrip("/")
    json_url = f"https://www.reddit.com{clean_path}.json?raw_json=1&limit=1"

    base_result = {
        "title": None,
        "description": None,
        "full_text": None,
        "thumbnail_url": None,
        "author": None,
        "source_type": "reddit",
        "source_name": "Reddit",
        "video_url": None,
        "duration_seconds": None,
        "word_count": None,
        "estimated_read_time": None,
        "published_date": None,
    }

    try:
        with httpx.Client(timeout=10.0, follow_redirects=True) as client:
            resp = client.get(json_url, headers=_HEADERS)
            resp.raise_for_status()
            data = resp.json()

        # Reddit returns a list: [post_listing, comments_listing]
        if not isinstance(data, list) or len(data) == 0:
            raise ValueError("Unexpected Reddit API response structure")

        post_listing = data[0]
        children = post_listing.get("data", {}).get("children", [])
        if not children:
            raise ValueError("No post data found")

        post = children[0].get("data", {})

        title = post.get("title") or "Untitled Reddit Post"
        author = post.get("author")
        subreddit = post.get("subreddit_name_prefixed")  # e.g. r/programming
        selftext = post.get("selftext") or ""
        thumbnail = post.get("thumbnail") if post.get("thumbnail") not in ("self", "default", "nsfw", None, "") else None
        # Better image
        preview = post.get("preview", {})
        images = preview.get("images", [])
        if images:
            resolutions = images[0].get("resolutions", [])
            source = images[0].get("source", {})
            best = resolutions[-1] if resolutions else source
            thumbnail = best.get("url", "").replace("&amp;", "&") or thumbnail

        created_utc = post.get("created_utc")
        published_date = None
        if created_utc:
            from datetime import datetime, timezone
            published_date = datetime.fromtimestamp(created_utc, tz=timezone.utc).isoformat()

        full_text = selftext.strip() if selftext and selftext != "[deleted]" else None
        word_count = len(full_text.split()) if full_text else None
        estimated_read_time = max(1, round(word_count / 200)) if word_count else None

        description = f"Posted in {subreddit}" if subreddit else None
        if full_text:
            description = full_text[:300] + ("..." if len(full_text) > 300 else "")

        base_result.update({
            "title": title,
            "description": description,
            "full_text": full_text,
            "thumbnail_url": thumbnail,
            "author": author,
            "word_count": word_count,
            "estimated_read_time": estimated_read_time,
            "published_date": published_date,
        })
        logger.info("Reddit extraction succeeded for %s — title=%s", url, title[:60])
        return base_result

    except Exception as e:
        logger.error("Reddit extraction failed for %s: %s", url, e)
        # Best-effort fallback with OG tags
        try:
            import httpx as _httpx
            from bs4 import BeautifulSoup
            with _httpx.Client(timeout=8.0, follow_redirects=True) as client:
                resp = client.get(url, headers=_HEADERS)
                soup = BeautifulSoup(resp.text, "html.parser")

            def og(prop: str):
                tag = soup.find("meta", property=f"og:{prop}")
                return tag.get("content") if tag and tag.get("content") else None

            base_result.update({
                "title": og("title") or "Reddit Post",
                "description": og("description"),
                "thumbnail_url": og("image"),
            })
        except Exception:
            base_result["title"] = "Reddit Post"

        return base_result
