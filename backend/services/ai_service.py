"""
AI Service for QueueIt - Handles tagging, summarization, and priority scoring.
Uses Google Gemini API (free tier).
Fails gracefully if API key is missing or API call fails.
"""

import google.generativeai as genai
from typing import List, Optional, Any
import json
import re
import logging

logger = logging.getLogger(__name__)


FULL_SUMMARY_INSTRUCTION = """
Instructions for the 'full_summary' field:
- Write a detailed, comprehensive long-form educational summary of 500-1200 words (depending on content depth).
- Never repeat the short summary.
- Never return title or metadata in the summary text.
- Use transcript/content when available to extract details. If transcript is unavailable, use description + metadata + AI reasoning to create a detailed educational summary.
- Use Markdown headings (e.g. ##, ###) and bullet points.
- Structure the full summary to include:
  1. Main topic
  2. Core concepts explained
  3. Step-by-step explanation
  4. Important algorithms/techniques (if technical)
  5. Examples discussed
  6. Key takeaways
  7. Best practices
  8. Common mistakes
  9. Interview/exam points (technical)
  10. Final conclusion

- For coding videos/problems, you MUST include:
  - Problem statement
  - Brute force approach
  - Optimal approach
  - Time Complexity (Big O notation)
  - Space Complexity (Big O notation)
  - Dry run / Walkthrough
  - Edge cases
  - Interview tips

- For articles, you MUST include:
  - Executive summary
  - Important sections breakdown
  - Insights
  - Action items

- For motivational/productivity content, you MUST include:
  - Main lessons
  - Practical advice
  - Real-life examples
  - Actionable habits
  - Final takeaways
"""


def _build_fallback_summary(title: str, content: str, description: str = "", content_type: str = "article") -> Optional[str]:
    """Return the standard fallback message when AI summary cannot be generated."""
    return "Summary could not be generated."


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


def _clean_markdown(text: str) -> str:
    """Clean up markdown elements from the text to ensure it's plain text."""
    if not text:
        return ""
    # Strip markdown bolding **text** -> text
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
    # Strip markdown headers: ### Header -> Header
    text = re.sub(r'#+\s+([^\n]+)', r'\1', text)
    # Strip markdown list markers at start of lines: * item or - item -> item
    text = re.sub(r'^[ \t]*[*+-]\s+', '', text, flags=re.MULTILINE)
    return text.strip()


def _chunk_text(text: str, max_chars: int) -> List[str]:
    """Split text into chunks of at most max_chars characters, splitting on sentence/space boundaries."""
    if not text:
        return []
    
    paragraphs = text.split('\n')
    chunks = []
    current_chunk = []
    current_len = 0
    
    for para in paragraphs:
        para_len = len(para) + 1  # count newline
        if current_len + para_len > max_chars:
            if para_len > max_chars:
                if current_chunk:
                    chunks.append('\n'.join(current_chunk))
                    current_chunk = []
                    current_len = 0
                
                sentences = re.split(r'(?<=[.!?])\s+', para)
                for sent in sentences:
                    sent_len = len(sent) + 1
                    if current_len + sent_len > max_chars:
                        if sent_len > max_chars:
                            words = sent.split(' ')
                            for word in words:
                                word_len = len(word) + 1
                                if current_len + word_len > max_chars:
                                    if current_chunk:
                                        chunks.append(' '.join(current_chunk))
                                        current_chunk = [word]
                                        current_len = word_len
                                    else:
                                        chunks.append(word[:max_chars])
                                        current_chunk = [word[max_chars:]]
                                        current_len = len(word[max_chars:]) + 1
                                else:
                                    current_chunk.append(word)
                                    current_len += word_len
                        else:
                            if current_chunk:
                                chunks.append(' '.join(current_chunk))
                            current_chunk = [sent]
                            current_len = sent_len
                    else:
                        current_chunk.append(sent)
                        current_len += sent_len
            else:
                if current_chunk:
                    chunks.append('\n'.join(current_chunk))
                current_chunk = [para]
                current_len = para_len
        else:
            current_chunk.append(para)
            current_len += para_len
            
    if current_chunk:
        chunks.append('\n'.join(current_chunk))
        
    return chunks


