"""
YouTube content extractor using yt-dlp.
Extracts metadata without downloading the video.
"""

import math
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


def _get_text_from_segment(seg) -> str:
    """Safely extract the text attribute or dict key from a transcript segment."""
    if hasattr(seg, "text"):
        return getattr(seg, "text") or ""
    if isinstance(seg, dict):
        return seg.get("text") or ""
    try:
        return seg["text"] or ""
    except Exception:
        return str(seg)


def _download_and_parse_subs(sub_formats: list) -> str:
    """Helper to fetch and parse subtitle tracks (json3 or WebVTT) from YouTube CDN."""
    if not sub_formats:
        return ""
    # Search for json3 first, then vtt, then srv3
    preferred_exts = ["json3", "vtt", "srv3"]
    selected_format = None
    for ext in preferred_exts:
        selected_format = next((f for f in sub_formats if f.get("ext") == ext), None)
        if selected_format:
            break
    if not selected_format:
        selected_format = sub_formats[0]
        
    sub_url = selected_format.get("url")
    if not sub_url:
        return ""
        
    try:
        import requests
        res = requests.get(sub_url, timeout=10)
        if res.status_code != 200:
            return ""
            
        ext = selected_format.get("ext")
        if ext == "json3":
            data = res.json()
            segments = []
            for event in data.get("events", []):
                for seg in event.get("segs", []):
                    text = seg.get("utf8", "").strip()
                    if text:
                        segments.append(text)
            return " ".join(segments)
        elif ext == "vtt" or ext == "srv3" or "vtt" in sub_url:
            import re
            text = res.text
            text = re.sub(r'^WEBVTT.*$', '', text, flags=re.MULTILINE)
            text = re.sub(r'^NOTE.*$', '', text, flags=re.MULTILINE)
            text = re.sub(r'\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}', '', text)
            text = re.sub(r'<[^>]+>', '', text)
            cleaned_lines = []
            for line in text.split("\n"):
                line_strip = line.strip()
                if line_strip.isdigit():
                    continue
                if line_strip:
                    cleaned_lines.append(line_strip)
            return " ".join(cleaned_lines)
        else:
            text = res.text
            text = re.sub(r'<[^>]+>', '', text)
            return " ".join([l.strip() for l in text.split("\n") if l.strip()])
    except Exception as err:
        logger.warning(f"Error fetching/parsing subtitles: {err}")
    return ""


