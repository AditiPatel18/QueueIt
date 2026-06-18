"""
GitHub repository extractor.
Uses the GitHub REST API v3 — no authentication required for public repos.
Handles: repos, gists, issues, PRs, and profile pages.
"""

import logging
import re
import base64
import httpx

logger = logging.getLogger(__name__)

_GITHUB_API = "https://api.github.com"
_HEADERS = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "QueueIt/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
}

_WORDS_PER_MINUTE = 200


def _parse_repo_path(url: str) -> tuple[str | None, str | None]:
    """Return (owner, repo) from a github.com URL, or (None, None)."""
    match = re.match(
        r"https?://(?:www\.)?github\.com/([^/]+)/([^/?\s#]+)", url
    )
    if match:
        return match.group(1), match.group(2)
    return None, None


def _fetch_readme_text(owner: str, repo: str, client: httpx.Client) -> str | None:
    """Fetch the README content from the GitHub API and return plain text."""
    try:
        readme_url = f"{_GITHUB_API}/repos/{owner}/{repo}/readme"
        resp = client.get(readme_url, headers=_HEADERS)
        resp.raise_for_status()
        data = resp.json()

        content_b64 = data.get("content", "")
        encoding = data.get("encoding", "base64")

        if encoding == "base64" and content_b64:
            raw = base64.b64decode(content_b64).decode("utf-8", errors="replace")
            # Strip markdown formatting for cleaner word count
            # Remove images, links (keep text), headers, code blocks
            plain = re.sub(r'```[\s\S]*?```', '', raw)
            plain = re.sub(r'`[^`]*`', '', plain)
            plain = re.sub(r'!\[.*?\]\(.*?\)', '', plain)
            plain = re.sub(r'\[([^\]]*)\]\(.*?\)', r'\1', plain)
            plain = re.sub(r'#{1,6}\s*', '', plain)
            plain = re.sub(r'[*_~]{1,3}', '', plain)
            plain = re.sub(r'\n{2,}', '\n', plain)
            return plain.strip()
    except Exception as e:
        logger.debug("Could not fetch README for %s/%s: %s", owner, repo, e)

    return None


def extract_github(url: str) -> dict:
    """
    Extract GitHub repo metadata using the public REST API.
    Falls back to OG tags for non-repo pages.
    """
    base_result = {
        "title": None,
        "description": None,
        "full_text": None,
        "thumbnail_url": None,
        "author": None,
        "source_type": "github",
        "source_name": "GitHub",
        "video_url": None,
        "duration_seconds": None,
        "word_count": None,
        "estimated_read_time": None,
        "published_date": None,
    }

    owner, repo = _parse_repo_path(url)

    if owner and repo:
        try:
            with httpx.Client(timeout=10.0, follow_redirects=True) as client:
                api_url = f"{_GITHUB_API}/repos/{owner}/{repo}"
                resp = client.get(api_url, headers=_HEADERS)
                resp.raise_for_status()
                data = resp.json()

                name = data.get("full_name") or f"{owner}/{repo}"
                description = data.get("description") or ""
                stars = data.get("stargazers_count", 0)
                language = data.get("language")
                homepage = data.get("homepage")
                pushed_at = data.get("pushed_at")  # ISO 8601
                topics = data.get("topics", [])
                forks = data.get("forks_count", 0)
                open_issues = data.get("open_issues_count", 0)
                owner_avatar = data.get("owner", {}).get("avatar_url")

                # Build rich description
                parts = [description] if description else []
                if language:
                    parts.append(f"Language: {language}")
                parts.append(f"⭐ {stars:,} stars")
                if forks:
                    parts.append(f"🍴 {forks:,} forks")
                if topics:
                    parts.append(f"Topics: {', '.join(topics[:5])}")

                full_description = " · ".join(parts)

                # Fetch README for accurate read time and full_text
                readme_text = _fetch_readme_text(owner, repo, client)
                full_text = readme_text or full_description

                word_count = len(full_text.split()) if full_text else None
                estimated_read_time = None
                if word_count and word_count > 0:
                    estimated_read_time = max(1, round(word_count / _WORDS_PER_MINUTE))

                base_result.update({
                    "title": name,
                    "description": full_description or description or name,
                    "full_text": full_text,
                    "thumbnail_url": owner_avatar,
                    "author": owner,
                    "published_date": pushed_at,
                    "estimated_read_time": estimated_read_time,
                    "word_count": word_count,
                })
                logger.info("GitHub extraction succeeded for %s — %s ★%d (read_time=%s min)", url, name, stars, estimated_read_time)
                return base_result

        except Exception as e:
            logger.warning("GitHub API failed for %s: %s, falling back to OG", url, e)

    # Fallback: OG tag scraping
    try:
        with httpx.Client(timeout=10.0, follow_redirects=True) as client:
            resp = client.get(
                url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
            )
            resp.raise_for_status()
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(resp.text, "html.parser")

        def og(prop: str) -> str | None:
            tag = soup.find("meta", property=f"og:{prop}")
            return tag.get("content") if tag and tag.get("content") else None

        base_result.update({
            "title": og("title") or (f"{owner}/{repo}" if owner and repo else "GitHub"),
            "description": og("description"),
            "thumbnail_url": og("image"),
            "author": owner,
        })
    except Exception as e:
        logger.error("GitHub OG fallback failed for %s: %s", url, e)
        base_result["title"] = (f"{owner}/{repo}" if owner and repo else "GitHub Repository")

    return base_result