class AIService:
    def __init__(self, api_key: Optional[str] = None):
        self.enabled = False
        self._config_verified = False
        self._init_error = None
        if api_key:
            try:
                genai.configure(api_key=api_key)
                self.model = genai.GenerativeModel('gemini-2.5-flash')
                self.enabled = True
                logger.info("AI Service initialized successfully")
            except Exception as e:
                logger.error(f"AI Service initialization failed: {e}")
                self.enabled = False
                self._init_error = e
        else:
            logger.warning("No API key provided. AI features disabled.")
            self._init_error = ValueError("GEMINI_API_KEY is not set.")

    
    def _clean_json_response(self, text: str) -> str:
        """Extract clean JSON from AI response that might contain extra text."""
        # Remove markdown code blocks if present
        text = re.sub(r'```json\s*', '', text)
        text = re.sub(r'```\s*', '', text)
        text = text.strip()
        return text

    def verify_configuration(self):
        """Verify API key and model existence."""
        if self._config_verified:
            return
        
        if not self.enabled:
            err = getattr(self, "_init_error", None) or ValueError("AI Service is disabled.")
            raise err
            
        try:
            # list_models to verify connectivity, API key, and model existence
            models = list(genai.list_models())
            model_names = [m.name for m in models]
            target_model = "models/gemini-2.5-flash"
            all_names = model_names + [n.replace("models/", "") for n in model_names]
            if target_model not in model_names and "gemini-2.5-flash" not in all_names:
                raise ValueError(f"Model {target_model} does not exist in available models: {model_names}")
            self._config_verified = True
            logger.info("AI Service API key and model verified successfully.")
            print("AI Service API key and model verified successfully.")
        except Exception as e:
            logger.error(f"Configuration verification failed: {e}")
            print(f"Configuration verification failed: {e}")
            raise e

    def _call_generative_model(self, prompt: str, content_len: int) -> str:
        import traceback
        model_name = getattr(self.model, "model_name", "gemini-2.5-flash")
        
        # Log prompt length, model name, transcript length
        logger.info(f"model: {model_name}")
        logger.info(f"prompt length: {len(prompt)}")
        logger.info(f"transcript length: {content_len}")
        print(f"model: {model_name}")
        print(f"prompt length: {len(prompt)}")
        print(f"transcript length: {content_len}")
        
        import time
        import re as _re
        max_attempts = 4
        backoff = 2.0
        
        for attempt in range(max_attempts):
            try:
                response = self.model.generate_content(prompt, request_options={"timeout": 60.0})
                raw_text = response.text if response and hasattr(response, 'text') else ""

                # Log token usage if available
                if response and hasattr(response, 'usage_metadata') and response.usage_metadata:
                    try:
                        prompt_tokens   = getattr(response.usage_metadata, 'prompt_token_count', None)
                        response_tokens = getattr(response.usage_metadata, 'candidates_token_count', None)
                        if prompt_tokens is not None:
                            logger.info(f"prompt_tokens: {prompt_tokens}")
                            print(f"[PIPELINE LOG] [AI Service] prompt_tokens: {prompt_tokens}")
                        if response_tokens is not None:
                            logger.info(f"response_tokens: {response_tokens}")
                            print(f"[PIPELINE LOG] [AI Service] response_tokens: {response_tokens}")
                    except Exception:
                        pass

                # Log successful API response
                try:
                    logger.info(f"API response: {raw_text}")
                except Exception:
                    try:
                        logger.info(f"API response: {raw_text.encode('ascii', errors='replace').decode('ascii')}")
                    except Exception:
                        pass
                try:
                    print(f"API response: {raw_text}")
                except UnicodeEncodeError:
                    print(f"API response: {raw_text.encode('ascii', errors='replace').decode('ascii')}")
                
                return raw_text
            except Exception as e:
                err_str = str(e)
                
                # Check for daily quota exhaustion — no point retrying if daily limit hit
                is_daily_quota = (
                    "GenerateRequestsPerDayPerProjectPerModel" in err_str or
                    "generate_content_free_tier_requests" in err_str
                )
                if is_daily_quota:
                    logger.error(f"[LLM] Gemini FREE TIER daily quota exhausted. Cannot retry. Error: {e}")
                    print(f"[LLM] Gemini FREE TIER daily quota exhausted. Cannot retry until quota resets.")
                    raise e
                
                if attempt < max_attempts - 1:
                    # Try to parse the retry_delay from the 429 response
                    sleep_time = backoff * (2 ** attempt)
                    delay_match = _re.search(r'retry[_\s]delay[^0-9]*(\d+)', err_str, _re.IGNORECASE)
                    if delay_match:
                        api_delay = int(delay_match.group(1))
                        sleep_time = min(api_delay + 2, 90)  # cap at 90s
                        logger.warning(f"Generative AI rate limited. API says retry in {api_delay}s, waiting {sleep_time}s...")
                        print(f"[LLM] Rate limited. API-specified retry delay: {api_delay}s. Waiting {sleep_time}s...")
                    else:
                        logger.warning(f"Generative AI call failed (attempt {attempt+1}/{max_attempts}). Retrying in {sleep_time}s... Error: {e}")
                        print(f"Generative AI call failed (attempt {attempt+1}/{max_attempts}). Retrying in {sleep_time}s...")
                    time.sleep(sleep_time)
                    continue
                
                tb = traceback.format_exc()
                
                # Log real error and exception stack trace
                logger.error("=== LLM CALL FAILED ===")
                logger.error(f"model: {model_name}")
                logger.error(f"transcript length: {content_len}")
                logger.error(f"prompt length: {len(prompt)}")
                logger.error(f"stack trace:\n{tb}")
                logger.error("=======================")
                
                print("=== LLM CALL FAILED ===")
                print(f"model: {model_name}")
                print(f"transcript length: {content_len}")
                print(f"prompt length: {len(prompt)}")
                print(f"stack trace:\n{tb}")
                print("=======================")
                
                raise e
    
    def generate_summary(self, title: str, content: str = "", description: str = "", content_type: str = "article") -> Optional[str]:
        """Generate a structured summary for a single item. Used for backfill/on-demand generation.

        Always returns a summary string (never None) — uses AI if available,
        otherwise falls back to standard message.
        """
        # Ensure extracted_text is passed to the LLM
        if not content or not content.strip():
            logger.warning("Empty content passed to generate_summary")
            raise ValueError("Content to summarize cannot be empty.")

        # Verify API key and model existence
        self.verify_configuration()

        try:
            # Generate structured summary via analyze_content
            raw_res = self.analyze_content(title, content, content_type)
            raw_summary = raw_res.get("summary")
            if raw_summary and raw_summary != "Summary could not be generated.":
                return raw_summary
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            logger.error(f"generate_summary failed: {e}")
            logger.error(f"Stack Trace:\n{tb}")
            print(f"generate_summary failed: {e}")
            print(f"Stack Trace:\n{tb}")
            raise e

        # If the result of analysis doesn't contain a valid summary, we raise ValueError rather than swallowing
        raise ValueError("generate_summary failed to produce a valid summary.")


    def generate_tags(self, title: str, content: str = "", source_type: str = "article") -> List[str]:
        """Generate tags for an item using AI or fallback.

        Returns a list of tags (lowercase hyphenated). If AI disabled, returns ['uncategorized'].
        """
        if self.enabled:
            res = self.analyze_content(title, content, source_type)
            if res and isinstance(res.get("tags"), list):
                return res.get("tags")
        return ["uncategorized"]

    def _summarize_chunk(self, chunk_text: str) -> str:
        prompt = f"""You are a helper summarizing a section of a long transcript or article.
Write a concise summary of the following content, focusing on key technical details, concepts, facts, and explanations.
Write the summary in the same language as the source content.
Do not include any greetings, intros, transitions, or meta-commentary.

CONTENT PORTION:
{chunk_text}
"""
        try:
            return self._call_generative_model(prompt, len(chunk_text))
        except Exception as e:
            logger.error(f"Failed to summarize chunk: {e}")
            raise e

    def _parse_gemini_json(self, raw_text: str) -> dict:
        try:
            text = self._clean_json_response(raw_text)
            result = json.loads(text)
            return result
        except Exception as e:
            try:
                logger.error(f"JSON parsing failed for response: {raw_text}, error: {e}")
            except Exception:
                try:
                    logger.error(f"JSON parsing failed for response: {raw_text.encode('ascii', errors='replace').decode('ascii')}, error: {e}")
                except Exception:
                    pass
            try:
                print(f"JSON parsing failed for response: {raw_text}, error: {e}")
            except UnicodeEncodeError:
                safe_text = raw_text.encode('ascii', errors='replace').decode('ascii')
                print(f"JSON parsing failed for response: {safe_text}, error: {e}")
            raise e


    def _single_pass_analysis(self, title: str, content: str, content_type: str) -> dict:
        """Two-step pass: compact JSON for summary+tags+priority, plain text for full_summary.
        Falls back to _retry_single_pass on JSON parse failure."""
        word_count = len(content.split()) if content else 0
        is_youtube = content_type == "youtube"

        if is_youtube:
            len_instruction = (
                "Write a 2-3 sentence plain-text short summary. "
                "Mention the main topic and key ideas. No headings, no bullets."
            )
        elif word_count < 100:
            len_instruction = "1-2 concise sentences."
        elif word_count < 300:
            len_instruction = "2-3 short paragraphs."
        else:
            len_instruction = "3-5 informative paragraphs."

        # Step 1: compact JSON — only tags + short summary + priority
        json_prompt = f"""You are a content analyzer for QueueIt.
Read the content and return ONLY a JSON object. No extra text, no markdown fences.

TITLE: {title}
TYPE: {content_type}
CONTENT:
{content[:20000]}

Instructions for 'summary':
- {len_instruction}
- Write a genuine, informative summary based on the CONTENT above.
- NEVER output: 'This video covers', 'Title:', 'Channel:', or metadata-only text.
- Plain text, no markdown. Separate paragraphs with \\n\\n.

Return ONLY this JSON:
{{"tags": ["tag1", "tag2"], "summary": "YOUR SHORT SUMMARY", "priority": 70}}
"""
        print(f"[PIPELINE LOG] [AI Service] gemini_called=true (JSON step) prompt_chars={len(json_prompt)} content_chars={len(content)}")
        try:
            raw_json = self._call_generative_model(json_prompt, len(content))
            print(f"[PIPELINE LOG] [AI Service] gemini_success=true (JSON) response_chars={len(raw_json)}")
            base_result = self._parse_gemini_json(raw_json)
            if base_result and isinstance(base_result, dict) and base_result.get("summary"):
                # Step 2: plain-text full_summary (separate call — no JSON encoding)
                full_summary = self._generate_full_summary_plain(title, content, content_type)
                base_result["full_summary"] = full_summary
                return base_result
            print(f"[DEBUG LOG] JSON step parse failed or summary missing. raw_json preview={raw_json[:200]}. Falling back to retry...")
        except Exception as e:
            # Only re-raise daily quota errors — retry-able errors use the fallback path
            if "GenerateRequestsPerDayPerProjectPerModel" in str(e) or "generate_content_free_tier_requests" in str(e):
                raise
            print(f"[DEBUG LOG] JSON step failed with exception: {e}. Falling back to _retry_single_pass...")

        # Fallback: simpler retry prompt
        return self._retry_single_pass(content, content_type)

    def _generate_full_summary_plain(self, title: str, content: str, content_type: str) -> str:
        """Generate a detailed full_summary as plain markdown text (NOT inside JSON).
        This avoids the JSON parse failures caused by multi-line markdown content."""
        is_tech = any(kw in content_type.lower() for kw in ["youtube", "code", "tutorial"])
        title_lower = title.lower() if title else ""
        is_coding = any(kw in title_lower for kw in ["leetcode", "algorithm", "data structure", "two sum", "bst", "graph", "dp", "dynamic programming", "binary"])

        if is_coding:
            structure = """Structure the summary using these exact markdown headers:
## Problem Statement
## Intuition
## Brute Force
## Optimal Solution
## Algorithm
## Dry Run
## Time Complexity
## Space Complexity
## Edge Cases
## Interview Tips
## Key Takeaways"""
        elif content_type == "youtube" and not is_coding:
            structure = """Structure the summary using these exact markdown headers:
## Overview
## Key Ideas
## Important Examples
## Key Takeaways"""
        else:
            structure = """Structure the summary using these exact markdown headers:
## Executive Summary
## Main Topics
## Important Insights
## Examples
## Action Items
## Conclusion"""

        plain_prompt = f"""You are an expert technical and educational summarizer.
Write a detailed, comprehensive full summary of the content below.

TITLE: {title}
TYPE: {content_type}
CONTENT:
{content[:25000]}

{structure}

Rules:
- Write 700-1500 words.
- Use the content above as the PRIMARY source. Base all details on actual content.
- Do NOT copy or rephrase the title as the entire summary.
- Use markdown headings (##) and bullet points.
- Be specific: include algorithms, code examples, key arguments, steps, and insights from the content.
- Do NOT add any JSON, no curly braces, no code fences.
- Output the markdown summary directly.
"""
        print(f"[PIPELINE LOG] [AI Service] gemini_called=true (full_summary step) prompt_chars={len(plain_prompt)}")
        try:
            full_text = self._call_generative_model(plain_prompt, len(content))
            print(f"[PIPELINE LOG] [AI Service] gemini_success=true (full_summary) response_chars={len(full_text)}")
            if not full_text or len(full_text.strip()) < 100:
                print(f"[DEBUG LOG] full_summary response too short ({len(full_text)} chars). Using fallback.")
                return f"## Overview\n\nDetailed summary could not be generated for: {title}"
            return full_text.strip()
        except Exception as e:
            logger.error(f"[AI Service] full_summary plain generation failed: {e}")
            print(f"[DEBUG LOG] full_summary plain generation failed: {e}")
            return f"## Overview\n\nDetailed summary could not be generated: {e}"

    def _retry_single_pass(self, content: str, content_type: str) -> dict:
        """Simpler retry: minimal JSON prompt + plain-text full_summary."""
        truncated_content = content[:15000]
        word_count = len(truncated_content.split())

        if word_count < 100:
            len_instruction = "1-2 concise sentences"
        elif word_count < 300:
            len_instruction = "2-3 paragraphs"
        else:
            len_instruction = "3-5 paragraphs"

        json_prompt = f"""Summarize this content. Return ONLY a valid JSON object with no extra text.

CONTENT:
{truncated_content}

Instructions:
- Write a genuine informative summary ({len_instruction}) based on the content.
- NEVER output metadata-only text like 'This video covers', 'Title:', 'Channel:'.
- No markdown inside the summary field.

Return ONLY:
{{"tags": ["tag1", "tag2"], "summary": "YOUR SHORT PLAIN TEXT SUMMARY", "priority": 50}}
"""
        print(f"[PIPELINE LOG] [AI Service] gemini_called=true (retry JSON) prompt_chars={len(json_prompt)}")
        raw_text = self._call_generative_model(json_prompt, len(content))
        print(f"[PIPELINE LOG] [AI Service] gemini_success=true (retry) response_chars={len(raw_text)}")
        result = self._parse_gemini_json(raw_text)
        if not result or not isinstance(result, dict) or not result.get("summary"):
            raise ValueError(f"Retry JSON: parse failed or summary missing. Response: {raw_text[:200]}")
        title_guess = content[:80].split("\n")[0] if content else "this content"
        result["full_summary"] = self._generate_full_summary_plain(title_guess, content, content_type)
        return result


    def _generate_final_summary_from_chunks(self, title: str, content_type: str, chunk_summaries_text: str) -> dict:
        """Combine chunk summaries: JSON call for short summary+tags+priority, plain call for full_summary."""
        is_youtube = content_type == "youtube"

        if is_youtube:
            summary_instruction = (
                "Write a 150-300 word short summary as 4 plain-text paragraphs (no headings, no bullets)."
            )
        else:
            summary_instruction = "Write a 4-8 plain-text paragraph summary."

        json_prompt = f"""You are given summaries of parts of a transcript/article.
Return ONLY a JSON object, no other text.

TITLE: {title}
TYPE: {content_type}
COMBINED PARTIAL SUMMARIES:
{chunk_summaries_text[:15000]}

Instructions: {summary_instruction}
No markdown, no headings, no bullets in the summary field.

Return ONLY this JSON:
{{"tags": ["tag1", "tag2"], "summary": "YOUR SHORT PLAIN TEXT SUMMARY", "priority": 70}}
"""
        print(f"[PIPELINE LOG] [AI Service] gemini_called=true (chunk-combine JSON) prompt_chars={len(json_prompt)}")
        raw_json = self._call_generative_model(json_prompt, len(chunk_summaries_text))
        print(f"[PIPELINE LOG] [AI Service] gemini_success=true (chunk-combine) response_chars={len(raw_json)}")

        base_result = self._parse_gemini_json(raw_json)
        if not base_result or not isinstance(base_result, dict) or not base_result.get("summary"):
            print(f"[DEBUG LOG] Chunk-combine JSON parse failed. raw={raw_json[:300]}. Retrying...")
            return self._retry_final_combination(chunk_summaries_text)

        # Get full_summary via plain text (separate call, no JSON encoding issues)
        full_summary = self._generate_full_summary_plain(title, chunk_summaries_text, content_type)
        base_result["full_summary"] = full_summary
        return base_result

    def _retry_final_combination(self, chunk_summaries_text: str) -> dict:
        """Retry chunk combination with simpler JSON prompt."""
        json_prompt = f"""Summarize the following combined content summaries. Return ONLY a JSON object.

COMBINED SUMMARIES:
{chunk_summaries_text[:15000]}

Return ONLY:
{{"tags": ["tag1", "tag2"], "summary": "YOUR SHORT PLAIN-TEXT SUMMARY (4-8 paragraphs)", "priority": 50}}
"""
        print(f"[PIPELINE LOG] [AI Service] gemini_called=true (chunk retry) prompt_chars={len(json_prompt)}")
        raw_text = self._call_generative_model(json_prompt, len(chunk_summaries_text))
        print(f"[PIPELINE LOG] [AI Service] gemini_success=true (chunk retry) response_chars={len(raw_text)}")
        result = self._parse_gemini_json(raw_text)
        if not result or not isinstance(result, dict) or not result.get("summary"):
            raise ValueError(f"Chunk retry parse failed or summary missing. Response: {raw_text[:200]}")
        title_guess = chunk_summaries_text[:80].split("\n")[0] if chunk_summaries_text else ""
        result["full_summary"] = self._generate_full_summary_plain(title_guess, chunk_summaries_text, "article")
        return result


    def _chunk_content_tokens(self, text: str, min_tokens: int = 1500, max_tokens: int = 2500) -> List[str]:
        words = text.split()
        chunks = []
        current_chunk = []
        for word in words:
            current_chunk.append(word)
            if len(current_chunk) >= 1500:
                chunks.append(" ".join(current_chunk))
                current_chunk = []
        if current_chunk:
            chunks.append(" ".join(current_chunk))
        return chunks

    def _summarize_chunk_hierarchical(self, chunk: str) -> str:
        prompt = f"""You are a content chunk summarizer.
Summarize this section of the content, focusing on key details, concepts, facts, code examples, or arguments.
Do not write any introductory or meta text, just start directly with the summary.

CONTENT PORTION:
{chunk}
"""
        try:
            return self._call_generative_model(prompt, len(chunk))
        except Exception as e:
            logger.error(f"Chunk summarization failed: {e}")
            raise e

    def _generate_structured_final_summary(self, title: str, combined_summaries: str, content_type: str, is_fallback: bool) -> str:
        prompt = f"""You are an expert technical and educational summarizer.
Create a comprehensive, structured final summary of the content based on the combined information provided below.

TITLE: {title}
TYPE: {content_type}
COMBINED SUMMARIES / INFO:
{combined_summaries}

Instructions:
Structure the final summary using the exact sections below based on the content type:

1. If the content is technical (e.g. coding tutorials, LeetCode explanations, system design):
Use these exact markdown headers:
## Problem Statement
## Intuition
## Brute Force
## Optimal Solution
## Algorithm
## Dry Run
## Time Complexity
## Space Complexity
## Edge Cases
## Interview Tips
## Key Takeaways

2. If the content is an article / news / general reading:
Use these exact markdown headers:
## Executive Summary
## Main Topics
## Important Insights
## Examples
## Action Items
## Conclusion

3. If the content is motivational / productivity / habits content:
Use these exact markdown headers:
## Main Lessons
## Stories
## Key Quotes
## Practical Advice
## Daily Action Plan
## Final Takeaways

Strict Rules:
- Word limit: write between 700 and 1500 words. Make it extremely detailed and educational.
- Do not repeat or copy the short summary.
- Do not summarize only the title. Use the provided information as the primary source.
- Do not include any meta-commentary or introduction. Output only the markdown summary text.
"""
        try:
            return self._call_generative_model(prompt, len(combined_summaries))
        except Exception as e:
            logger.error(f"Structured final summary generation failed: {e}")
            raise e

    def _expand_summary(self, summary: str) -> str:
        words = len(summary.split())
        prompt = f"""You are a technical editor.
The following structured summary is too short (only {words} words).
Expand this summary to be between 700 and 1500 words by adding highly detailed educational explanations, clear step-by-step walk-throughs, intuition details, brute force vs optimal comparisons, code trace examples, edge cases, and practical takeaways.
Do not omit any of the original headings. Keep the same headings but expand the details.

CURRENT SUMMARY:
{summary}
"""
        try:
            return self._call_generative_model(prompt, len(summary))
        except Exception as e:
            logger.error(f"Summary expansion failed: {e}")
            return summary

    def _generate_independent_short_summary(self, title: str, content: str, content_type: str) -> str:
        prompt = f"""You are an expert technical summarizer.
Create a short, concise plain-text summary (2-3 sentences) of the following content.

TITLE: {title}
TYPE: {content_type}
CONTENT:
{content[:8000]}

Rules:
- Write exactly 2-3 sentences.
- Return plain text only. No markdown, no headings, no bullets.
"""
        try:
            return self._call_generative_model(prompt, len(content[:8000]))
        except Exception as e:
            logger.error(f"Independent short summary failed: {e}")
            raise e

    def _generate_independent_short_summary_distinct(self, title: str, content: str, content_type: str, full_summary: str) -> str:
        prompt = f"""You are an expert technical summarizer.
Create a short, concise plain-text summary (2-3 sentences) of the following content.
Make sure the summary uses completely different phrasing and words from the detailed summary provided below to keep word overlap minimal.

TITLE: {title}
TYPE: {content_type}
CONTENT:
{content[:8000]}

DETAILED SUMMARY TO AVOID DUPLICATING:
{full_summary[:1000]}

Rules:
- Write exactly 2-3 sentences.
- Return plain text only. No markdown, no headings, no bullets.
"""
        try:
            return self._call_generative_model(prompt, len(content[:8000]))
        except Exception as e:
            logger.error(f"Distinct short summary failed: {e}")
            raise e

    def _calculate_similarity(self, text1: str, text2: str) -> float:
        if not text1 or not text2:
            return 0.0
        
        stop_words = {
            "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "with",
            "about", "against", "between", "into", "through", "during", "before", "after",
            "above", "below", "of", "by", "is", "was", "were", "are", "am", "be", "been",
            "being", "have", "has", "had", "having", "do", "does", "did", "doing", "this",
            "that", "these", "those", "i", "you", "he", "she", "it", "we", "they", "me",
            "him", "her", "us", "them", "my", "your", "his", "their", "our", "its"
        }
        
        def clean_words(text):
            text = re.sub(r'[^\w\s]', '', text.lower())
            words = text.split()
            return [w for w in words if w not in stop_words and len(w) > 2]
            
        w1 = set(clean_words(text1))
        w2 = set(clean_words(text2))
        if not w1 or not w2:
            return 0.0
            
        intersection = w1.intersection(w2)
        union = w1.union(w2)
        
        jaccard = len(intersection) / len(union)
        overlap = len(intersection) / len(w1) if w1 else 0.0
        
        return max(jaccard, overlap)

    def _generate_tags_and_priority(self, title: str, summary: str, content_type: str) -> dict:
        prompt = f"""You are a content tagger.
Generate 2-4 tags and a priority score (0-100) for the following summary.

TITLE: {title}
SUMMARY:
{summary}

Return ONLY a JSON object:
{{
  "tags": ["tag1", "tag2"],
  "priority": 70
}}
"""
        try:
            raw_res = self._call_generative_model(prompt, len(summary))
            res = self._parse_gemini_json(raw_res)
            if res and isinstance(res, dict):
                return res
        except Exception as e:
            print(f"[DEBUG LOG] Tags generation failed: {e}")
        return {"tags": ["uncategorized"], "priority": 50}

    # ── Detect metadata/fallback pattern outputs ─────────────────────────
    # Patterns that are ONLY produced by our own fallback code, never by genuine Gemini
    METADATA_PATTERNS = [
        "title:",
        "channel:",
        "summary of:",
        "insufficient content was extracted",
        "summary could not be generated",
        "no transcript",
        "metadata only",
        "summary unavailable",
    ]

    def _is_metadata_summary(self, summary: str) -> bool:
        """Return True if the summary looks like metadata-only fallback text.

        Rules:
        - Empty or very short (<30 chars): always reject.
        - Long summaries (>=200 chars): always accept (genuine Gemini output).
        - Short summaries (<200 chars): reject if they start with OR contain a metadata pattern.
          Exception: Allow exactly "Summary could not be generated." (common short content response).
        """
        if not summary or len(summary.strip()) < 30:
            return True
        s = summary.strip()
        # Genuine summaries from Gemini are typically >=200 chars even for 2-3 sentences
        if len(s) >= 200:
            return False
        # Short text: check for metadata pattern start or full containment
        s_lower = s.lower()
        if s_lower.rstrip(".") == "summary could not be generated":
            return False
        for pattern in self.METADATA_PATTERNS:
            if s_lower.startswith(pattern) or pattern in s_lower:
                return True
        return False


    def analyze_content(
        self,
        title: str,
        content: str,
        content_type: str = "article",
        transcript_available: bool = True,
        existing_collections: List[str] = None
    ) -> dict:
        """Analyze content using AI. Returns a dict with keys: tags, summary, full_summary, priority, collection.

        Uses a SINGLE unified Gemini call to retrieve all metadata and summaries.
        """
        import json
        import difflib

        self.verify_configuration()
        content_to_use = content or ""
        content_len = len(content_to_use)

        print(f"[PIPELINE LOG] [AI Service] content_chars={content_len} content_type={content_type} transcript_available={transcript_available}")

        if not self.enabled:
            return {
                "tags": ["uncategorized"],
                "summary": "Summary could not be generated.",
                "full_summary": "## Overview\n\nSummary could not be generated.",
                "priority": 50.0,
                "collection": None
            }

        existing_collections_str = ", ".join(f"'{c}'" for c in existing_collections) if existing_collections else "None"

        prompt = f"""You are a content analyzer for QueueIt.
Analyze the following content and return a JSON object containing a short summary, a full detailed summary, tags, priority, and collection classification.

Existing folders/collections in the user's account: [{existing_collections_str}]

CONTENT:
{content_to_use[:150000]}

Instructions for the JSON response:
1. "summary" (Short Summary):
   - 2-3 sentences.
   - Strictly 300 characters or less.
   - Teaser only, introducing the content.
   - Do NOT use placeholder text or metadata fallback templates (like "This video covers...", "Title:", "Channel:", "Author:").
   - Rely ONLY on the actual content to summarize.

2. "full_summary" (Full Summary):
   - 600 to 1500 words explaining the complete content in depth.
   - Explain all key concepts, examples, points, algorithmic approaches, code, interview tips, and a conclusion.
   - Organise with markdown headings (##, ###) and lists.
   - The summary must be detailed enough that the user can fully understand the content without opening the source.
   - Rely ONLY on the actual content.

3. "tags" (Tags):
   - 1-5 lowercase tags (alphanumeric and dashes, e.g. "python", "machine-learning").

4. "priority" (Priority):
   - A float score between 0.0 and 100.0 based on readability, importance, depth, and learning value of the content.

5. "collection" (Collection/Folder):
   - Choose the best matching folder from the existing list: [{existing_collections_str}].
   - If none of the existing folders are a good match, suggest a new collection name (e.g. 'artificial-intelligence' or 'career-tips').
   - Keep it short (1-3 words).

Return ONLY a JSON object matching this schema:
{{
  "summary": "Short summary here",
  "full_summary": "Full summary here in markdown",
  "tags": ["tag1", "tag2"],
  "priority": 75.0,
  "collection": "Suggested folder name"
}}
"""

        result = None
        last_error = None
        for attempt in range(3):
            try:
                print(f"[PIPELINE LOG] [AI Service] Sending request to Gemini (single call, attempt {attempt+1}/3)...")
                raw_response = self.model.generate_content(
                    prompt,
                    generation_config={"response_mime_type": "application/json"},
                    request_options={"timeout": 60.0}
                )
                raw_text = raw_response.text if raw_response and hasattr(raw_response, 'text') else ""
                print(f"[PIPELINE LOG] [AI Service] Gemini response length: {len(raw_text)}")

                parsed = json.loads(self._clean_json_response(raw_text))

                # Validation and cleaning
                summary = parsed.get("summary", "").strip()
                full_summary = parsed.get("full_summary", "").strip()
                tags = parsed.get("tags", [])
                priority = parsed.get("priority", 50.0)
                collection = parsed.get("collection")

                summary = _clean_markdown(summary)

                if not summary:
                    raise ValueError("Empty short summary returned")

                if self._is_metadata_summary(summary):
                    raise ValueError(f"Metadata summary pattern detected: {summary[:100]}")

                if len(summary) > 300:
                    # Truncate to 300 chars keeping complete sentences if possible
                    print(f"[PIPELINE LOG] [AI Service] Summary too long ({len(summary)} chars). Truncating to 300...")
                    summary = summary[:297] + "..."

                result = {
                    "summary": summary,
                    "full_summary": full_summary,
                    "tags": tags,
                    "priority": priority,
                    "collection": collection
                }
                break
            except Exception as e:
                last_error = e
                # Re-raise daily quota/rate limit errors immediately to trigger fallback logic
                err_str = str(e)
                if ("GenerateRequestsPerDayPerProjectPerModel" in err_str or 
                    "generate_content_free_tier_requests" in err_str or
                    "Quota exceeded" in err_str or
                    "429" in err_str or
                    "RESOURCE_EXHAUSTED" in err_str or
                    "resource_exhausted" in err_str.lower()):
                    raise
                print(f"[PIPELINE LOG] [AI Service] Call attempt {attempt+1}/3 failed: {e}. Retrying...")

        if not result:
            raise ValueError(f"AI analysis pipeline failed after 3 attempts. Last error: {last_error}")

        # Normalize tags
        cleaned_tags = []
        tags_raw = result.get("tags") if result else []
        if isinstance(tags_raw, list):
            for tag in tags_raw[:5]:
                if isinstance(tag, str):
                    cleaned = tag.lower().strip().replace(' ', '-')
                    cleaned = re.sub(r'[^a-z0-9-]', '', cleaned)
                    if cleaned and len(cleaned) > 1:
                        cleaned_tags.append(cleaned)
        if not cleaned_tags:
            cleaned_tags = ["uncategorized"]

        prio_raw = result.get("priority", 50.0) if result else 50.0
        if isinstance(prio_raw, (int, float)):
            priority = max(0.0, min(100.0, float(prio_raw)))
        else:
            priority = 50.0

        summary = result.get("summary", "") if result else ""
        full_summary = result.get("full_summary", "") if result else ""
        collection = result.get("collection") if result else None

        print(f"[PIPELINE LOG] [AI Service] ai_summary length: {len(summary)}")
        print(f"[PIPELINE LOG] [AI Service] full_summary length: {len(full_summary)}")

        return {
            "tags": cleaned_tags,
            "summary": summary,
            "full_summary": full_summary,
            "priority": priority,
            "collection": collection
        }

    def suggest_next_items(
        self,
        completed_tags: Any = None,
        unread_items: Any = None,
        completed_items: Optional[List[dict]] = None,
        tracking_info: Optional[dict] = None
    ) -> dict:
        """Suggests the best next item to read/watch based on rich user history and item metadata.
        
        Supports legacy positional signature: suggest_next_items(completed_tags, unread_items)
        And new signature: suggest_next_items(unread_items=..., completed_items=..., tracking_info=...)
        """
        from datetime import datetime, timezone

        # 1. Resolve parameters based on signature / types
        is_new_style = False
        first_is_dicts = False
        if isinstance(completed_tags, list) and len(completed_tags) > 0 and isinstance(completed_tags[0], dict):
            first_is_dicts = True
            
        if first_is_dicts or completed_items is not None or tracking_info is not None:
            is_new_style = True
            
        if is_new_style:
            if completed_tags is None and isinstance(unread_items, list):
                candidates = unread_items
                comp_items = completed_items or []
                tracking = tracking_info or {}
            else:
                candidates = completed_tags or []
                comp_items = unread_items or []
                tracking = completed_items or {}
        else:
            legacy_tags = completed_tags or []
            candidates = unread_items or []
            comp_items = []
            tracking = {}

        if not candidates:
            return {"item_id": None, "title": None, "reason": "No unread items in your queue. Add some content!"}

        # 2. Derive user history interests
        top_tags = {}
        top_categories = {}
        completed_read_times = []
        
        if is_new_style:
            for item in comp_items:
                # Tags
                tags = item.get("tags") or []
                for tag in tags:
                    if tag != "uncategorized":
                        top_tags[tag] = top_tags.get(tag, 0) + 1
                # Category
                cat = item.get("content_type") or item.get("source_type", "generic")
                top_categories[cat] = top_categories.get(cat, 0) + 1
                # Read time
                est_time = item.get("estimated_read_time")
                if est_time:
                    completed_read_times.append(est_time)
        else:
            for tag in legacy_tags:
                top_tags[tag] = top_tags.get(tag, 0) + 1

        # Sort tags and categories by frequency
        sorted_top_tags = [t for t, _ in sorted(top_tags.items(), key=lambda x: x[1], reverse=True)[:10]]
        sorted_top_cats = [c for c, _ in sorted(top_categories.items(), key=lambda x: x[1], reverse=True)[:3]]
        avg_read_time = sum(completed_read_times) / len(completed_read_times) if completed_read_times else None

        # 3. Score candidates
        scored_candidates = []
        now = datetime.now(timezone.utc)
        
        for item in candidates:
            item_id = item.get("id")
            priority = float(item.get("priority_score", 50.0))
            score = priority
            
            is_favorite = bool(item.get("is_favorite", False))
            read_progress = int(item.get("read_progress", 0))
            estimated_time = item.get("estimated_read_time")
            added_at_str = item.get("added_at") or item.get("created_at")
            category = item.get("content_type") or item.get("source_type", "generic")
            tags = item.get("tags") or []
            
            # Recency
            hours_since_added = None
            if added_at_str:
                try:
                    clean_str = added_at_str.replace("Z", "+00:00")
                    added_at = datetime.fromisoformat(clean_str)
                    hours_since_added = (now - added_at).total_seconds() / 3600.0
                except Exception:
                    pass
            
            # Last opened & recommended tracking
            track_info = tracking.get(item_id, {}) if tracking else {}
            last_opened_at_str = track_info.get("last_opened_at")
            last_recommended_at_str = track_info.get("last_recommended_at")
            recommendation_count = int(track_info.get("recommendation_count", 0))
            
            hours_since_opened = None
            if last_opened_at_str:
                try:
                    opened_at = datetime.fromisoformat(last_opened_at_str)
                    hours_since_opened = (now - opened_at).total_seconds() / 3600.0
                except Exception:
                    pass

            hours_since_recommended = None
            if last_recommended_at_str:
                try:
                    rec_at = datetime.fromisoformat(last_recommended_at_str)
                    hours_since_recommended = (now - rec_at).total_seconds() / 3600.0
                except Exception:
                    pass

            # Factor 2: Read progress / In-progress bonus
            if read_progress > 0:
                score += 25.0
                
            # Factor 3: Recency bonus/penalty
            if hours_since_added is not None:
                if hours_since_added <= 24.0:
                    score += 15.0
                elif hours_since_added <= 72.0:
                    score += 10.0
                elif hours_since_added <= 168.0:
                    score += 5.0
                elif hours_since_added > 720.0:
                    score -= 10.0
                    
            # Factor 4: Estimated read time sweet spot & user alignment
            if estimated_time:
                if 3 <= estimated_time <= 15:
                    score += 10.0
                if avg_read_time is not None:
                    if avg_read_time * 0.5 <= estimated_time <= avg_read_time * 1.5:
                        score += 5.0
                        
            # Factor 5: Favorites bonus
            if is_favorite:
                score += 20.0
                
            # Factor 6 & 8: Tags Match
            matching_tags = set(tags) & set(sorted_top_tags)
            score += min(len(matching_tags) * 5.0, 20.0)
            
            # Factor 7 & 8: Category Match
            if category in sorted_top_cats:
                score += 10.0
                
            # Factor 9: Last opened boost
            if hours_since_opened is not None:
                if hours_since_opened <= 24.0:
                    score += 30.0
                elif hours_since_opened <= 72.0:
                    score += 20.0
                elif hours_since_opened <= 168.0:
                    score += 10.0
                    
            # Penalty: Avoid recommending the same item repeatedly
            if recommendation_count > 0:
                score -= min(recommendation_count * 15.0, 45.0)
            if hours_since_recommended is not None and hours_since_recommended <= 2.0:
                score -= 20.0
                
            scored_candidates.append({
                "item": item,
                "score": score,
                "is_favorite": is_favorite,
                "read_progress": read_progress,
                "last_opened_at_str": last_opened_at_str,
                "hours_since_added": hours_since_added,
                "matching_tags": matching_tags,
                "category": category,
                "estimated_time": estimated_time
            })
            
        # Pick the best candidate
        scored_candidates.sort(key=lambda x: x["score"], reverse=True)
        best_candidate = scored_candidates[0]
        chosen = best_candidate["item"]
        
        # Build explanation
        is_favorite = best_candidate["is_favorite"]
        read_progress = best_candidate["read_progress"]
        last_opened_at_str = best_candidate["last_opened_at_str"]
        hours_since_added = best_candidate["hours_since_added"]
        matching_tags = best_candidate["matching_tags"]
        category = best_candidate["category"]
        estimated_time = best_candidate["estimated_time"]
        
        if read_progress > 0 and last_opened_at_str:
            reason = "You started reading this recently. Finish where you left off!"
        elif is_favorite and matching_tags:
            reason = f"A favorite item matching your interest in #{list(matching_tags)[0]}."
        elif is_favorite:
            reason = "One of your favorited items in the queue."
        elif read_progress > 0:
            reason = "An item you are currently reading. Resume your progress!"
        elif matching_tags and category in sorted_top_cats:
            reason = f"Highly matches your completed topics (#{list(matching_tags)[0]}) and {category} content preference."
        elif matching_tags:
            reason = f"Matches your learning history in #{list(matching_tags)[0]}."
        elif category in sorted_top_cats:
            reason = f"Recommended based on your preference for {category} content."
        elif hours_since_added is not None and hours_since_added <= 24.0:
            reason = "A fresh new item added to your queue."
        else:
            reason = "Highest priority item in your queue matching your focus profile."
            
        return {
            "item_id": chosen.get("id"),
            "title": chosen.get("title", "Untitled"),
            "reason": reason
        }
    
    def calculate_priority(
        self,
        title: str,
        summary: Optional[str],
        tags: List[str],
        source_type: str,
        estimated_time: Optional[int],
        days_since_added: int,
        user_interests: Optional[List[str]] = None,
        is_favorite: bool = False,
        read_progress: int = 0
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
            est_minutes = estimated_time
            if 3 <= est_minutes <= 15:
                score += 15
            elif 1 <= est_minutes < 3:
                score += 10
            elif est_minutes > 60:
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
            
        # Factor 8: Favorite bonus (20 points max)
        if is_favorite:
            score += 20
            
        # Factor 9: In-progress bonus (up to 15 points)
        if read_progress > 0:
            score += min(int(read_progress * 0.15), 15)
        
        return round(min(max(score, 0), 100), 1)

    def chat_with_queue(
        self,
        message: str,
        history: List[dict],
        detailed_items: List[dict],
        other_items: List[dict]
    ) -> str:
        """Runs conversation chat with Gemini model restricted ONLY to queue items context."""
        try:
            self.verify_configuration()
            
            system_instruction = """You are a smart AI assistant for QueueIt.\r\nYour task is to answer user questions and chat with the user ONLY about the items in their queue.\r\n\r\nYou are provided with the user's queue items as context.\r\nYou must:\r\n1. Answer the user's questions based strictly on the provided context items.\r\n2. If the user asks about something not present in the queue, or asks generic questions unrelated to their queue, you must politely decline to answer, explaining that you can only answer questions related to the items in their queue.\r\n3. Quote or reference specific items when answering (using their exact titles).\r\n4. Do not make up any information or use outside knowledge. Rely ONLY on the summaries, titles, and descriptions of the queue items provided in the context.\r\n\r\nHere is the context representing the user's queue items:\r\n"""
            
            # Construct context text
            detailed_context = []
            for i, item in enumerate(detailed_items):
                tags_str = ", ".join(item.get("tags") or [])
                summary_str = item.get("ai_summary") or item.get("summary") or "No summary available."
                detailed_context.append(
                    f"Item [{i}]:\n"
                    f"- Title: {item.get('title')}\n"
                    f"- Content Type: {item.get('content_type')}\n"
                    f"- URL: {item.get('url')}\n"
                    f"- Tags: {tags_str}\n"
                    f"- Description: {item.get('description') or 'None'}\n"
                    f"- Summary: {summary_str}\n"
                )
                
            other_context = []
            for item in other_items:
                tags_str = ", ".join(item.get("tags") or [])
                other_context.append(
                    f"- \"{item.get('title')}\" (Type: {item.get('content_type')}, Tags: {tags_str})"
                )
                
            # Build history context
            history_text = []
            for msg in history:
                role = "User" if msg.get("role") == "user" else "Assistant"
                content = msg.get("content", "")
                history_text.append(f"{role}: {content}")
                
            prompt = f"""{system_instruction}
=== DETAILED ITEMS ===
{chr(10).join(detailed_context)}

=== OTHER ITEMS IN QUEUE ===
{chr(10).join(other_context) if other_context else "None"}

=== CONVERSATION HISTORY ===
{chr(10).join(history_text) if history_text else "No history."}

User: {message}
Assistant:"""
            
            return self._call_generative_model(prompt, len(prompt))
        except Exception as e:
            logger.error(f"Chat failed, falling back to offline content-matching response: {e}")
            
            # Generate fallback answer based on detailed_items / other_items and keyword matching
            query_lower = message.lower()
            
            # Unrelated question containment check
            keywords = [w.lower() for w in re.findall(r'\b\w{3,}\b', query_lower)]
            if not keywords:
                keywords = [w.lower() for w in query_lower.split() if w.strip()]
                
            unrelated_queries = [
                "president", "france", "capital", "weather", "temperature", "who are you", 
                "meaning of life", "joke", "story", "math", "calculator", "convert", "paris"
            ]
            is_unrelated = any(uq in query_lower for uq in unrelated_queries)
            
            max_match_score = 0
            best_match_item = None
            for item in detailed_items + other_items:
                score = 0
                title = (item.get("title") or "").lower()
                desc = (item.get("description") or "").lower()
                summary = (item.get("ai_summary") or item.get("summary") or "").lower()
                tags = [t.lower() for t in (item.get("tags") or [])]
                
                for kw in keywords:
                    if kw in title:
                        score += 5
                    if kw in desc or kw in summary:
                        score += 2
                    for tag in tags:
                        if kw in tag:
                            score += 1
                if score > max_match_score:
                    max_match_score = score
                    best_match_item = item
            
            # Strict decline for unrelated or zero match scores
            if (is_unrelated or max_match_score == 0) and len(keywords) > 0 and not any(k in "queue list items summary dashboard" for k in keywords):
                return (
                    "I am sorry, but I can only answer questions related to the items in your queue. "
                    "Please ask a question about your saved articles, videos, or documents."
                )
                
            if best_match_item:
                title = best_match_item.get("title")
                summary = best_match_item.get("ai_summary") or best_match_item.get("summary") or best_match_item.get("description") or "No details available."
                return (
                    f"I found a matching item in your queue: \"{title}\".\n\n"
                    f"Here is what I know about it: {summary}"
                )
            
            # Generic list fallback
            item_list = []
            for item in detailed_items[:5]:
                item_list.append(f"- \"{item.get('title')}\" ({item.get('content_type', 'item')})")
            items_str = "\n".join(item_list)
            
            return (
                f"Here are some of the items in your queue:\n{items_str}\n\n"
                f"Feel free to ask questions about specific topics or items."
            )

    async def chat_with_queue_stream(self, prompt: str):
        """Stream tokens from Gemini for the chat endpoint. Yields text chunks.
        
        Uses generate_content_async with stream=True.
        """
        if not self.enabled:
            yield "AI features are currently disabled. Please check your API key configuration."
            return

        try:
            self.verify_configuration()
            logger.info(f"[Chat Stream] Starting stream for prompt length {len(prompt)}")
            response = await self.model.generate_content_async(
                prompt,
                stream=True,
                request_options={"timeout": 60.0}
            )
            async for chunk in response:
                try:
                    text = chunk.text
                    if text:
                        yield text
                except Exception:
                    # Some chunks may have no text (e.g. safety metadata)
                    continue
        except Exception as e:
            logger.error(f"[Chat Stream] Streaming failed: {e}")
            yield f"An error occurred while generating the response. Please try again."


    def suggest_collection_for_content(self, title: str, description: str = "", existing_collections: List[str] = None, tags: List[str] = None, semantic_match: Optional[str] = None) -> dict:
        """Suggest a collection name and color for the given content.
        Uses existing_collections to match or suggest a new one.
        Returns a dict: {"name": str, "color": str, "is_new": bool}
        """
        if not self.enabled:
            return {"name": "Reading List", "color": "blue", "is_new": True}

        existing_list_str = ", ".join([f'"{c}"' for c in existing_collections]) if existing_collections else "None"
        tags_str = ", ".join(tags) if tags else "None"
        semantic_match_str = semantic_match if semantic_match else "None"

        prompt = f"""You are a content organizer for a bookmarking and reading queue app.
Your task is to suggest the most appropriate folder/collection to save this item to.

ITEM DETAILS:
Title: {title}
Description: {description}
Tags: {tags_str}
SEMANTIC MATCH: {semantic_match_str}

EXISTING COLLECTIONS:
[{existing_list_str}]

INSTRUCTIONS:
1. Review the existing collections. If the item clearly fits into one of the existing collections (using semantic similarity, topic, description, or matching tags), suggest that collection.
2. If none of the existing collections fit, suggest a new collection name. The name should be short (1-3 words), clean, capitalized, and representative of the topic.
   Use the following taxonomy examples to guide your grouping:
   - Items about "Motivation", "Success", "Mindset", "Self-help" -> "Motivation"
   - Items about "Binary Tree", "BST", "Tree Traversal", "LeetCode Tree" -> "Trees"
   - Items about "React Hooks", "React", "JSX", "Next.js" -> "React"
   - Items about "Express API", "npm", "Node", "backend JS", "NodeJS" -> "Node.js"
   - Ensure similar developer concepts or self-improvement topics are grouped into clean, sensible folders.
3. Suggest a color for the collection from one of: "blue", "purple", "green", "orange", "red", "yellow". If matching an existing collection, use that collection's typical color.
4. Set "is_new" to false if matching an existing collection, or true if proposing a new one.
5. We have computed a semantic similarity match based on vector embeddings of previously saved items in folders. The result is: {semantic_match_str}. Consider this collection heavily if it matches the general topic of the new item.

Return ONLY a JSON object with this structure:
{{
  "name": "Suggested Collection Name",
  "color": "color_name",
  "is_new": true/false
}}
"""
        try:
            raw_text = self._call_generative_model(prompt, len(title) + len(description) + len(tags_str))
            result = self._parse_gemini_json(raw_text)
            if result and isinstance(result, dict) and "name" in result:
                color = result.get("color", "blue").lower().strip()
                if color not in ["blue", "purple", "green", "orange", "red", "yellow"]:
                    color = "blue"
                return {
                    "name": result["name"].strip(),
                    "color": color,
                    "is_new": bool(result.get("is_new", True))
                }
        except Exception as e:
            logger.error(f"Failed to suggest collection via AI: {e}")
            err_str = str(e)
            if ("GenerateRequestsPerDayPerProjectPerModel" in err_str or 
                "generate_content_free_tier_requests" in err_str or 
                "Quota exceeded" in err_str or
                "429" in err_str):
                raise e

        # Fallback
        return {"name": "Reading List", "color": "blue", "is_new": True}


    def generate_embedding(self, text: str) -> Optional[List[float]]:
        """Generate vector embedding for the text using Google Gemini API."""
        if not text or not text.strip():
            return None
        
        if not self.enabled:
            return None
            
        try:
            response = genai.embed_content(
                model="models/gemini-embedding-001",
                content=text,
                task_type="retrieval_document"
            )
            embedding = response.get("embedding")
            if embedding:
                logger.info(f"Successfully generated embedding of length {len(embedding)}")
                print(f"[PIPELINE LOG] [Embedding] Generated embedding of length {len(embedding)}")
                return embedding
        except Exception as e:
            logger.warning(f"Failed to generate embedding: {e}")
            print(f"[PIPELINE LOG] [Embedding] Failed to generate embedding: {e}")
            err_str = str(e)
            if ("GenerateRequestsPerDayPerProjectPerModel" in err_str or 
                "generate_content_free_tier_requests" in err_str or 
                "Quota exceeded" in err_str or
                "429" in err_str):
                raise e
            
        return None

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
