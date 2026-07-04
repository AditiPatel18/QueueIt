# Tasks - Handle Gemini Quota Exhaustion & 'ai_pending' Status

- [x] Detect Gemini daily quota limits in `items.py` and set `processing_status` to `"ai_pending"`
- [x] Skip retries early in `items.py` when daily quota exhaustion is detected
- [x] Update final Supabase write and `update_ingestion_debug` call to save/log the `"ai_pending"` status
- [x] Guard AI-specific summary checks in `test_real_ingestion.py` to only run if status is `"completed"`
- [x] Update `test_real_ingestion.py` placeholder checks to ignore placeholder check on `ai_pending` items
- [x] Fix YouTube transcript segment subscripting and duration calculation for `FetchedTranscriptSnippet` dataclasses in `youtube_extractor.py`
- [x] Bubble up daily quota exhaustion exceptions from `suggest_collection_for_content` and `generate_embedding` in `ai_service.py` to set `quota_exhausted` properly in `items.py`
- [x] Clear stale YouTube cache entries and update TUF LeetCode URL to active Coding Decoded video `Kl3Jq38R1Xo`
- [x] Run `test_real_ingestion.py` and verify all tests pass (or handle quota exhaustion gracefully with ai_pending status)
