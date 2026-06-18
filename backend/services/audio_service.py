import os
from pathlib import Path
from typing import Optional

from gtts import gTTS

from config import get_settings

class AudioService:
    """Generate and cache audio summaries for items using gTTS.

    The service creates an MP3 file for a given item ID based on its AI summary.
    If the file already exists, it returns the existing URL (caching).
    """

    @staticmethod
    def _audio_file_path(item_id: str) -> Path:
        return Path(get_settings().STATIC_AUDIO_PATH) / f"{item_id}_summary.mp3"

    @classmethod
    def generate_summary_audio(cls, item_id: str, summary_text: str) -> Optional[str]:
        """Generate (or retrieve cached) audio MP3 for the provided summary.

        Returns the relative URL path to the audio file, or ``None`` on failure.
        """
        if not summary_text:
            return None
        audio_path = cls._audio_file_path(item_id)
        # Ensure directory exists
        os.makedirs(audio_path.parent, exist_ok=True)
        if not audio_path.is_file():
            try:
                tts = gTTS(text=summary_text, lang="en")
                tts.save(str(audio_path))
            except Exception as e:
                # Log error – in production use proper logger
                print(f"[AudioService] Failed to generate audio for {item_id}: {e}")
                return None
        # Return URL that FastAPI can serve as static files
        return f"/static/audio/{audio_path.name}"
