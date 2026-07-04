"""
Vector service for QueueIt - Handles item and query embedding generation,
SQLite storage, cosine similarity search, and hybrid ranking.
"""

import os
import sqlite3
import json
import hashlib
import logging
import math
import asyncio
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

from config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
from services.ai_service import get_ai_service
from utils.schema_fallback import DB_PATH, fallback_db

logger = logging.getLogger(__name__)

# Simple in-memory LRU cache for query embeddings to ensure search is < 300ms
class QueryEmbeddingCache:
    def __init__(self, maxsize: int = 100):
        self.cache: Dict[str, List[float]] = {}
        self.keys_order: List[str] = []
        self.maxsize = maxsize

    def get(self, query: str) -> Optional[List[float]]:
        query_clean = query.strip().lower()
        if query_clean in self.cache:
            self.keys_order.remove(query_clean)
            self.keys_order.append(query_clean)
            return self.cache[query_clean]
        return None

    def set(self, query: str, embedding: List[float]):
        query_clean = query.strip().lower()
        if query_clean in self.cache:
            self.keys_order.remove(query_clean)
        self.cache[query_clean] = embedding
        self.keys_order.append(query_clean)
        
        if len(self.keys_order) > self.maxsize:
            oldest_key = self.keys_order.pop(0)
            self.cache.pop(oldest_key, None)

_query_cache = QueryEmbeddingCache()


def get_query_embedding(query: str) -> Optional[List[float]]:
    """Get embedding for search query, using in-memory cache if available."""
    cached = _query_cache.get(query)
    if cached:
        logger.info(f"Query embedding cache hit for query: {query!r}")
        return cached

    logger.info(f"Query embedding cache miss for query: {query!r}. Calling AI API.")
    ai = get_ai_service()
    embedding = ai.generate_embedding(query)
    if embedding:
        _query_cache.set(query, embedding)
    return embedding


def calculate_text_hash(title: str, summary: str, tags: List[str]) -> str:
    """Compute SHA-256 hash of the text representation to detect modifications."""
    tags_str = ",".join(sorted(tags)) if tags else ""
    text_content = f"T:{title or ''}|S:{summary or ''}|Tags:{tags_str}"
    return hashlib.sha256(text_content.encode("utf-8")).hexdigest()


def get_item_embedding_text(title: str, summary: str, tags: List[str]) -> str:
    """Compile a structured text block for the embedding model."""
    parts = []
    if title:
        parts.append(f"Title: {title}")
    if summary:
        parts.append(f"Summary: {summary}")
    if tags:
        parts.append(f"Tags: {', '.join(tags)}")
    return "\n".join(parts)


def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    """Calculate the cosine similarity between two vectors."""
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0
    dot_product = sum(a * b for a, b in zip(v1, v2))
    norm_a = math.sqrt(sum(a * a for a in v1))
    norm_b = math.sqrt(sum(b * b for b in v2))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot_product / (norm_a * norm_b)


# ---------- SQLite Storage Operations ----------

# Simple in-memory cache for user embeddings to optimize search response times <300ms
_user_embeddings_cache: Dict[str, Dict[str, List[float]]] = {}


def save_embedding(item_id: str, user_id: str, embedding: List[float], text_hash: str):
    """Save or update the item embedding and hash in the SQLite database."""
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        now_str = datetime.now(timezone.utc).isoformat()
        embedding_str = json.dumps(embedding)
        cursor.execute("""
            INSERT INTO local_item_embeddings (item_id, user_id, embedding, text_hash, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(item_id) DO UPDATE SET
                embedding = excluded.embedding,
                text_hash = excluded.text_hash,
                updated_at = excluded.updated_at
        """, (item_id, user_id, embedding_str, text_hash, now_str))
        conn.commit()
        # Invalidate the user cache on new/update index
        _user_embeddings_cache.pop(user_id, None)
        logger.info(f"Saved embedding for item {item_id} to local DB.")
    except Exception as e:
        logger.error(f"Failed to save embedding in SQLite for item {item_id}: {e}", exc_info=True)
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
    finally:
        if conn:
            conn.close()


def delete_embedding(item_id: str):
    """Delete item embedding from local DB."""
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM local_item_embeddings WHERE item_id = ?", (item_id,))
        conn.commit()
        # Invalidate the user cache on deletion
        _user_embeddings_cache.clear()
        logger.info(f"Deleted local embedding for item {item_id}.")
    except Exception as e:
        logger.error(f"Failed to delete local embedding for item {item_id}: {e}", exc_info=True)
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
    finally:
        if conn:
            conn.close()


