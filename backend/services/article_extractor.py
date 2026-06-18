"""
Article content extractor using newspaper3k and trafilatura.
Downloads a web page and extracts title, text, authors, image, and metadata.
"""

import logging
from urllib.parse import urlparse
from newspaper import Article
from bs4 import BeautifulSoup
import trafilatura

logger = logging.getLogger(__name__)

_WORDS_PER_MINUTE = 200


def extract_article(url: str) -> dict:
    """
    Download and parse an article URL.

    Returns a standardised content dict.
    """
    try:
        article = Article(url)
        article.download()
        article.parse()

        # Extract body text using trafilatura
        text = None
        try:
            if article.html:
                text = trafilatura.extract(article.html)
        except Exception as te:
            logger.warning("Trafilatura extract failed for %s: %s", url, te)

        # Fallback to newspaper text
        if not text:
            text = article.text or ""

        word_count = len(text.split()) if text else None

        # estimated_read_time in minutes
        estimated_read_time = None
        if word_count and word_count > 0:
            estimated_read_time = max(1, round(word_count / _WORDS_PER_MINUTE))

        # Extract domain as source_name
        domain = urlparse(url).hostname or ""
        source_name = domain.removeprefix("www.")

        # Description: use meta description or first 300 chars
        description = None
        if article.meta_description:
            description = article.meta_description
        elif text:
            description = text[:300].strip() + ("..." if len(text) > 300 else "")

        # Extract authors
        author = ", ".join(article.authors) if article.authors else None

        # Fallback meta search for author using BeautifulSoup
        if not author and article.html:
            try:
                soup = BeautifulSoup(article.html, "html.parser")
                for tag_name in ["author", "article:author", "twitter:creator", "dc.creator", "creator"]:
                    meta = soup.find("meta", attrs={"name": tag_name}) or soup.find("meta", attrs={"property": tag_name})
                    if meta and meta.get("content"):
                        val = meta.get("content").strip()
                        if val and len(val) > 1 and len(val) < 100:
                            author = val
                            break
            except Exception as ae:
                logger.debug("Meta author extraction failed for %s: %s", url, ae)

        published_date = None
        if article.publish_date:
            published_date = article.publish_date.isoformat()

        return {
            "title": article.title or "Untitled Article",
            "description": description,
            "full_text": text or None,
            "thumbnail_url": article.top_image or None,
            "author": author or "Unknown Author",
            "source_type": "article",
            "source_name": source_name,
            "video_url": None,
            "duration_seconds": None,
            "word_count": word_count,
            "estimated_read_time": estimated_read_time,
            "published_date": published_date,
        }
    except Exception as e:
        logger.error("Article extraction failed for %s: %s", url, e)
        domain = urlparse(url).hostname or "unknown"
        return {
            "title": "Untitled Article",
            "description": None,
            "full_text": None,
            "thumbnail_url": None,
            "author": "Unknown Author",
            "source_type": "article",
            "source_name": domain.removeprefix("www."),
            "video_url": None,
            "duration_seconds": None,
            "word_count": None,
            "estimated_read_time": None,
            "published_date": None,
        }

