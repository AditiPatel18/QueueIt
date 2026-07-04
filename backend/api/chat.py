"""AI Chat API Router — SSE-streaming endpoint for chatting with the AI about queue items.

Optimizations vs original:
- Parallel: Supabase item fetch and query-embedding generation run concurrently via asyncio.gather.
- Embedding cache: query embeddings are LRU-cached in vector_service.QueryEmbeddingCache (no re-embed).
- Top-8 context: only the 8 highest-relevance items are sent to the LLM prompt.
- Streaming: response is delivered as Server-Sent Events so the frontend renders tokens in real-time.
"""

import re
import json
import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from typing import List, Optional, Generator, AsyncGenerator

from schemas.chat import ChatRequest, ChatResponse
from schemas.item import ItemResponse
from services.ai_service import get_ai_service
from services.vector_service import get_query_embedding, perform_hybrid_search
from api.items import supabase, get_user_id, item_to_response
from utils.schema_fallback import fallback_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

# ── Constants ──────────────────────────────────────────────────────────────────
TOP_K_CONTEXT = 8          # Max items sent to the LLM
BROAD_KEYWORDS = {
    "all", "every", "entire", "everything", "each", "whole",
    "summarize queue", "my queue", "entire queue", "everything saved",
    "all items", "all videos", "all articles", "all youtube", "entire library",
}
IGNORE_WORDS = {
    "what", "have", "saved", "about", "tell", "show", "list", "summarize",
    "queue", "my", "in", "the", "and", "or", "of", "to", "a", "an", "is",
    "are", "about", "all", "every", "entire", "everything", "each", "whole",
    "items", "videos", "articles", "youtube", "video", "saved",
}


# ── Helpers ────────────────────────────────────────────────────────────────────

def extract_cited_sources(response_text: str, items: List[dict]) -> List[dict]:
    """Find and return user items whose titles are referenced in the AI response."""
    cited = []
    response_lower = response_text.lower()
    for item in items:
        title = item.get("title")
        if not title or len(title.strip()) < 3:
            continue
        title_lower = title.lower().strip()
        if len(title_lower) < 5:
            pattern = r'\b' + re.escape(title_lower) + r'\b'
            if re.search(pattern, response_lower):
                cited.append(item)
        else:
            if title_lower in response_lower:
                cited.append(item)
    return cited


def generate_offline_fallback(items: List[dict], query: str) -> str:
    """Generate a structured offline response when Gemini is unavailable."""
    query_lower = query.lower()
    unrelated_queries = [
        "president", "france", "capital", "weather", "temperature", "who are you",
        "meaning of life", "joke", "story", "math", "calculator", "convert", "paris",
    ]
    is_unrelated = any(uq in query_lower for uq in unrelated_queries)
    if is_unrelated and len(items) > 0:
        return (
            "I am sorry, but I can only answer questions related to the items in your queue. "
            "Please ask a question about your saved articles, videos, or documents."
        )
    if not items:
        return "I couldn't find any matching items in your queue."

    categories: dict = {}
    for item in items:
        ctype = (item.get("content_type") or "other").lower()
        cat_name = (
            "YouTube Videos" if ctype == "youtube"
            else "Articles" if ctype == "article"
            else ctype.capitalize()
        )
        categories.setdefault(cat_name, []).append(item)

    num_items = len(items)
    num_categories = len(categories)
    stats_line = (
        "📊 1 matching item found"
        if num_items == 1
        else f"📊 Analyzed {num_items} items • {num_categories} categories"
    )

    if num_items == 1:
        item = items[0]
        overview_text = (
            f"We found one matching item in your queue: \"{item.get('title')}\". "
            f"It covers details on {item.get('tags')[0] if item.get('tags') else 'topics'}."
        )
    else:
        overview_text = (
            f"Your queue contains a diverse set of {num_items} resources covering topics "
            f"such as {', '.join(list(categories.keys()))}. Here is a structured summary of their contents."
        )

    parts = [stats_line, "", "# 📚 Overview", overview_text, ""]

    for cat_name, cat_items in categories.items():
        parts.append(f"## 🧠 {cat_name}")
        for item in cat_items:
            title = item.get("title")
            summary = item.get("ai_summary") or item.get("summary") or item.get("description") or "No details available."
            first_sent = summary.split(".")[0].strip()
            parts.append(f"• In \"{title}\", you learn: {first_sent}.")
        if cat_items:
            best_item = cat_items[0]
            parts.append(f"💡 Focusing on \"{best_item.get('title')}\" will help you grasp the core themes of this category.")
        parts.append("")

    parts.append("## 🎯 Key Takeaways")
    if num_items >= 2:
        takeaway1 = f"You have saved high-quality guides like \"{items[0].get('title')}\"."
        takeaway2 = f"Your collection spans multiple formats, including {', '.join(list(categories.keys()))}."
    else:
        takeaway1 = f"The queue contains \"{items[0].get('title')}\", which is a useful resource for study."
        takeaway2 = "Regularly reviewing saved materials helps retain the core concepts."

    parts.append(f"✅ {takeaway1}")
    parts.append(f"✅ {takeaway2}")
    parts.append("")
    parts.append("## 📈 Learning Path")
    for idx, item in enumerate(items[:3]):
        parts.append(f"{idx+1}. Study \"{item.get('title')}\" to build foundation.")
    parts.append("")
    parts.append("## 🔥 Next Recommendation")
    sorted_items = sorted(items, key=lambda x: x.get("priority_score", 50.0), reverse=True)
    rec_item = sorted_items[0]
    rec_title = rec_item.get("title")
    rec_reason = f"It has the highest priority score ({rec_item.get('priority_score')}) in your matching list."
    parts.append(f"\"{rec_title}\" - Recommended because: {rec_reason}")
    return "\n".join(parts)


