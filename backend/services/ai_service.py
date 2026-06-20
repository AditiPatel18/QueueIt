"""
AI Service for QueueIt - Handles tagging, summarization, and priority scoring.
Uses Google Gemini API (free tier).
Fails gracefully if API key is missing or API call fails.
"""

import google.generativeai as genai
from typing import List, Optional
import json
import re
import logging

logger = logging.getLogger(__name__)


def _build_fallback_summary(title: str, content: str, description: str = "", content_type: str = "article") -> Optional[str]:
    """Build a deterministic fallback summary from available text.

    Fallback chain: content (extracted_text) -> description -> title.
    Returns a concise summary or None if nothing useful is available.
    """
    if content_type == "youtube":
        return "AI summary could not be generated."

    # Try extracted content first
    text = (content or "").strip()
    if not text:
        text = (description or "").strip()
    if not text:
        text = (title or "").strip()

    if not text or len(text) < 10:
        return None

    # Take first 2 sentences or first 120 words, whichever is shorter
    sentences = re.split(r'(?<=[.!?])\s+', text)
    if len(sentences) >= 2:
        summary = " ".join(sentences[:2]).strip()
    else:
        summary = text

    # Cap at ~120 words
    words = summary.split()
    if len(words) > 120:
        summary = " ".join(words[:120]) + "..."

    # Cap at 500 chars
    if len(summary) > 500:
        summary = summary[:497] + "..."

    return summary if len(summary) >= 10 else None



def _clean_greetings(text: str) -> str:
    """Strip greetings, intro phrases, and preamble from the beginning of the text."""
    if not text:
        return ""
    text = text.strip()
    
    # List of regex patterns matching common greetings/preambles at the start of a summary
    # Match sentences or phrases up to punctuation/greetings
    patterns = [
        r"^(?:hello|hi|hey|welcome|welcome\s+back)(?:\s+everyone|\s+guys|\s+folks|\s+there|\s+to\s+the\s+channel)?(?:[,.!?\s]+|$)",
        r"^in\s+this\s+(?:video|tutorial|content)(?:,\s+we|,\s+i|,\s+this)?(?:\s+will\s+talk\s+about|\s+will\s+show\s+you|\s+discusses|\s+covers|\s+explains)?(?:[,.!?\s]+|$)",
        r"^today(?:\s+we\s+are\s+going\s+to|\s+i'm\s+going\s+to|\s+we'll)?\s+(?:discuss|learn|cover|talk\s+about|look\s+at)(?:[,.!?\s]+|$)",
    ]
    
    changed = True
    while changed:
        changed = False
        for pattern in patterns:
            cleaned = re.sub(pattern, "", text, flags=re.IGNORECASE)
            if cleaned != text:
                text = cleaned.strip()
                changed = True
                break
                
    if text and text[0].islower():
        text = text[0].upper() + text[1:]
    return text


