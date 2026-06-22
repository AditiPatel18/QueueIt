"""
Instagram and Threads metadata and caption extractor.
Supports Instagram Posts, Reels, and Threads posts.
"""

import logging
import re
import json
import httpx
from bs4 import BeautifulSoup
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


def clean_instagram_desc(desc: str) -> dict:
    """
    Clean Instagram og:description text to extract likes, comments, and caption.
    E.g. "1,200 Likes, 45 Comments - User (@user) on Instagram: 'Caption goes here...'"
    """
    result = {"caption": desc, "likes": None, "comments": None}
    if not desc:
        return result

    # Check for likes/comments prefix
    prefix_match = re.match(r"^([\d,]+)\s+Likes,\s+([\d,]+)\s+Comments\s+-\s+(.+)$", desc, re.IGNORECASE)
    if prefix_match:
        result["likes"] = prefix_match.group(1)
        result["comments"] = prefix_match.group(2)
        desc = prefix_match.group(3)

    # Search for "on Instagram: 'Caption'" or "on Instagram"
    match = re.search(r"on\s+Instagram:\s+['\"](.*)['\"]$", desc, re.DOTALL | re.IGNORECASE)
    if match:
        result["caption"] = match.group(1).strip()
    else:
        # Fallback if no quotes
        match2 = re.search(r"on\s+Instagram:\s+(.*)$", desc, re.DOTALL | re.IGNORECASE)
        if match2:
            result["caption"] = match2.group(1).strip()

    return result


def clean_threads_desc(desc: str) -> dict:
    """
    Clean Threads og:description text to extract caption.
    E.g. "User (@user) on Threads: Caption goes here..."
    """
    result = {"caption": desc}
    if not desc:
        return result

    match = re.search(r"on\s+Threads:\s+(.*)$", desc, re.DOTALL | re.IGNORECASE)
    if match:
        result["caption"] = match.group(1).strip()

    return result


def extract_instagram(url: str) -> dict:
    """
    Extract Instagram/Threads post metadata and caption.
    """
    is_threads = "threads.net" in urlparse(url).hostname

    base_result = {
        "title": "Threads Post" if is_threads else "Instagram Post",
        "description": "Threads Post Content" if is_threads else "Instagram Post Content",
        "full_text": "Limited text available",
        "thumbnail_url": None,
        "author": "Unknown Author",
        "source_type": "instagram",  # Wait, content_type should map to 'instagram' as per existing setup
        "source_name": "Threads" if is_threads else "Instagram",
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
    thumbnail = None
    published_date = None

    try:
        with httpx.Client(timeout=10.0, follow_redirects=True) as client:
            resp = client.get(url, headers=headers)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")

                # Try 1: JSON-LD Extraction
                json_ld_extracted = False
                for script in soup.find_all("script", type="application/ld+json"):
                    try:
                        data = json.loads(script.string or "")
                        if isinstance(data, list):
                            data = data[0] if data else {}
                        if not isinstance(data, dict):
                            continue

                        # Extract details from JSON-LD
                        caption = data.get("articleBody") or data.get("text") or data.get("description") or caption
                        author_data = data.get("author")
                        if isinstance(author_data, dict):
                            author = author_data.get("name") or author_data.get("alternateName") or author
                        elif isinstance(author_data, list) and author_data:
                            author = author_data[0].get("name") or author_data[0].get("alternateName") or author
                        
                        thumbnail = data.get("image") or data.get("thumbnailUrl") or thumbnail
                        if isinstance(thumbnail, list) and thumbnail:
                            thumbnail = thumbnail[0]
                        elif isinstance(thumbnail, dict):
                            thumbnail = thumbnail.get("url")

                        published_date = data.get("datePublished") or published_date
                        json_ld_extracted = True
                    except Exception as ld_err:
                        logger.debug("Failed parsing JSON-LD script tag: %s", ld_err)
                        continue

                # Try 2: Open Graph meta tags extraction
                og_description_tag = soup.find("meta", property="og:description")
                og_description = og_description_tag.get("content") if og_description_tag else ""

                og_title_tag = soup.find("meta", property="og:title")
                og_title = og_title_tag.get("content") if og_title_tag else ""

                og_image_tag = soup.find("meta", property="og:image")
                if og_image_tag and not thumbnail:
                    thumbnail = og_image_tag.get("content")

                title_tag = soup.find("title")
                page_title = title_tag.get_text() if title_tag else ""

                # Extract author from text elements if still unknown
                if author == "Unknown":
                    for text_val in [og_title, og_description, page_title]:
                        if not text_val:
                            continue
                        handle_match = re.search(r"@([a-zA-Z0-9_\.]+)", text_val)
                        if handle_match:
                            author = handle_match.group(1)
                            break
                        name_match = re.search(r"([a-zA-Z0-9_\.\s]+)\s+on\s+(?:Instagram|Threads)", text_val, re.IGNORECASE)
                        if name_match:
                            author = name_match.group(1).strip()
                            break

                # Extract and clean caption if not extracted from JSON-LD
                if not caption:
                    if og_description:
                        if is_threads:
                            cleaned = clean_threads_desc(og_description)
                            caption = cleaned.get("caption")
                        else:
                            cleaned = clean_instagram_desc(og_description)
                            caption = cleaned.get("caption")
                    if not caption and og_title:
                        caption = og_title

    except Exception as e:
        logger.error("Instagram/Threads extraction failed: %s", e)

    # Profile URL fallback parsing
    if author == "Unknown":
        profile_match = re.search(r"(?:instagram\.com|threads\.net)/@?([a-zA-Z0-9_\.]+)/?$", url)
        if profile_match:
            author = profile_match.group(1)
            caption = f"{'Threads' if is_threads else 'Instagram'} profile page for @{author}"

    if caption:
        caption = caption.strip()

    word_count = len(caption.split()) if caption else 0
    estimated_read_time = max(1, round(word_count / 200)) if word_count else None

    # Determine titles and author string formatting
    title_suffix = "Reel" if "reel" in url.lower() else "Post"
    platform_name = "Threads" if is_threads else "Instagram"
    display_title = f"{platform_name} {title_suffix} by @{author}" if author != "Unknown" else f"{platform_name} {title_suffix}"

    base_result.update({
        "title": display_title,
        "description": caption or f"{platform_name} {title_suffix.lower()} content",
        "full_text": caption or "Limited text available",
        "author": f"@{author}" if author != "Unknown" else "Unknown Author",
        "thumbnail_url": thumbnail,
        "word_count": word_count,
        "estimated_read_time": estimated_read_time,
        "published_date": published_date,
    })

    return base_result
