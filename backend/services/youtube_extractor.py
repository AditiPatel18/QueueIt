"""
YouTube content extractor using yt-dlp.
Extracts metadata without downloading the video.
"""

import logging
import json
import re
import threading
from pathlib import Path
from yt_dlp import YoutubeDL

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).resolve().parent.parent / ".youtube_cache"
CACHE_LOCK = threading.Lock()

def _get_cache_file(video_id: str) -> Path:
    return CACHE_DIR / f"{video_id}.json"

def _read_from_cache(video_id: str) -> dict:
    with CACHE_LOCK:
        try:
            cache_file = _get_cache_file(video_id)
            if cache_file.exists():
                with open(cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to read YouTube cache for {video_id}: {e}")
        return None

def _write_to_cache(video_id: str, data: dict) -> None:
    with CACHE_LOCK:
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_file = _get_cache_file(video_id)
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning(f"Failed to write YouTube cache for {video_id}: {e}")


def extract_youtube(url: str) -> dict:
    """
    Extract YouTube metadata without downloading the video.

    Returns a standardised content dict.
    """
    video_id = None
    for pattern in [r"v=([a-zA-Z0-9_-]{11})", r"youtu\.be/([a-zA-Z0-9_-]{11})", r"embed/([a-zA-Z0-9_-]{11})", r"shorts/([a-zA-Z0-9_-]{11})"]:
        match = re.search(pattern, url)
        if match:
            video_id = match.group(1)
            break

    if video_id:
        cached_data = _read_from_cache(video_id)
        if cached_data:
            logger.info(f"Cache hit for YouTube video {video_id}")
            print(f"[PIPELINE LOG] [Cache] Hit for YouTube video {video_id}")
            return cached_data

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",  # Don't download playlists fully
        "skip_download": True,
        "writesubtitles": True,
        "allsubtitles": False,
        "subtitleslangs": ["en"],
        "socket_timeout": 5,
        "retries": 0,
        "nocheckcertificate": True,
    }

    from youtube_transcript_api import YouTubeTranscriptApi
    
    transcript_val = None
    full_text_val = None
    info = {}

    # Step 1: Try yt-dlp for metadata
    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False) or {}
    except Exception as e:
        logger.warning(f"yt-dlp extraction failed: {e}")

    metadata_parts = []
    
    title = info.get("title")
    if title: metadata_parts.append(f"Title: {title.strip()}")
        
    uploader = info.get("uploader") or info.get("channel")
    if uploader: metadata_parts.append(f"Channel: {uploader.strip()}")
        
    upload_date = info.get("upload_date")
    if upload_date: metadata_parts.append(f"Upload Date: {upload_date}")
        
    duration = info.get("duration")
    if duration: metadata_parts.append(f"Duration: {duration}s")
        
    webpage_url = info.get("webpage_url") or url
    if webpage_url: metadata_parts.append(f"URL: {webpage_url}")
        
    description = info.get("description")
    if description and description.strip():
        metadata_parts.append(f"Description:\n{description.strip()}")
        
    chapters = info.get("chapters")
    if chapters:
        chapters_str = "Chapters:\n" + "\n".join([f"- {ch.get('title')} ({ch.get('start_time')}s - {ch.get('end_time')}s)" for ch in chapters])
        metadata_parts.append(chapters_str)
        
    tags = info.get("tags")
    if tags: metadata_parts.append(f"Tags: {', '.join(tags)}")
        
    categories = info.get("categories")
    if categories: metadata_parts.append(f"Categories: {', '.join(categories)}")
        
    view_count = info.get("view_count")
    if view_count is not None: metadata_parts.append(f"Views: {view_count}")
        
    like_count = info.get("like_count")
    if like_count is not None: metadata_parts.append(f"Likes: {like_count}")

    metadata_text = "\n\n".join(metadata_parts) if metadata_parts else ""

    selected_language = None
    # Step 2: Try youtube-transcript-api
    if video_id:
        try:
            import requests
            class TimeoutHTTPAdapter(requests.adapters.HTTPAdapter):
                def __init__(self, timeout=5.0, *args, **kwargs):
                    self.timeout = timeout
                    super().__init__(*args, **kwargs)
                def send(self, request, **kwargs):
                    kwargs["timeout"] = self.timeout
                    return super().send(request, **kwargs)
            
            session = requests.Session()
            adapter = TimeoutHTTPAdapter(timeout=5.0)
            session.mount("https://", adapter)
            session.mount("http://", adapter)
            
            api = YouTubeTranscriptApi(http_client=session)
            transcript_list = api.list(video_id)
            # Fetch the first available transcript regardless of language
            transcript = next(iter(transcript_list))
            selected_language = f"{transcript.language} ({transcript.language_code}){' [auto-generated]' if transcript.is_generated else ''}"
            transcript_data = transcript.fetch()
            transcript_val = " ".join([t.text for t in transcript_data])
        except Exception as e:
            logger.warning("Could not fetch transcript for YouTube video %s: %s", video_id, e)
    else:
        logger.warning("Could not fetch transcript: no video ID found in URL %s", url)

    # Step 3: Combine them
    if transcript_val and metadata_text:
        full_text_val = f"{transcript_val}\n\n--- METADATA ---\n{metadata_text}"
    elif transcript_val:
        full_text_val = transcript_val
    elif metadata_text:
        full_text_val = metadata_text
    else:
        full_text_val = "No metadata or transcript available for this video."

    # Step 4: Logging as required
    logger.info(f"Transcript language selected: {selected_language}")
    logger.info(f"Transcript fetched: {'YES' if transcript_val else 'NO'}")
    logger.info(f"Metadata fetched: {'YES' if metadata_text else 'NO'}")
    logger.info(f"Transcript length: {len(transcript_val) if transcript_val else 0}")
    logger.info(f"Metadata length: {len(metadata_text)}")
    logger.info(f"Final full_text length: {len(full_text_val)}")

    duration = info.get("duration")
    estimated_read_time = duration  # Use duration as estimated watch time in seconds

    result = {
        "title": info.get("title") or "Untitled Video",
        "author": info.get("uploader"),
        "thumbnail": info.get("thumbnail"),
        "thumbnail_url": info.get("thumbnail"),
        "duration": duration,
        "duration_seconds": duration,
        "transcript": transcript_val,
        "full_text": full_text_val,
        "description": info.get("description"),
        "source_type": "youtube",
        "source_name": "YouTube",
        "video_url": url,
        "word_count": None,
        "estimated_read_time": estimated_read_time,
        "published_date": info.get("upload_date"),
    }

    if video_id:
        _write_to_cache(video_id, result)

    return result
