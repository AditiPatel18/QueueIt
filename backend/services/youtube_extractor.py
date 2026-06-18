"""
YouTube content extractor using yt-dlp.
Extracts metadata without downloading the video.
"""

import logging
from yt_dlp import YoutubeDL

logger = logging.getLogger(__name__)


def extract_youtube(url: str) -> dict:
    """
    Extract YouTube metadata without downloading the video.

    Returns a standardised content dict.
    """
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",  # Don't download playlists fully
        "skip_download": True,
        "writesubtitles": True,
        "allsubtitles": False,
        "subtitleslangs": ["en"],
    }

    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                raise ValueError("Could not extract video info")

            import re
            from youtube_transcript_api import YouTubeTranscriptApi
            
            video_id = None
            for pattern in [r"v=([a-zA-Z0-9_-]{11})", r"youtu\.be/([a-zA-Z0-9_-]{11})", r"embed/([a-zA-Z0-9_-]{11})", r"shorts/([a-zA-Z0-9_-]{11})"]:
                match = re.search(pattern, url)
                if match:
                    video_id = match.group(1)
                    break
            
            transcript_val = None
            full_text_val = None
            
            # Priority A: youtube-transcript-api
            if video_id:
                try:
                    api = YouTubeTranscriptApi()
                    fetched = api.fetch(video_id, languages=["en", "es", "fr", "de"])
                    transcript_list = fetched.to_raw_data()
                    transcript_val = " ".join([t["text"] for t in transcript_list])
                    full_text_val = transcript_val
                    logger.info("Successfully fetched transcript for YouTube video %s using youtube-transcript-api", video_id)
                except Exception as e:
                    logger.warning("Could not fetch transcript for YouTube video %s using youtube-transcript-api: %s", video_id, e)

            # Priority B: use available captions/subtitles from yt-dlp
            if not transcript_val:
                try:
                    subtitles = info.get("subtitles") or {}
                    auto_captions = info.get("automatic_captions") or {}
                    
                    sub_text = None
                    for subtitle_dict in [subtitles, auto_captions]:
                        if sub_text:
                            break
                        for lang in ["en", "es", "fr", "de"]:
                            if lang in subtitle_dict:
                                formats = subtitle_dict[lang]
                                url_fmt = None
                                ext = None
                                for fmt in formats:
                                    if fmt.get("ext") == "json3":
                                        url_fmt = fmt.get("url")
                                        ext = "json3"
                                        break
                                if not url_fmt:
                                    for fmt in formats:
                                        if fmt.get("ext") in ["vtt", "srv1", "srv3", "ttml"]:
                                            url_fmt = fmt.get("url")
                                            ext = fmt.get("ext")
                                            break
                                if not url_fmt and formats:
                                    url_fmt = formats[0].get("url")
                                    ext = formats[0].get("ext")
                                
                                if url_fmt:
                                    try:
                                        import urllib.request
                                        import json
                                        req = urllib.request.Request(url_fmt, headers={'User-Agent': 'Mozilla/5.0'})
                                        with urllib.request.urlopen(req, timeout=10) as response:
                                            content = response.read()
                                        
                                        if ext == "json3":
                                            data = json.loads(content.decode("utf-8"))
                                            text_parts = []
                                            for event in data.get("events", []):
                                                if "segs" in event:
                                                    for seg in event["segs"]:
                                                        if seg.get("utf8"):
                                                            text_parts.append(seg["utf8"])
                                            if text_parts:
                                                sub_text = " ".join(text_parts)
                                                break
                                        else:
                                            text = content.decode("utf-8", errors="ignore")
                                            text = re.sub(r'<[^>]+>', '', text)
                                            text = re.sub(r'\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}', '', text)
                                            lines = []
                                            for line in text.splitlines():
                                                line = line.strip()
                                                if not line:
                                                    continue
                                                if line.startswith("WEBVTT") or line.startswith("Kind:") or line.startswith("Language:"):
                                                    continue
                                                if re.match(r'^\d+$', line):
                                                    continue
                                                lines.append(line)
                                            if lines:
                                                sub_text = " ".join(lines)
                                                break
                                    except Exception as sub_err:
                                        logger.warning("Failed to fetch/parse subtitle format %s from url %s: %s", ext, url_fmt, sub_err)
                    
                    if sub_text:
                        transcript_val = sub_text
                        full_text_val = sub_text
                        logger.info("Successfully fetched transcript from yt-dlp subtitles/captions")
                except Exception as e:
                    logger.warning("Could not extract subtitles from yt-dlp: %s", e)

            # Priority C: description + chapters + metadata
            if not transcript_val:
                metadata_parts = []
                description_val = info.get("description")
                if description_val:
                    metadata_parts.append(f"Description: {description_val}")
                
                chapters = info.get("chapters")
                if chapters:
                    chapters_str = "Chapters:\n" + "\n".join([f"- {ch.get('title')} ({ch.get('start_time')}s - {ch.get('end_time')}s)" for ch in chapters])
                    metadata_parts.append(chapters_str)
                
                tags = info.get("tags")
                if tags:
                    metadata_parts.append(f"Tags: {', '.join(tags)}")
                
                categories = info.get("categories")
                if categories:
                    metadata_parts.append(f"Categories: {', '.join(categories)}")
                
                if metadata_parts:
                    full_text_val = "\n\n".join(metadata_parts)
                    logger.info("Used description + chapters + metadata as fallback content")
                else:
                    # Priority D: If none exist, return full_text=None
                    full_text_val = None
                    logger.info("No transcript, captions, description, chapters, or metadata found. full_text set to None.")

            duration = info.get("duration")
            estimated_read_time = duration  # Use duration as estimated watch time in seconds

            return {
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
    except Exception as e:
        logger.error("YouTube extraction failed for %s: %s", url, e)
        return {
            "title": "Untitled Video",
            "author": None,
            "thumbnail": None,
            "thumbnail_url": None,
            "duration": None,
            "duration_seconds": None,
            "transcript": None,
            "full_text": None,
            "description": None,
            "source_type": "youtube",
            "source_name": "YouTube",
            "video_url": url,
            "word_count": None,
            "estimated_read_time": None,
            "published_date": None,
        }