def get_system_formatting_instructions(num_items: int, num_categories: int) -> str:
    stats_line = (
        "1 matching item found"
        if num_items == 1
        else f"Analyzed {num_items} items • {num_categories} categories"
    )
    return f"""Your response must follow this EXACT markdown format strictly. Do not deviate.
Use emojis, spacing, bullet points, and checkmarks as shown.

📊 {stats_line}

# 📚 Overview
[Provide a rewritten high-level overview summarizing the items. NEVER dump raw text, summaries, or descriptions directly. Rewrite them concisely.]

## 🧠 [Category Name (e.g. YouTube Videos, Software Development, Cooking, etc.)]
• [Key point about these items, starting with title in quotes, e.g. In "Title", you learn: ...]
• [Key point]
💡 [A smart, actionable insight summarizing this category]

[Add more category sections if there are multiple categories/types of items]

## 🎯 Key Takeaways
✅ [Key actionable takeaway 1]
✅ [Key actionable takeaway 2]

## 📈 Learning Path
1. [First item or topic to study/read, with title in quotes]
2. [Second item or topic, with title in quotes]
3. [Third item or topic, with title in quotes]

## 🔥 Next Recommendation
"[Title of the recommended item]" - [Explain why this specific item is the best next step for the user, based on priority or relevance]
"""


def build_chat_prompt(
    message: str,
    matching_items: List[dict],
    history_str: str,
    num_categories: int,
) -> str:
    """Build the full LLM prompt from top items, history, and formatting instructions."""
    formatting_instructions = get_system_formatting_instructions(len(matching_items), num_categories)

    if len(matching_items) == 1:
        item = matching_items[0]
        tags_str = ", ".join(item.get("tags") or [])
        summary_str = item.get("ai_summary") or item.get("summary") or "No summary available."
        return (
            f"You are a smart AI assistant for QueueIt.\n"
            f"Answer user questions ONLY about items in their queue.\n\n"
            f"Title: {item.get('title')}\n"
            f"Content Type: {item.get('content_type')}\n"
            f"URL: {item.get('url')}\n"
            f"Tags: {tags_str}\n"
            f"Description: {item.get('description') or 'None'}\n"
            f"Summary: {summary_str}\n"
            f"Notes: {item.get('notes') or 'None'}\n\n"
            f"Conversation History:\n{history_str}\n\n"
            f"User Query: {message}\n\n"
            f"Please answer the user query based strictly on this item.\n"
            f"{formatting_instructions}\n"
            f"Assistant:"
        )
    else:
        details = []
        for idx, item in enumerate(matching_items):
            tags_str = ", ".join(item.get("tags") or [])
            summary_str = item.get("ai_summary") or item.get("summary") or "No summary available."
            details.append(
                f"Item [{idx}]:\n"
                f"- Title: {item.get('title')}\n"
                f"- Content Type: {item.get('content_type')}\n"
                f"- Tags: {tags_str}\n"
                f"- Description: {item.get('description') or 'None'}\n"
                f"- Summary: {summary_str}\n"
            )
        compiled_context = "\n".join(details)
        return (
            f"You are a smart AI assistant for QueueIt.\n"
            f"Answer user questions ONLY about items in their queue.\n\n"
            f"=== MATCHING ITEMS (top {len(matching_items)}) ===\n"
            f"{compiled_context}\n"
            f"Conversation History:\n{history_str}\n\n"
            f"User Query: {message}\n\n"
            f"Please answer based on these items.\n"
            f"{formatting_instructions}\n"
            f"Assistant:"
        )


