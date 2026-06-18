"""
Generic fallback extractor using httpx and BeautifulSoup4 to parse Open Graph/Twitter Card tags.
Also extracts body text for word count and read time estimation.
"""

import logging
import httpx
from bs4 import BeautifulSoup
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

_WORDS_PER_MINUTE = 200


def _extract_body_text(soup: BeautifulSoup) -> str | None:
    """Extract readable body text from a parsed HTML page."""
    # Remove script, style, nav, footer, header elements
    for tag in soup.find_all(["script", "style", "nav", "footer", "header", "aside", "noscript"]):
        tag.decompose()

    # Try <article> first, then <main>, then <body>
    container = soup.find("article") or soup.find("main") or soup.find("body")
    if not container:
        return None

    text = container.get_text(separator=" ", strip=True)
    # Collapse whitespace
    text = " ".join(text.split())
    return text if len(text) > 50 else None


def extract_generic(url: str, source_type: str = "generic") -> dict:
    """
    Fallback extractor using httpx to fetch the page and BeautifulSoup
    to parse meta tags (Open Graph, Twitter Cards, etc).
    Also extracts body text for word count and read time.
    """
    domain = urlparse(url).hostname or "unknown"
    source_name = domain.removeprefix("www.")

    try:
        # User-agent to avoid simple blocking
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
        }
        with httpx.Client(timeout=10.0, follow_redirects=True) as client:
            response = client.get(url, headers=headers)
            response.raise_for_status()
            html = response.text

        soup = BeautifulSoup(html, "html.parser")

        # Extract title
        title = None
        og_title = soup.find("meta", property="og:title")
        tw_title = soup.find("meta", attrs={"name": "twitter:title"})
        if og_title and og_title.get("content"):
            title = og_title["content"]
        elif tw_title and tw_title.get("content"):
            title = tw_title["content"]
        elif soup.title:
            title = soup.title.string

        # Extract description
        description = None
        og_desc = soup.find("meta", property="og:description")
        tw_desc = soup.find("meta", attrs={"name": "twitter:description"})
        meta_desc = soup.find("meta", attrs={"name": "description"})
        if og_desc and og_desc.get("content"):
            description = og_desc["content"]
        elif tw_desc and tw_desc.get("content"):
            description = tw_desc["content"]
        elif meta_desc and meta_desc.get("content"):
            description = meta_desc["content"]

        # Extract image
        thumbnail_url = None
        og_image = soup.find("meta", property="og:image")
        tw_image = soup.find("meta", attrs={"name": "twitter:image"})
        if og_image and og_image.get("content"):
            thumbnail_url = og_image["content"]
        elif tw_image and tw_image.get("content"):
            thumbnail_url = tw_image["content"]

        # Extract body text for word count and read time
        body_text = _extract_body_text(soup)
        word_count = len(body_text.split()) if body_text else None
        estimated_read_time = None
        if word_count and word_count > 0:
            estimated_read_time = max(1, round(word_count / _WORDS_PER_MINUTE))

        return {
            "title": title or "Untitled",
            "description": description,
            "full_text": body_text,
            "thumbnail_url": thumbnail_url,
            "author": None,
            "source_type": source_type,
            "source_name": source_name,
            "video_url": None,
            "duration_seconds": None,
            "word_count": word_count,
            "estimated_read_time": estimated_read_time,
            "published_date": None,
        }

    except Exception as e:
        logger.error("Generic extraction failed for %s: %s", url, e)
        return {
            "title": url,
            "description": None,
            "full_text": None,
            "thumbnail_url": None,
            "author": None,
            "source_type": source_type,
            "source_name": source_name,
            "video_url": None,
            "duration_seconds": None,
            "word_count": None,
            "estimated_read_time": None,
            "published_date": None,
        }