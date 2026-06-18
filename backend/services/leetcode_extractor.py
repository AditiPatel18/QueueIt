"""
LeetCode problem content extractor using public GraphQL API.
"""

import logging
import re
import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


def extract_leetcode(url: str) -> dict:
    """
    Extract LeetCode problem details using GraphQL.
    """
    base_result = {
        "title": "LeetCode Problem",
        "description": "LeetCode Problem",
        "full_text": None,
        "thumbnail_url": None,
        "author": "LeetCode",
        "source_type": "leetcode",
        "source_name": "LeetCode",
        "video_url": None,
        "duration_seconds": None,
        "word_count": None,
        "estimated_read_time": None,
        "published_date": None,
    }

    # Match slug from URL, e.g. leetcode.com/problems/two-sum/
    slug_match = re.search(r"leetcode\.com/problems/([^/]+)", url)
    if not slug_match:
        return base_result

    slug = slug_match.group(1)
    title_fallback = slug.replace("-", " ").title()
    base_result["title"] = title_fallback

    graphql_query = {
        "query": """
        query questionData($titleSlug: String!) {
            question(titleSlug: $titleSlug) {
                questionId
                title
                content
                difficulty
                topicTags {
                    name
                }
            }
        }
        """,
        "variables": {"titleSlug": slug}
    }

    try:
        with httpx.Client(timeout=10.0, follow_redirects=True) as client:
            resp = client.post("https://leetcode.com/graphql", json=graphql_query)
            resp.raise_for_status()
            data = resp.json().get("data", {}).get("question")
            if data:
                content_html = data.get("content") or ""
                soup = BeautifulSoup(content_html, "html.parser")
                plain_text = soup.get_text(separator="\n").strip()
                
                tags = [t["name"] for t in data.get("topicTags", [])]
                difficulty = data.get("difficulty") or "Unknown"
                
                word_count = len(plain_text.split()) if plain_text else 0
                estimated_read_time = max(1, round(word_count / 200)) if word_count else None

                base_result.update({
                    "title": data.get("title") or title_fallback,
                    "description": f"LeetCode problem: {difficulty} Difficulty",
                    "full_text": plain_text,
                    "word_count": word_count,
                    "estimated_read_time": estimated_read_time,
                })
                logger.info("Successfully extracted LeetCode problem: %s", slug)
    except Exception as e:
        logger.error("LeetCode GraphQL API failed for %s: %s", url, e)

    return base_result