def get_all_embeddings_for_user(user_id: str) -> Dict[str, List[float]]:
    """Retrieve all cached item embeddings for a specific user, using in-memory cache if available."""
    if user_id in _user_embeddings_cache:
        logger.info(f"User embeddings cache hit for user: {user_id}")
        return _user_embeddings_cache[user_id]

    logger.info(f"User embeddings cache miss for user: {user_id}. Querying SQLite.")
    embeddings = {}
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT item_id, embedding FROM local_item_embeddings WHERE user_id = ?", (user_id,))
        rows = cursor.fetchall()
        for row in rows:
            try:
                embeddings[row["item_id"]] = json.loads(row["embedding"])
            except Exception as parse_err:
                logger.error(f"Failed to parse embedding JSON for item {row['item_id']}: {parse_err}")
        # Store in in-memory cache
        _user_embeddings_cache[user_id] = embeddings
    except Exception as e:
        logger.error(f"Failed to fetch embeddings for user {user_id}: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()
    return embeddings


def get_stored_hash(item_id: str) -> Optional[str]:
    """Retrieve the text hash for a cached item embedding."""
    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT text_hash FROM local_item_embeddings WHERE item_id = ?", (item_id,))
        row = cursor.fetchone()
        return row[0] if row else None
    except Exception as e:
        logger.error(f"Failed to fetch text hash for item {item_id}: {e}", exc_info=True)
        return None
    finally:
        if conn:
            conn.close()


# ---------- Indexing Tasks ----------

def index_item_by_id(item_id: str, user_id: str):
    """Fetch item details, check if embedding is outdated, and re-generate embedding if needed."""
    try:
        from api.items import supabase
        logger.info(f"Vector Service: Indexing request received for item {item_id}")
        
        # 1. Fetch item from remote database
        res = supabase.table("items").select("*").eq("id", item_id).execute()
        if not res.data:
            logger.warning(f"Item {item_id} not found in DB. Skipping indexing.")
            return
            
        item = res.data[0]
        # Merge local SQLite metadata if needed
        item = fallback_db.merge_single_item_metadata(user_id, item)
        
        # 2. Extract texts
        title = item.get("title") or ""
        tags = item.get("tags") or []
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
            
        summary = item.get("ai_summary") or item.get("summary") or ""
        
        # Skip generating embedding if AI summary is still processing
        status = item.get("processing_status") or "completed"
        if status == "processing" or summary == "Generating AI summary..." or not summary.strip():
            logger.info(f"Item {item_id} is still generating its AI summary. Indexing deferred.")
            return
            
        # 3. Hash match check
        current_hash = calculate_text_hash(title, summary, tags)
        stored_hash = get_stored_hash(item_id)
        if current_hash == stored_hash:
            logger.info(f"Item {item_id} embedding hash matches stored hash. Skipping embedding regeneration.")
            return
            
        # 4. Generate embedding
        text_to_embed = get_item_embedding_text(title, summary, tags)
        if not text_to_embed.strip():
            logger.info(f"Item {item_id} has empty indexable text. Skipping.")
            return
            
        ai = get_ai_service()
        embedding = ai.generate_embedding(text_to_embed)
        if embedding:
            save_embedding(item_id, user_id, embedding, current_hash)
            logger.info(f"Item {item_id} successfully indexed.")
        else:
            logger.warning(f"Failed to generate embedding for item {item_id}.")
    except Exception as e:
        logger.error(f"Error in index_item_by_id for item {item_id}: {e}", exc_info=True)


async def backfill_all_embeddings():
    """Background startup task to scan database and index missing/outdated items."""
    logger.info("Starting background vector embedding backfill scan...")
    # Delay indexing task slightly to let startup finish and avoid blocking initial requests
    await asyncio.sleep(8)
    
    try:
        from api.items import supabase
        res = await asyncio.to_thread(lambda: supabase.table("items").select("id, user_id").execute())
        items = res.data or []
        logger.info(f"Backfill: Scanning {len(items)} items for vector indexing...")
        
        for index, item in enumerate(items):
            item_id = item.get("id")
            user_id = item.get("user_id")
            if not item_id or not user_id:
                continue
                
            # Perform hash check in thread
            needs_indexing = False
            try:
                item_details = await asyncio.to_thread(
                    lambda: supabase.table("items").select("title, tags, ai_summary").eq("id", item_id).execute()
                )
                if item_details.data:
                    merged = fallback_db.merge_single_item_metadata(user_id, item_details.data[0])
                    title = merged.get("title") or ""
                    tags = merged.get("tags") or []
                    if isinstance(tags, str):
                        tags = [t.strip() for t in tags.split(",") if t.strip()]
                    summary = merged.get("ai_summary") or merged.get("summary") or ""
                    status = merged.get("processing_status") or "completed"
                    
                    if status != "processing" and summary != "Generating AI summary..." and summary.strip():
                        current_hash = calculate_text_hash(title, summary, tags)
                        stored_hash = get_stored_hash(item_id)
                        if current_hash != stored_hash:
                            needs_indexing = True
            except Exception as check_err:
                logger.error(f"Backfill: Error checking status of item {item_id}: {check_err}")
                
            if needs_indexing:
                logger.info(f"Backfill [{index+1}/{len(items)}]: Indexing item {item_id}")
                await asyncio.to_thread(index_item_by_id, item_id, user_id)
                # Respect API limits by introducing a brief pause
                await asyncio.sleep(2.0)
                
        logger.info("Background vector embedding backfill scan completed successfully.")
    except Exception as e:
        logger.error(f"Error during background backfill scan: {e}", exc_info=True)


# ---------- Search / Ranking Scorer ----------

import re

def perform_hybrid_search(user_id: str, query: str, candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Perform hybrid search (semantic similarity + keyword + tags matching) over candidate items."""
    if not candidates:
        return []
        
    logger.info(f"Running hybrid search for query: {query!r} over {len(candidates)} candidates.")
    
    # 1. Fetch query embedding
    query_emb = get_query_embedding(query)
    
    # 2. Get user embeddings from SQLite
    user_embs = get_all_embeddings_for_user(user_id)
    
    # Extract query tokens for keyword & tag matching
    query_tokens = [t.lower() for t in re.findall(r'\b\w{2,}\b', query.lower())]
    
    scored_items = []
    for item in candidates:
        item_id = item.get("id")
        
        # A. Semantic Cosine Similarity
        cosine_sim = 0.0
        if query_emb:
            if item_id in user_embs:
                item_emb = user_embs[item_id]
                cosine_sim = cosine_similarity(query_emb, item_emb)
                cosine_sim = max(0.0, cosine_sim)  # Clamp negative similarities
            else:
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(asyncio.to_thread(index_item_by_id, item_id, user_id))
                except RuntimeError:
                    import threading
                    threading.Thread(target=index_item_by_id, args=(item_id, user_id), daemon=True).start()
        
        # B. Keyword overlap scoring
        keyword_score = 0.0
        collection_name = (item.get("collection_name") or "").lower()
        if query_tokens:
            title = (item.get("title") or "").lower()
            description = (item.get("description") or "").lower()
            summary = (item.get("ai_summary") or item.get("summary") or "").lower()
            content = (item.get("extracted_text") or "").lower()
            
            matches = 0
            for token in query_tokens:
                if token in title:
                    matches += 3.0
                if token in description:
                    matches += 1.0
                if token in summary:
                    matches += 1.5
                if token in collection_name:
                    matches += 2.0
                if token in content:
                    matches += 1.0
            # Normalise keyword score to max of 1.0
            keyword_score = min(1.0, matches / (len(query_tokens) * 3.0) if len(query_tokens) > 0 else 0.0)
            
        # C. Tag match scoring
        tag_score = 0.0
        tags = item.get("tags") or []
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]
        if query_tokens and tags:
            tag_matches = 0
            for tag in tags:
                tag_lower = tag.lower()
                for token in query_tokens:
                    if token == tag_lower or token in tag_lower:
                        tag_matches += 1.0
            tag_score = min(1.0, tag_matches / len(query_tokens))
            
        # D. Combined Score calculation
        # Weights: 70% Semantic, 20% Keyword, 10% Tags
        relevance_score = (0.7 * cosine_sim) + (0.2 * keyword_score) + (0.1 * tag_score)
        
        item_copy = dict(item)
        item_copy["relevance_score"] = round(relevance_score, 4)
        
        # Strict matching check to filter out unrelated results
        query_lower = query.lower().strip()
        tags_lower = [t.lower() for t in tags]
        
        in_title = query_lower in (item.get("title") or "").lower()
        in_description = query_lower in (item.get("description") or "").lower()
        in_summary = query_lower in (item.get("ai_summary") or item.get("summary") or "").lower()
        in_collection = query_lower in collection_name
        in_tags = any(query_lower in t for t in tags_lower)
        in_content = query_lower in (item.get("extracted_text") or "").lower()
        
        token_match = False
        if query_tokens:
            for token in query_tokens:
                if (token in (item.get("title") or "").lower() or
                    token in (item.get("description") or "").lower() or
                    token in (item.get("ai_summary") or item.get("summary") or "").lower() or
                    token in collection_name or
                    token in (item.get("extracted_text") or "").lower() or
                    any(token in t for t in tags_lower)):
                    token_match = True
                    break
                    
        # A result matches if it contains the query/tokens in title, summary, tags, collection_name, or content, OR has strong semantic similarity
        is_matched = in_title or in_description or in_summary or in_collection or in_tags or in_content or token_match or (cosine_sim >= 0.45)
        
        is_relevant = is_matched and ((cosine_sim >= 0.38) or (keyword_score >= 0.15) or (tag_score >= 0.3) or (relevance_score >= 0.25))
        if is_relevant:
            scored_items.append((relevance_score, item_copy))
            
    # Sort items by relevance score descending
    scored_items.sort(key=lambda x: x[0], reverse=True)
    
    logger.info(f"Hybrid search matched {len(scored_items)} out of {len(candidates)} items.")
    return [x[1] for x in scored_items]