def score_items_by_query(
    items: List[dict],
    keywords: List[str],
    message_lower: str,
    tracking_info: dict,
) -> List[dict]:
    """Keyword + tracking score for item relevance. Returns items sorted desc by score."""
    scored: List[tuple] = []
    for item in items:
        score = 0
        title = (item.get("title") or "").lower()
        desc = (item.get("description") or "").lower()
        summary = (item.get("ai_summary") or "").lower()
        tags = [t.lower() for t in (item.get("tags") or [])]
        notes = (item.get("notes") or "").lower()

        if title and title in message_lower:
            score += 100

        for kw in keywords:
            if kw in title:
                score += 10
            for tag in tags:
                if kw in tag:
                    score += 5
            if kw in desc or (summary and kw in summary) or (notes and kw in notes):
                score += 2

        item_id = item.get("id")
        if item_id in tracking_info:
            t_info = tracking_info[item_id]
            if t_info.get("last_opened_at"):
                score += 3
            if t_info.get("recommendation_count", 0) > 0:
                score += 1

        if score > 0:
            scored.append((score, item))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [x[1] for x in scored]


# ── Async helpers ──────────────────────────────────────────────────────────────

async def _fetch_items(user_id: str) -> List[dict]:
    """Fetch all user queue items from Supabase in a thread with optimized columns."""
    select_cols = fallback_db.get_optimized_select_string()
    res = await asyncio.to_thread(
        lambda: supabase.table("items").select(select_cols).eq("user_id", user_id).execute()
    )
    return res.data or []


async def _get_query_emb(query: str):
    """Get cached query embedding in a thread (non-blocking)."""
    return await asyncio.to_thread(get_query_embedding, query)


# ── SSE generator ──────────────────────────────────────────────────────────────

async def _sse_stream(
    ai,
    prompt: str,
    sources_json: str,
) -> AsyncGenerator[str, None]:
    """
    Yield SSE events.
    Format:
      data: {"type":"token","text":"..."}\n\n
      data: {"type":"sources","data":[...]}\n\n
      data: {"type":"done"}\n\n
    """
    accumulated = []
    try:
        async for chunk in ai.chat_with_queue_stream(prompt):
            accumulated.append(chunk)
            payload = json.dumps({"type": "token", "text": chunk}, ensure_ascii=False)
            yield f"data: {payload}\n\n"
    except Exception as e:
        logger.error(f"[SSE] Stream error: {e}")
        err_payload = json.dumps({"type": "error", "text": str(e)})
        yield f"data: {err_payload}\n\n"
        return

    # After all tokens: send sources
    yield f"data: {json.dumps({'type': 'sources', 'data': json.loads(sources_json)})}\n\n"
    yield f"data: {json.dumps({'type': 'done'})}\n\n"


# ── Endpoint ───────────────────────────────────────────────────────────────────