def extract_youtube(url: str) -> dict:
    """
    Extract YouTube transcript, subtitles, captions, description, channel description, or metadata.
    Enforces the following extraction pipeline fallback chain:
    1. YouTube Transcript API
    2. yt-dlp manual subtitles (writesubtitles)
    3. yt-dlp automatic captions (writeautomaticsub)
    4. Video description
    5. Channel description
    6. Title + metadata
    7. Gemini/GPT summary from metadata (last fallback)
    """
    import math
    video_id = None
    import urllib.parse
    try:
        parsed = urllib.parse.urlparse(url)
        qs = urllib.parse.parse_qs(parsed.query)
        if "v" in qs:
            video_id = qs["v"][0]
    except Exception:
        pass

    if not video_id:
        for pattern in [
            r"v=([a-zA-Z0-9_-]{11})",
            r"youtu\.be/([a-zA-Z0-9_-]{11})",
            r"embed/([a-zA-Z0-9_-]{11})",
            r"shorts/([a-zA-Z0-9_-]{11})",
            r"live/([a-zA-Z0-9_-]{11})",
            r"v/([a-zA-Z0-9_-]{11})"
        ]:
            match = re.search(pattern, url)
            if match:
                video_id = match.group(1)
                break

    if video_id:
        cached_data = _read_from_cache(video_id)
        if cached_data:
            cached_title = cached_data.get("title") or ""
            cached_duration = cached_data.get("duration_seconds")
            if cached_title.strip().lower() in ("untitled video", "") or cached_duration is None:
                logger.warning(f"[PIPELINE LOG] [Cache] Stale/incomplete entry for {video_id}, refreshing...")
                _get_cache_file(video_id).unlink(missing_ok=True)
            else:
                logger.info(f"Cache hit for YouTube video {video_id}")
                print(f"[PIPELINE LOG] [Cache] Hit for YouTube video {video_id}")
                return cached_data

    from youtube_transcript_api import YouTubeTranscriptApi
    transcript_val = None
    selected_language = None
    transcript_data = None
    duration = None
    title = None
    uploader = None
    thumbnail = None
    description = None
    channel_description = None
    content_source = "METADATA"

    print("[PIPELINE LOG] [Extraction] Starting YouTube extraction pipeline...")

    # Fetch metadata via fast OEmbed first so we always have the title and channel name
    try:
        import urllib.request
        import urllib.parse
        oembed_url = f"https://www.youtube.com/oembed?url={urllib.parse.quote(url)}&format=json"
        req = urllib.request.Request(oembed_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as oembed_res:
            oembed_data = json.loads(oembed_res.read().decode())
            if oembed_data:
                title = oembed_data.get("title")
                uploader = oembed_data.get("author_name")
                thumbnail = oembed_data.get("thumbnail_url")
                print(f"[PIPELINE LOG] [Extraction] Fast OEmbed metadata fetched successfully. Title={title!r}, Channel={uploader!r}")
    except Exception as oembed_err:
        logger.warning(f"OEmbed extraction failed: {oembed_err}")
        print(f"[PIPELINE LOG] [Extraction] Fast OEmbed metadata failed: {oembed_err}")

    # Stage 1: YouTube Transcript API
    if video_id:
        import time
        for attempt in range(1, 4):
            try:
                print(f"[PIPELINE LOG] [Extraction] [Stage 1] Attempting YouTube Transcript API (attempt {attempt}/3)...")
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
                
                # Search order for transcript / captions:
                # 1. Manual English
                try:
                    transcript = transcript_list.find_manually_created_transcript(['en'])
                    transcript_data = transcript.fetch()
                    transcript_val = " ".join([_get_text_from_segment(t) for t in transcript_data])
                    selected_language = "manual en"
                except Exception:
                    # 2. Generated English (captions)
                    try:
                        transcript = transcript_list.find_generated_transcript(['en'])
                        transcript_data = transcript.fetch()
                        transcript_val = " ".join([_get_text_from_segment(t) for t in transcript_data])
                        selected_language = "generated en"
                    except Exception:
                        # 3. Translated manual to English
                        try:
                            transcript = next(t for t in transcript_list if not t.is_generated)
                            transcript_data = transcript.translate('en').fetch()
                            transcript_val = " ".join([_get_text_from_segment(t) for t in transcript_data])
                            selected_language = f"translated manual {transcript.language_code}"
                        except Exception:
                            # 4. Translated generated to English
                            try:
                                transcript = next(t for t in transcript_list if t.is_generated)
                                transcript_data = transcript.translate('en').fetch()
                                transcript_val = " ".join([_get_text_from_segment(t) for t in transcript_data])
                                selected_language = f"translated generated {transcript.language_code}"
                            except Exception:
                                # 5. First available raw transcript
                                transcript = next(iter(transcript_list))
                                transcript_data = transcript.fetch()
                                transcript_val = " ".join([_get_text_from_segment(t) for t in transcript_data])
                                selected_language = f"raw {transcript.language_code}"
                
                MIN_TRANSCRIPT_CHARS = 1000

                if transcript_val:
                    if len(transcript_val.strip()) >= MIN_TRANSCRIPT_CHARS:
                        content_source = "TRANSCRIPT"
                        print(f"[PIPELINE LOG] [Extraction] [Stage 1] YouTube Transcript API successful ({len(transcript_val)} chars). Source: TRANSCRIPT ({selected_language})")
                    else:
                        print(f"[PIPELINE LOG] [Extraction] [Stage 1] Transcript too short ({len(transcript_val)} chars < {MIN_TRANSCRIPT_CHARS}). Rejecting and continuing fallback...")
                        transcript_val = None

                # Infer duration from transcript timestamps (regardless of length check)
                if transcript_data:
                    try:
                        last_segment = transcript_data[-1]
                        if hasattr(last_segment, "start"):
                            duration = int(getattr(last_segment, "start", 0) + getattr(last_segment, "duration", 0))
                        elif isinstance(last_segment, dict):
                            duration = int(last_segment.get("start", 0) + last_segment.get("duration", 0))
                        else:
                            duration = int(last_segment["start"] + last_segment["duration"])
                    except Exception:
                        pass
                break # Break retry loop on success!
            except Exception as e:
                logger.warning(f"YouTube Transcript API failed for {video_id} (attempt {attempt}/3): {e}")
                print(f"[PIPELINE LOG] [Extraction] [Stage 1] YouTube Transcript API failed for {video_id} (attempt {attempt}/3): {e}")
                if attempt < 3:
                    time.sleep(1.0)

    # Stage 2 & 3 & 4 & 5: Call yt-dlp for subtitles, captions, video description, channel description
    info = {}
    if not transcript_val or not title or not uploader:
        print("[PIPELINE LOG] [Extraction] Transcript missing or metadata incomplete. Running yt-dlp stage...")
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "allsubtitles": False,
            "subtitleslangs": ["en"],
            "socket_timeout": 8,
            "retries": 1,
            "nocheckcertificate": True,
        }
        try:
            with YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False) or {}
                if info:
                    title = title or info.get("title")
                    uploader = uploader or info.get("uploader") or info.get("channel")
                    thumbnail = thumbnail or info.get("thumbnail")
                    duration = duration or info.get("duration")
                    description = info.get("description")
                    print(f"[PIPELINE LOG] [Extraction] [Stage 2] yt-dlp metadata extracted successfully. Title={title!r}, Duration={duration}s")
                    
                    MIN_TRANSCRIPT_CHARS = 1000

                    # 2. yt-dlp subtitles
                    if not transcript_val:
                        print("[PIPELINE LOG] [Extraction] [Stage 2] Checking for manual English subtitles in yt-dlp...")
                        subs = info.get("subtitles") or {}
                        en_subs = subs.get("en") or subs.get("en-US") or subs.get("en-GB")
                        if en_subs:
                            parsed_sub = _download_and_parse_subs(en_subs)
                            if parsed_sub and len(parsed_sub.strip()) >= MIN_TRANSCRIPT_CHARS:
                                transcript_val = parsed_sub
                                content_source = "SUBTITLES"
                                print(f"[PIPELINE LOG] [Extraction] [Stage 2] yt-dlp manual subtitles successful ({len(parsed_sub)} chars). Source: SUBTITLES")
                            elif parsed_sub:
                                print(f"[PIPELINE LOG] [Extraction] [Stage 2] Manual subtitles too short ({len(parsed_sub.strip())} chars < {MIN_TRANSCRIPT_CHARS}). Rejecting and continuing fallback...")

                    # 3. yt-dlp automatic captions
                    if not transcript_val:
                        print("[PIPELINE LOG] [Extraction] [Stage 3] Checking for automatic English captions in yt-dlp...")
                        auto_subs = info.get("automatic_captions") or {}
                        en_auto = auto_subs.get("en") or auto_subs.get("en-US") or auto_subs.get("en-GB")
                        if en_auto:
                            parsed_auto = _download_and_parse_subs(en_auto)
                            if parsed_auto and len(parsed_auto.strip()) >= MIN_TRANSCRIPT_CHARS:
                                transcript_val = parsed_auto
                                content_source = "AUTOMATIC_CAPTIONS"
                                print(f"[PIPELINE LOG] [Extraction] [Stage 3] yt-dlp automatic captions successful ({len(parsed_auto)} chars). Source: AUTOMATIC_CAPTIONS")
                            elif parsed_auto:
                                print(f"[PIPELINE LOG] [Extraction] [Stage 3] Automatic captions too short ({len(parsed_auto.strip())} chars < {MIN_TRANSCRIPT_CHARS}). Rejecting and continuing fallback...")
        except Exception as e:
            logger.warning(f"yt-dlp extraction failed: {e}")
            print(f"[PIPELINE LOG] [Extraction] [Stage 2] yt-dlp extraction failed: {e}")

    # Stage 4: Video Description
    if not transcript_val:
        if description and len(description.strip()) > 30:
            content_source = "DESCRIPTION"
            print("[PIPELINE LOG] [Extraction] [Stage 4] Video description fallback successful. Source: DESCRIPTION")
        else:
            print("[PIPELINE LOG] [Extraction] [Stage 4] Video description missing or too short.")

    # Stage 5: Channel Description
    if not transcript_val and not (description and len(description.strip()) > 30):
        uploader_url = info.get("uploader_url") or info.get("channel_url") if info else None
        if uploader_url:
            print(f"[PIPELINE LOG] [Extraction] [Stage 5] Attempting to fetch channel description from {uploader_url}...")
            try:
                with YoutubeDL({"quiet": True, "extract_flat": True, "socket_timeout": 4}) as ch_ydl:
                    ch_info = ch_ydl.extract_info(uploader_url, download=False) or {}
                    channel_description = ch_info.get("description")
                    if channel_description and len(channel_description.strip()) > 30:
                        content_source = "CHANNEL_DESCRIPTION"
                        print("[PIPELINE LOG] [Extraction] [Stage 5] Channel description fallback successful. Source: CHANNEL_DESCRIPTION")
            except Exception as ch_err:
                logger.warning(f"Failed to fetch channel description: {ch_err}")
                print(f"[PIPELINE LOG] [Extraction] [Stage 5] Channel description fetch failed: {ch_err}")

    # Stage 6: Title + Metadata
    if not transcript_val and not (description and len(description.strip()) > 30) and not channel_description:
        content_source = "METADATA"
        print("[PIPELINE LOG] [Extraction] [Stage 6] Falling back to Title + Metadata. Source: METADATA")

    # Compile metadata text
    metadata_parts = []
    if title: metadata_parts.append(f"Title: {title.strip()}")
    if uploader: metadata_parts.append(f"Channel: {uploader.strip()}")
    if info and info.get("upload_date"): metadata_parts.append(f"Upload Date: {info.get('upload_date')}")
    if duration: metadata_parts.append(f"Duration: {duration}s")
    if info and info.get("webpage_url"): metadata_parts.append(f"URL: {info.get('webpage_url')}")
    if description: metadata_parts.append(f"Description:\n{description.strip()}")
    if channel_description: metadata_parts.append(f"Channel Description:\n{channel_description.strip()}")
    
    metadata_text = "\n\n".join(metadata_parts)

    # Compile final full text to send to AI
    if transcript_val and metadata_text:
        full_text_val = f"{transcript_val}\n\n--- METADATA ---\n{metadata_text}"
    elif transcript_val:
        full_text_val = transcript_val
    elif metadata_text:
        full_text_val = metadata_text
    else:
        full_text_val = f"Title: {title or 'Untitled Video'}\nChannel: {uploader or 'Unknown Channel'}\nNo transcript or description available."

    duration = duration or 0
    estimated_read_time = max(1, math.ceil(duration / 60.0))

    result = {
        "title": title or "Untitled Video",
        "author": uploader or "Unknown Channel",
        "thumbnail": thumbnail,
        "thumbnail_url": thumbnail,
        "duration": duration,
        "duration_seconds": duration,
        "transcript": transcript_val,
        "full_text": full_text_val,
        "description": description or (metadata_text[:300] if metadata_text else None),
        "source_type": "youtube",
        "source_name": "YouTube",
        "video_url": url,
        "word_count": None,
        "estimated_read_time": estimated_read_time,
        "published_date": info.get("upload_date") if info else None,
        "content_source": content_source,
    }

    if video_id:
        _write_to_cache(video_id, result)

    print(f"[PIPELINE LOG] [Extraction] Completed. Selected content_source: {content_source}")
    return result
