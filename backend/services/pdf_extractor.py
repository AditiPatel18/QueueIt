"""
PDF content extractor using pypdf.
"""

import logging
import io
import httpx
import pypdf
from urllib.parse import urlparse
import os

logger = logging.getLogger(__name__)


def extract_pdf(url: str) -> dict:
    """
    Download and extract PDF document content.
    """
    from urllib.parse import urlparse
    import os
    path = urlparse(url).path
    filename = os.path.basename(path)
    title_fallback = filename or "Untitled PDF"

    base_result = {
        "title": title_fallback,
        "description": "PDF Document",
        "full_text": "Failed to extract PDF contents",
        "thumbnail_url": None,
        "author": "Unknown Author",
        "source_type": "pdf",
        "source_name": "PDF",
        "video_url": None,
        "duration_seconds": None,
        "word_count": None,
        "estimated_read_time": None,
        "published_date": None,
    }

    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            resp = client.get(url, headers=headers)
            resp.raise_for_status()
            
            pdf_file = io.BytesIO(resp.content)
            reader = pypdf.PdfReader(pdf_file)
            
            text_parts = []
            num_pages = len(reader.pages)
            # Process up to 20 pages
            for page_num in range(min(num_pages, 20)):
                page = reader.pages[page_num]
                text_parts.append(page.extract_text() or "")
            
            full_text = "\n".join(text_parts).strip()
            
            title = None
            author = None
            if reader.metadata:
                title = reader.metadata.title
                author = reader.metadata.author
            
            word_count = len(full_text.split()) if full_text else 0
            estimated_read_time = max(1, round(word_count / 200)) if word_count else None

            base_result.update({
                "title": title or title_fallback,
                "description": f"PDF Document with {num_pages} pages",
                "full_text": full_text or "No readable text in PDF",
                "author": author or "Unknown Author",
                "word_count": word_count,
                "estimated_read_time": estimated_read_time,
            })
            logger.info("Successfully extracted PDF document text: %s", title or title_fallback)
    except Exception as e:
        logger.error("PDF extraction failed for %s: %s", url, e)

    return base_result