class AIService:
    def __init__(self, api_key: Optional[str] = None):
        self.enabled = False
        if api_key:
            try:
                genai.configure(api_key=api_key)
                self.model = genai.GenerativeModel('gemini-2.5-flash')
                self.enabled = True
                logger.info("AI Service initialized successfully")
            except Exception as e:
                logger.warning(f"AI Service initialization failed: {e}")
                self.enabled = False
        else:
            logger.warning("No API key provided. AI features disabled.")
    
    def _clean_json_response(self, text: str) -> str:
        """Extract clean JSON from AI response that might contain extra text."""
        # Remove markdown code blocks if present
        text = re.sub(r'```json\s*', '', text)
        text = re.sub(r'```\s*', '', text)
        text = text.strip()
        return text
    
    def generate_summary(self, title: str, content: str = "", description: str = "", content_type: str = "article") -> Optional[str]:
        """Generate a structured summary for a single item. Used for backfill/on-demand generation.

        Always returns a summary string (never None) — uses AI if available,
        otherwise falls back to deterministic extraction.
        """
        # Prevent title-only summaries by checking similarity
        def is_too_similar(t: str, s: str) -> bool:
            import difflib
            if not t or not s:
                return False
            ratio = difflib.SequenceMatcher(None, t.lower(), s.lower()).ratio()
            return ratio > 0.7

        # If AI enabled, generate structured summary
        if self.enabled:
            # Generate raw summary via analyze_content
            raw_res = self.analyze_content(title, content, content_type)
            raw_summary = raw_res.get("summary") or ""
            # Ensure not too similar to title
            if is_too_similar(title, raw_summary):
                fallback_reason = "AI summary is too similar to title"
                logger.warning(f"Fallback reason: {fallback_reason}")
                raw_summary = ""
            # Generate structured summary if needed
            if raw_summary:
                if content_type == "youtube":
                    return raw_summary
                structured = self.generate_structured_summary(raw_summary, content_type)
                if structured:
                    return structured
            # If raw summary missing or unsuitable, fall back
        # Fallback deterministic summary
        fallback_reason = "AI generation returned empty summary or is disabled, falling back to deterministic summary"
        logger.warning(f"Fallback reason: {fallback_reason}")
        fallback = _build_fallback_summary(title, content, description, content_type)
        return fallback


    def generate_tags(self, title: str, content: str = "", source_type: str = "article") -> List[str]:
        """Generate tags for an item using AI or fallback.

        Returns a list of tags (lowercase hyphenated). If AI disabled, returns ['uncategorized'].
        """
        if self.enabled:
            res = self.analyze_content(title, content, source_type)
            if res and isinstance(res.get("tags"), list):
                return res.get("tags")
        return ["uncategorized"]

    def _retry_youtube_analysis(self, content: str, transcript_len: int) -> dict:
        logger.info("Retrying YouTube summarization with a simpler prompt...")
        print("[DEBUG LOG] Retrying YouTube summarization with a simpler prompt...")
        
        truncated_content = (content or "")[:25000]
        simpler_prompt = f"""You are a content summarizer. Write a 150-250 word study note summary of this YouTube transcript.
Ignore all greetings, introductions, sponsor messages, and filler conversation.
Start directly with the main topic. Do not copy transcript sentences verbatim.
Write completely in your own words.

TRANSCRIPT:
{truncated_content}

Return ONLY a JSON object:
{{
  "tags": ["keyconcept1", "keyconcept2"],
  "summary": "YOUR SUMMARY HERE",
  "priority": 50
}}
"""
        simpler_prompt_len = len(simpler_prompt)
        logger.info(f"Prompt length: {simpler_prompt_len}")
        print(f"[PIPELINE LOG] [AI Service] text sent to Gemini length: {simpler_prompt_len}")
        try:
            response = self.model.generate_content(simpler_prompt)
            raw_text = response.text if response and hasattr(response, 'text') else ""
            logger.info(f"Raw Gemini response (first 300 chars): {raw_text[:300]}")
            print(f"[DEBUG LOG] Raw Gemini response (first 300 chars): {raw_text[:300]}")
            text = self._clean_json_response(raw_text)
            
            gemini_output_len = len(raw_text)
            print(f"[PIPELINE LOG] [AI Service] Gemini response length: {gemini_output_len}")
            try:
                result = json.loads(text)
                tags = result.get("tags", [])
                summary = result.get("summary")
                priority = result.get("priority", 50)
                
                # Validation
                cleaned_tags = []
                if isinstance(tags, list):
                    for tag in tags[:5]:
                        if isinstance(tag, str):
                            cleaned = tag.lower().strip().replace(' ', '-')
                            cleaned = re.sub(r'[^a-z0-9-]', '', cleaned)
                            if cleaned and len(cleaned) > 1:
                                cleaned_tags.append(cleaned)
                if not cleaned_tags:
                    cleaned_tags = ["uncategorized"]

                if isinstance(priority, (int, float)):
                    priority = max(0, min(100, int(priority)))
                else:
                    priority = 50

                if not summary or len(str(summary)) < 10:
                    raise ValueError("Summary is empty or too short in retry")

                logger.info("Whether JSON parsing succeeded: True")
                print("[DEBUG LOG] Whether JSON parsing succeeded: True")
                logger.info("Whether fallback was used: False")
                print("[DEBUG LOG] Whether fallback was used: False")
                print(f"[PIPELINE LOG] [AI Service] ai_summary length: {len(str(summary))}")
                return {
                    "tags": cleaned_tags,
                    "summary": str(summary),
                    "priority": priority
                }
            except (json.JSONDecodeError, ValueError) as json_err:
                logger.error(f"Retry JSON parsing failed: {json_err}")
                logger.info("Whether JSON parsing succeeded: False")
                print("[DEBUG LOG] Whether JSON parsing succeeded: False")
                logger.info("Whether fallback was used: True")
                print("[DEBUG LOG] Whether fallback was used: True")
                summary = "AI summary could not be generated."
                print(f"[PIPELINE LOG] [AI Service] ai_summary length: {len(summary)}")
                return {
                    "tags": ["uncategorized"],
                    "summary": summary,
                    "priority": 50
                }
        except Exception as e:
            logger.error(f"Retry Gemini generation failed: {e}")
            logger.info("Whether JSON parsing succeeded: False")
            print("[DEBUG LOG] Whether JSON parsing succeeded: False")
            logger.info("Whether fallback was used: True")
            print("[DEBUG LOG] Whether fallback was used: True")
            summary = "AI summary could not be generated."
            print(f"[PIPELINE LOG] [AI Service] ai_summary length: {len(summary)}")
            return {
                "tags": ["uncategorized"],
                "summary": summary,
                "priority": 50
            }

    def analyze_content(self, title: str, content: str, content_type: str = "article") -> dict:
        """Analyze content using AI or fallback.
        Returns a dict with keys: tags, summary, priority.
        """
        # 1. Extractor/Full Text Stage Logs
        content_len = len(content) if content else 0
        print(f"[PIPELINE LOG] [AI Service] extracted_text length: {content_len}")
        print(f"[PIPELINE LOG] [AI Service] full_text length: {content_len}")

        # Check text length for "Limited text available" rule
        # "Limited text available" should ONLY appear when the available text is genuinely less than 300 characters.
        # It must NEVER appear if transcript length >300 or article text >300.
        available_text = (content or "").strip()
        if len(available_text) < 300:
            print(f"[PIPELINE LOG] [AI Service] Genuinely less than 300 characters ({len(available_text)}). Returning 'Limited text available'")
            summary = "Limited text available"
            print(f"[PIPELINE LOG] [AI Service] ai_summary length: {len(summary)}")
            return {
                "tags": ["uncategorized"],
                "summary": summary,
                "priority": 30
            }

        fallback_summary = _build_fallback_summary(title, content, "", content_type)
        default_result = {"tags": ["uncategorized"], "summary": fallback_summary, "priority": 50}

        if not self.enabled:
            fallback_reason = "AI service not enabled"
            logger.warning(f"Fallback reason: {fallback_reason}")
            if content_type == "youtube":
                transcript_len = len(content) if content else 0
                logger.info(f"Transcript length: {transcript_len}")
                print(f"[DEBUG LOG] Transcript length: {transcript_len}")
                logger.info("Prompt length: 0")
                print("[DEBUG LOG] Prompt length: 0")
                logger.info("Raw Gemini response (first 300 chars): ")
                print("[DEBUG LOG] Raw Gemini response (first 300 chars): ")
                logger.info("Whether JSON parsing succeeded: False")
                print("[DEBUG LOG] Whether JSON parsing succeeded: False")
                logger.info("Whether fallback was used: True")
                print("[DEBUG LOG] Whether fallback was used: True")
            summary = fallback_summary or "AI summary could not be generated."
            print(f"[PIPELINE LOG] [AI Service] ai_summary length: {len(summary)}")
            return default_result

        if content_type == "youtube":
            content_preview = (content or "")[:25000]
        else:
            content_preview = (content or "")[:8000]
        
        title_preview = (title or "Untitled")[:300]

        type_instructions = ""
        if content_type == "youtube":
            type_instructions = """
Generate a study note summary of the YouTube video transcript.
Strictly adhere to the following rules:
1. IGNORE all introductions, greetings (e.g., "Hey everyone", "Welcome back", "Hi guys"), sponsor messages, subscribe requests, channel promotions, and filler conversation.
2. START directly with the main topic that the video teaches. Do not use conversational preamble or introductory phrases.
3. EXPLAIN what the video teaches, mention the important concepts, and key techniques/examples.
4. END with a short takeaway.
5. WRITE completely in your own words. Do NOT copy transcript sentences verbatim. Do NOT return the first paragraph or direct sentences from the transcript.
6. The summary MUST read like a structured study note, not like subtitles or conversational text.
7. Ensure the total word count is strictly between 150 and 250 words.
"""
        elif content_type == "github":
            type_instructions = """
Generate a structured 100-250 word summary based on the README text, description and tags. Include:
• Project purpose/mission
• Key features
• Tech stack used
• Usage/getting started summary
NEVER use or return only the title.
"""
        elif content_type == "leetcode":
            type_instructions = """
Generate a structured 100-250 word summary based on the problem description. Include:
• Problem definition
• Constraints
• Intuition
• Optimal approach
• Complexity (time and space complexity)
NEVER use or return only the title.
"""
        elif content_type == "instagram":
            type_instructions = """
Generate a concise summary of the caption and visible content only.
If there is insufficient text/caption or it is generic/empty, return exactly "Limited text available".
NEVER use or return only the title.
"""
        elif content_type == "pdf":
            type_instructions = """
Generate a structured 100-250 word summary of the PDF document contents. Include:
• Document purpose/theme
• Key sections/points
• Core findings or methodology
• Conclusion/takeaways
NEVER use or return only the title.
"""
        else:  # article / generic
            type_instructions = """
Generate a structured 100-250 word summary from the actual body of the article (do not summarize website navigation or layout boilerplate). Include:
• Core thesis/main topic
• Major arguments or points of discussion
• Key takeaways or conclusions
NEVER use or return only the title.
"""

        prompt = f"""You are a content analyzer and summarizer for QueueIt. Analyze this content and return a JSON payload with tags, summary, and priority score.

TITLE: {title_preview}
TYPE: {content_type}
CONTENT:
{content_preview}

TYPE-SPECIFIC SUMMARIZATION INSTRUCTIONS:
{type_instructions}

Return ONLY a JSON object:
{{
  "tags": ["tag1", "tag2", "tag3"],
  "summary": "YOUR SUMMARY HERE (strictly follow the type-specific instructions and word counts)",
  "priority": 70
}}

Rules:
- Tags: max 5 lowercase, hyphenated strings.
- Summary: 100-250 words (unless Instagram with insufficient text, which must return "Limited text available").
- Priority: Integer score 0-100 indicating importance/urgency.
- Do NOT include any markdown code blocks, backticks, or extra text. Return valid JSON only.
"""
        gemini_input_len = len(prompt)
        if content_type == "youtube":
            transcript_len = len(content) if content else 0
            logger.info(f"Transcript length: {transcript_len}")
            print(f"[DEBUG LOG] Transcript length: {transcript_len}")
        logger.info(f"Prompt length: {gemini_input_len}")
        print(f"[DEBUG LOG] Prompt length: {gemini_input_len}")
        print(f"[PIPELINE LOG] [AI Service] text sent to Gemini length: {gemini_input_len}")

        try:
            response = self.model.generate_content(prompt)
            raw_text = response.text if response and hasattr(response, 'text') else ""
            logger.info(f"Raw Gemini response (first 300 chars): {raw_text[:300]}")
            print(f"[DEBUG LOG] Raw Gemini response (first 300 chars): {raw_text[:300]}")
            text = self._clean_json_response(raw_text)
            
            gemini_output_len = len(raw_text)
            logger.info(f"Gemini output length: {gemini_output_len}")
            print(f"[PIPELINE LOG] [AI Service] Gemini response length: {gemini_output_len}")

            try:
                result = json.loads(text)

                tags = result.get("tags", [])
                summary = result.get("summary")
                priority = result.get("priority", 50)

                # Validation
                cleaned_tags = []
                if isinstance(tags, list):
                    for tag in tags[:5]:
                        if isinstance(tag, str):
                            cleaned = tag.lower().strip().replace(' ', '-')
                            cleaned = re.sub(r'[^a-z0-9-]', '', cleaned)
                            if cleaned and len(cleaned) > 1:
                                cleaned_tags.append(cleaned)
                if not cleaned_tags:
                    cleaned_tags = ["uncategorized"]

                if isinstance(priority, (int, float)):
                    priority = max(0, min(100, int(priority)))
                else:
                    priority = 50

                # Ensure summary is never None or empty
                if not summary or len(str(summary)) < 10:
                    raise ValueError("Summary is empty or too short")
                else:
                    summary = str(summary)

                logger.info("Whether JSON parsing succeeded: True")
                print("[DEBUG LOG] Whether JSON parsing succeeded: True")
                logger.info("Whether fallback was used: False")
                print("[DEBUG LOG] Whether fallback was used: False")
                print(f"[PIPELINE LOG] [AI Service] ai_summary length: {len(summary)}")
                return {
                    "tags": cleaned_tags,
                    "summary": summary,
                    "priority": priority
                }

            except (json.JSONDecodeError, ValueError) as json_err:
                fallback_reason = f"Gemini JSON parsing failed: {json_err}"
                logger.warning(f"Fallback reason: {fallback_reason}")
                logger.info("Whether JSON parsing succeeded: False")
                print("[DEBUG LOG] Whether JSON parsing succeeded: False")

                if content_type == "youtube":
                    return self._retry_youtube_analysis(content, len(content) if content else 0)

                # Extract plain text summary for other content types
                summary_match = re.search(r'"summary"\s*:\s*"([^"]+)"', text)
                if summary_match:
                    summary = summary_match.group(1)
                else:
                    summary = text.strip()

                # Clean up greetings
                summary = _clean_greetings(summary)

                logger.info("Whether fallback was used: True")
                print("[DEBUG LOG] Whether fallback was used: True")
                print(f"[PIPELINE LOG] [AI Service] ai_summary length: {len(summary)}")
                return {
                    "tags": ["uncategorized"],
                    "summary": summary,
                    "priority": 50
                }

        except Exception as e:
            fallback_reason = f"Content analysis failed: {e}"
            logger.error(fallback_reason)
            logger.warning(f"Fallback reason: {fallback_reason}")
            logger.info("Whether JSON parsing succeeded: False")
            print("[DEBUG LOG] Whether JSON parsing succeeded: False")
            
            if content_type == "youtube":
                return self._retry_youtube_analysis(content, len(content) if content else 0)
                
            logger.info("Whether fallback was used: True")
            print("[DEBUG LOG] Whether fallback was used: True")
            summary = fallback_summary or "AI summary could not be generated."
            print(f"[PIPELINE LOG] [AI Service] ai_summary length: {len(summary)}")
            return default_result

    def generate_structured_summary(self, raw_summary: str, source_type: str) -> Optional[str]:
        """Create a structured summary with sections based on source type.

        Returns a string with headings like Overview, Key points, Important examples, Final takeaway.
        If generation fails, returns None.
        """
        if not raw_summary:
            return None
        # Build prompt for structured summary
        prompt = f"""You are an expert summarizer. Given the following content, produce a 150-400 word structured summary with the sections:

Overview
Key points
Important examples
Final takeaway

Do NOT include any title or metadata. Include only the content information.

Content:
{raw_summary}
"""
        try:
            response = self.model.generate_content(prompt)
            text = self._clean_json_response(response.text)
            # The model may return plain text; just strip
            structured = text.strip()
            if structured:
                return structured
        except Exception as e:
            logger.error(f"Failed to generate structured summary: {e}")
        return None

    def suggest_next_items(self, completed_tags: List[str], unread_items: List[dict]) -> dict:
        """Suggests the best next item based on completed tags and item metadata.
        
        Returns: {"item_id": str|None, "title": str, "reason": str}
        """
        if not unread_items:
            return {"item_id": None, "title": None, "reason": "No unread items in your queue. Add some content!"}

        if not self.enabled:
            # Fallback: pick highest priority item
            best = max(unread_items, key=lambda x: x.get("priority_score", 0))
            return {
                "item_id": best.get("id"),
                "title": best.get("title", "Untitled"),
                "reason": f"Highest priority item (score: {best.get('priority_score', 50)})"
            }
            
        # Prepare rich context for Gemini
        tags_context = ", ".join(completed_tags[:20]) if completed_tags else "None yet"
        items_context = []
        for i, item in enumerate(unread_items[:15]):
            tags = ", ".join(item.get("tags", [])[:3]) or "none"
            summary = (item.get("ai_summary") or "")[:80]
            priority = item.get("priority_score", 50)
            read_time = item.get("estimated_read_time") or "?"
            added = (item.get("added_at") or item.get("created_at") or "")[:10]
            items_context.append(
                f"[{i}] \"{item.get('title', 'Untitled')}\" | Tags: {tags} | Priority: {priority} | Time: {read_time}min | Added: {added} | Summary: {summary}"
            )
            
        prompt = f"""You are a smart queue assistant. Pick the SINGLE best next item to read/watch.

User's interests (from completed items): {tags_context}

Available items:
{chr(10).join(items_context)}

Score each item considering:
1. Relevance to user interests (tag overlap)
2. Priority score (higher = more important)
3. Freshness (recently added preferred)
4. Reasonable time commitment
5. Summary quality/interest

Return ONLY JSON:
{{"index": 0, "reason": "brief 10-15 word reason"}}
"""
        try:
            response = self.model.generate_content(prompt)
            text = self._clean_json_response(response.text)
            result = json.loads(text)
            
            idx = result.get("index", 0)
            if not isinstance(idx, int) or idx < 0 or idx >= len(unread_items):
                idx = 0
            
            chosen = unread_items[idx]
            reason = result.get("reason", "Best match for your interests")
            
            return {
                "item_id": chosen.get("id"),
                "title": chosen.get("title", "Untitled"),
                "reason": str(reason)
            }
        except Exception as e:
            logger.error(f"Recommendations failed: {e}")
            best = max(unread_items, key=lambda x: x.get("priority_score", 0))
            return {
                "item_id": best.get("id"),
                "title": best.get("title", "Untitled"),
                "reason": f"Highest priority item (score: {best.get('priority_score', 50)})"
            }
    
    def calculate_priority(
        self,
        title: str,
        summary: Optional[str],
        tags: List[str],
        source_type: str,
        estimated_time: Optional[int],
        days_since_added: int,
        user_interests: Optional[List[str]] = None
    ) -> float:
        """
        Calculate priority score between 0 and 100.
        Uses rule-based scoring (fast, reliable, no extra API call).
        """
        score = 50.0
        
        # Factor 1: Freshness (25 points max)
        if days_since_added <= 1:
            score += 25
        elif days_since_added <= 3:
            score += 20
        elif days_since_added <= 7:
            score += 12
        elif days_since_added <= 14:
            score += 5
        else:
            score -= 15
        
        # Factor 2: Content quality tags (20 points max)
        quality_tags = ["tutorial", "guide", "documentation", "course", "deep-dive", "explained", "how-to"]
        matching_quality = len(set(tags) & set(quality_tags))
        score += min(matching_quality * 5, 20)
        
        # Factor 3: Time sweet spot - 3 to 15 minutes (15 points max)
        if estimated_time:
            if 180 <= estimated_time <= 900:
                score += 15
            elif 60 <= estimated_time <= 180:
                score += 10
            elif estimated_time <= 60:
                score += 5
            elif estimated_time > 3600:
                score -= 10
        
        # Factor 4: Content type bonus (10 points max)
        type_bonus = {
            "youtube": 5,
            "article": 3,
            "github": 8,
            "twitter": 2,
            "reddit": 4,
        }
        score += type_bonus.get(source_type, 0)
        
        # Factor 5: Has summary bonus (5 points)
        if summary and len(summary) > 20:
            score += 5
        
        # Factor 6: User interest match (15 points max)
        if user_interests and tags:
            matching = len(set(tags) & set(user_interests))
            score += min(matching * 4, 15)
        
        # Factor 7: Has useful tags (10 points)
        if len(tags) >= 3:
            score += 10
        elif len(tags) >= 1:
            score += 5
        
        return round(min(max(score, 0), 100), 1)
    
    def get_user_interests_from_history(self, completed_tags: List[str]) -> List[str]:
        """Extract top interests from completed items' tags."""
        if not completed_tags:
            return []
        
        # Count tag frequency
        tag_counts = {}
        for tag in completed_tags:
            if tag != "uncategorized":
                tag_counts[tag] = tag_counts.get(tag, 0) + 1
        
        # Return top 10 most frequent tags
        sorted_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)
        return [tag for tag, count in sorted_tags[:10]]


# Global instance
_ai_service_instance: Optional[AIService] = None

def get_ai_service() -> AIService:
    """Get or create AI service singleton."""
    global _ai_service_instance
    if _ai_service_instance is None:
        from config import GEMINI_API_KEY
        _ai_service_instance = AIService(GEMINI_API_KEY)
    return _ai_service_instance
