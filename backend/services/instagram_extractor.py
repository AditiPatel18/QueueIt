"""
Instagram metadata and caption extractor.
"""

import logging
import re
import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


def extract_instagram(url: str) -> dict:
    """
    Extract Instagram post metadata and caption.
    """
    base_result = {
        "title": "Instagram Post",
        "description": "Instagram Post Content",
        "full_text": "Limited text available",
        "thumbnail_url": None,
        "author": "Unknown Author",
        "source_type": "instagram",
        "source_name": "Instagram",
        "video_url": None,
        "duration_seconds": None,
        "word_count": None,
        "estimated_read_time": None,
        "published_date": None,
    }

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    }

    author = "Unknown"
    caption = ""

    try:
        with httpx.Client(timeout=10.0, follow_redirects=True) as client:
            resp = client.get(url, headers=headers)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                
                og_description_tag = soup.find("meta", property="og:description")
                og_description = og_description_tag.get("content") if og_description_tag else ""
                
                og_title_tag = soup.find("meta", property="og:title")
                og_title = og_title_tag.get("content") if og_title_tag else ""
                
                title_tag = soup.find("title")
                page_title = title_tag.get_text() if title_tag else ""
                
                # Try to parse username
                for text_val in [og_description, og_title, page_title]:
                    if not text_val:
                        continue
                    handle_match = re.search(r"@([a-zA-Z0-9_\.]+)", text_val)
                    if handle_match:
                        author = handle_match.group(1)
                        break
                    name_match = re.search(r"([a-zA-Z0-9_\.\s]+)\s+on\s+Instagram", text_val, re.IGNORECASE)
                    if name_match:
                        author = name_match.group(1).strip()
                        break
                
                # Extract caption
                if og_description:
                    desc_clean = og_description
                    colon_idx = desc_clean.find("Instagram:")
                    if colon_idx != -1:
                        desc_clean = desc_clean[colon_idx + 10:].strip().strip("'\"")
                    caption = desc_clean
                
                if not caption and og_title:
                    caption = og_title
    except Exception as e:
        logger.error("Instagram extraction failed: %s", e)

    if author == "Unknown":
        profile_match = re.search(r"instagram\.com/([a-zA-Z0-9_\.]+)/?$", url)
        if profile_match:
            author = profile_match.group(1)
            caption = f"Instagram profile page for {author}"

    word_count = len(caption.split()) if caption else 0
    estimated_read_time = max(1, round(word_count / 200)) if word_count else None

    base_result.update({
        "title": f"Instagram Post by @{author}" if author != "Unknown" else "Instagram Post",
        "description": caption or "Instagram post content",
        "full_text": caption or "Limited text available",
        "author": f"@{author}" if author != "Unknown" else "Unknown Author",
        "word_count": word_count,
        "estimated_read_time": estimated_read_time,
    })

    return base_result