@router.post("")
async def chat_with_queue_endpoint(
    req: ChatRequest,
    user_id: str = Depends(get_user_id),
):
    """
    Chat with AI about queue items.

    Returns a Server-Sent Events stream:
      data: {"type":"token","text":"<chunk>"}
      data: {"type":"sources","data":[<ItemResponse>, ...]}
      data: {"type":"done"}
    """
    try:
        message_lower = req.message.lower()
        keywords = [
            w.lower()
            for w in re.findall(r'\b\w{3,}\b', message_lower)
            if w.lower() not in IGNORE_WORDS
        ]

        # ── 1. Parallel: fetch items + query embedding ────────────────────────
        items_task = _fetch_items(user_id)
        emb_task = _get_query_emb(req.message)
        items_raw, _query_emb = await asyncio.gather(items_task, emb_task)

        # ── 2. Merge local metadata ───────────────────────────────────────────
        items = fallback_db.merge_items_metadata(user_id, items_raw)
        tracking_info = fallback_db.get_item_tracking(user_id)

        # ── 3. Determine matching items ───────────────────────────────────────
        is_broad = any(w in message_lower for w in BROAD_KEYWORDS)

        target_type: Optional[str] = None
        if any(w in message_lower for w in ["youtube", "video", "videos"]):
            target_type = "youtube"
        elif any(w in message_lower for w in ["article", "articles", "read", "reads", "page", "pages"]):
            target_type = "article"

        if is_broad:
            matching_items = (
                [item for item in items if item.get("content_type") == target_type]
                if target_type
                else items
            )
        else:
            keyword_scored = score_items_by_query(items, keywords, message_lower, tracking_info)
            if keyword_scored:
                # Exact title match → single item
                top_score = next(
                    (s for s, i in
                     sorted([(sum(10 for kw in keywords if kw in (i.get("title") or "").lower()), i) for i in keyword_scored], reverse=True)[:1]
                     ), 0
                ) if keyword_scored else 0

                first_title = (keyword_scored[0].get("title") or "").lower()
                if first_title and first_title in message_lower:
                    matching_items = [keyword_scored[0]]
                else:
                    matching_items = keyword_scored
            else:
                matching_items = items  # conversational fallback

        # ── 4. Semantic re-rank and truncate to TOP_K_CONTEXT ─────────────────
        if _query_emb and matching_items:
            # Use existing hybrid scorer for semantic re-ranking
            semantic_results = await asyncio.to_thread(
                perform_hybrid_search, user_id, req.message, matching_items
            )
            if semantic_results:
                matching_items = semantic_results
        # Clamp to top-8
        matching_items = matching_items[:TOP_K_CONTEXT]

        # ── 5. Build history string ───────────────────────────────────────────
        history_dicts = [{"role": msg.role, "content": msg.content} for msg in req.history]
        history_str = "\n".join(
            f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
            for m in history_dicts
        ) or "No history."

        # ── 6. Count categories ───────────────────────────────────────────────
        categories_set = set()
        for item in matching_items:
            ctype = (item.get("content_type") or "other").lower()
            cat_name = (
                "YouTube Videos" if ctype == "youtube"
                else "Articles" if ctype == "article"
                else ctype.capitalize()
            )
            categories_set.add(cat_name)
        num_categories = len(categories_set)

        # ── 7. Handle empty match ─────────────────────────────────────────────
        ai = get_ai_service()
        if not matching_items:
            fallback_text = "I couldn't find any items in your queue matching your request."
            sources_json = json.dumps([])

            def _empty_stream():
                yield f"data: {json.dumps({'type': 'token', 'text': fallback_text})}\n\n"
                yield f"data: {json.dumps({'type': 'sources', 'data': []})}\n\n"
                yield f"data: {json.dumps({'type': 'done'})}\n\n"

            return StreamingResponse(_empty_stream(), media_type="text/event-stream")

        # ── 8. Build prompt ───────────────────────────────────────────────────
        prompt = build_chat_prompt(req.message, matching_items, history_str, num_categories)

        # ── 9. Pre-compute cited sources for SSE sources frame ────────────────
        # We stream tokens first; we compute potential sources from matching_items
        # and send them after all tokens are delivered.
        cited_items = matching_items  # conservative: all context items as sources
        cited_responses = [item_to_response(item) for item in cited_items]
        sources_json = json.dumps([r.dict() if hasattr(r, "dict") else r for r in cited_responses], default=str)

        # ── 10. Return SSE streaming response ────────────────────────────────
        return StreamingResponse(
            _sse_stream(ai, prompt, sources_json),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    except Exception as e:
        logger.error(f"Error in chat_with_queue_endpoint: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Chat execution failed: {str(e)}",
        )
