"""
Twitter/X content extractor.
Uses nitter.privacydev.net as a public scraping proxy to avoid auth.
Falls back to Open Graph extraction via httpx if nitter is unavailable.
"""

import logging
import re
import httpx
from bs4 import BeautifulSoup
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# Public nitter instances (try in order)
_NITTER_INSTANCES = [
    "https://nitter.privacydev.net",
    "https://nitter.net",
    "https://nitter.1d4.us",
]


def _extract_tweet_id(url: str) -> str | None:
    """Extract tweet ID from twitter.com or x.com URL."""
    match = re.search(r"/status(?:es)?/(\d+)", url)
    return match.group(1) if match else None


def _extract_username(url: str) -> str | None:
    """Extract @username from URL."""
    parsed = urlparse(url)
    parts = [p for p in parsed.path.split("/") if p]
    return parts[0] if parts else None


def extract_twitter(url: str) -> dict:
    """
    Extract tweet/post metadata from Twitter/X URL.
    Tries nitter proxy first, then falls back to OG tags.
    """
    tweet_id = _extract_tweet_id(url)
    username = _extract_username(url)

    base_result = {
        "title": None,
        "description": None,
        "full_text": None,
        "thumbnail_url": None,
        "author": username,
        "source_type": "twitter",
        "source_name": "Twitter/X",
        "video_url": None,
        "duration_seconds": None,
        "word_count": None,
        "estimated_read_time": None,
        "published_date": None,
    }

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }

    # Try nitter instances
    if tweet_id and username:
        for instance in _NITTER_INSTANCES:
            try:
                nitter_url = f"{instance}/{username}/status/{tweet_id}"
                with httpx.Client(timeout=8.0, follow_redirects=True) as client:
                    resp = client.get(nitter_url, headers=headers)
                    resp.raise_for_status()

                soup = BeautifulSoup(resp.text, "html.parser")

                # Tweet text
                tweet_div = soup.find("div", class_="tweet-content")
                tweet_text = tweet_div.get_text(separator=" ").strip() if tweet_div else None

                # Author
                fullname_span = soup.find("a", class_="fullname")
                author = fullname_span.get_text().strip() if fullname_span else username

                # Image
                img_tag = soup.find("img", class_="tweet-image")
                thumbnail_url = img_tag.get("src") if img_tag else None

                # Date
                time_tag = soup.find("span", class_="tweet-date")
                published_date = None
                if time_tag:
                    a_tag = time_tag.find("a")
                    published_date = a_tag.get("title") if a_tag else None

                if tweet_text:
                    base_result.update({
                        "title": f"@{username}: {tweet_text[:100]}{'...' if len(tweet_text) > 100 else ''}",
                        "description": tweet_text[:500],
                        "full_text": tweet_text,
                        "thumbnail_url": thumbnail_url,
                        "author": author or username,
                        "published_date": published_date,
                        "word_count": len(tweet_text.split()),
                        "estimated_read_time": 1,  # tweets are always < 1 min
                    })
                    logger.info("Twitter extraction via nitter succeeded for %s", url)
                    return base_result

            except Exception as e:
                logger.debug("Nitter instance %s failed: %s", instance, e)
                continue

    # Fallback: OG tag extraction
    try:
        with httpx.Client(timeout=10.0, follow_redirects=True) as client:
            resp = client.get(url, headers=headers)
            resp.raise_for_status()

        soup = BeautifulSoup(resp.text, "html.parser")

        def og(prop: str) -> str | None:
            tag = soup.find("meta", property=f"og:{prop}")
            return tag.get("content") if tag and tag.get("content") else None

        title = og("title")
        description = og("description")
        thumbnail_url = og("image")

        base_result.update({
            "title": title or f"Tweet by @{username}",
            "description": description,
            "full_text": description,
            "thumbnail_url": thumbnail_url,
            "word_count": len(description.split()) if description else None,
            "estimated_read_time": 1,
        })
        return base_result

    except Exception as e:
        logger.error("Twitter extraction fully failed for %s: %s", url, e)
        base_result["title"] = f"Tweet by @{username}" if username else "Twitter Post"
        return base_result
