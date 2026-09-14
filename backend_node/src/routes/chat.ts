import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { fallbackDb } from '../utils/schemaFallback';

const router = Router();

const BROAD_KEYWORDS = new Set([
  'all', 'every', 'entire', 'everything', 'each', 'whole',
  'summarize queue', 'my queue', 'entire queue', 'everything saved',
  'all items', 'all videos', 'all articles', 'all youtube', 'entire library',
  'recommend', 'recommendation', 'stats', 'progress', 'status', 'queue'
]);

const IGNORE_WORDS = new Set([
  'what', 'have', 'saved', 'about', 'tell', 'show', 'list', 'summarize',
  'queue', 'my', 'in', 'the', 'and', 'or', 'of', 'to', 'a', 'an', 'is',
  'are', 'all', 'every', 'entire', 'everything', 'each', 'whole',
  'items', 'videos', 'articles', 'youtube', 'video', 'saved', 'can', 'you'
]);

/** Extract relevant keywords from query string */
function extractKeywords(query: string): string[] {
  const words = query.toLowerCase().match(/\b\w{3,}\b/g) || [];
  return words.filter(w => !IGNORE_WORDS.has(w));
}

/** Score queue items for relevance against query */
function scoreItems(items: any[], keywords: string[], queryLower: string): any[] {
  return items.map(item => {
    let score = 0;
    const title = (item.title || '').toLowerCase();
    const desc = (item.description || '').toLowerCase();
    const summary = (item.ai_summary || item.summary || '').toLowerCase();
    const tags = Array.isArray(item.tags) ? item.tags.map((t: string) => t.toLowerCase()) : [];
    const notes = (item.notes || '').toLowerCase();
    const contentType = (item.content_type || '').toLowerCase();

    // Exact title match gets huge boost
    if (title && title.includes(queryLower)) {
      score += 100;
    }

    keywords.forEach(kw => {
      if (title.includes(kw)) score += 15;
      if (tags.some((t: string) => t.includes(kw))) score += 8;
      if (contentType.includes(kw)) score += 10;
      if (desc.includes(kw) || summary.includes(kw) || notes.includes(kw)) score += 3;
    });

    if (item.priority_score) {
      score += (item.priority_score / 20.0);
    }

    return { item, score };
  })
  .filter(x => x.score > 0)
  .sort((a, b) => b.score - a.score)
  .map(x => x.item);
}

/** Generate Gemini prompt with context */
function buildChatPrompt(
  query: string,
  matchingItems: any[],
  historyStr: string,
  userStats: { total: number; completed: number; reading: number; unread: number; categories: string[] }
): string {
  const statsLine = `Queue Stats: ${userStats.total} items total (${userStats.completed} completed, ${userStats.reading} in progress, ${userStats.unread} unread). Categories: ${userStats.categories.join(', ') || 'General'}.`;

  const itemDetails = matchingItems.map((item, idx) => {
    const tags = Array.isArray(item.tags) ? item.tags.join(', ') : '';
    const summary = (item.ai_summary || item.description || 'No summary available.').substring(0, 400);
    return `[Item ${idx + 1}] Title: "${item.title}" | Type: ${item.content_type || 'article'} | Status: ${item.status || 'unread'} | Priority: ${item.priority_score || 50}
Tags: ${tags || 'None'}
Summary: ${summary}`;
  }).join('\n\n');

  return `You are QueueIt's dedicated, intelligent AI Assistant.
Your sole purpose is to help the user understand, summarize, organize, and navigate their saved QueueIt reading list and library.

${statsLine}

=== RELEVANT USER QUEUE ITEMS (Top ${matchingItems.length}) ===
${itemDetails || 'No matching items found in the user queue.'}

=== CONVERSATION HISTORY ===
${historyStr || 'No previous conversation.'}

=== USER QUERY ===
${query}

=== INSTRUCTIONS & RULES ===
1. Answer the user's question directly, clearly, and insightfully based on their saved queue items and queue statistics.
2. ALWAYS reference specific item titles in quotes (e.g., In "Title", ...) when discussing content.
3. If the user asks about generic unrelated topics (e.g. weather, general math, jokes, trivia, country capitals), politely decline by stating:
   "I am designed specifically to assist with your QueueIt library and saved content. Please ask me about your saved articles, YouTube videos, topics, reading progress, or recommendations!"
4. Provide structured, readable output using Markdown (bolding, lists, code blocks, or bullet points).
5. Highlight actionable takeaways and next recommended reads based on priority scores.`;
}

/** Call Gemini API with streaming & model fallback */
async function generateGeminiChatStream(
  prompt: string,
  apiKey: string,
  onChunk: (text: string) => void
): Promise<boolean> {
  const models = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash'];

  for (const model of models) {
    try {
      const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;
      const res = await fetch(streamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 2500,
            temperature: 0.3
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[ChatAPI] Model ${model} returned HTTP ${res.status}: ${errText.substring(0, 150)}`);
        continue;
      }

      const reader = res.body?.getReader();
      if (!reader) continue;

      const decoder = new TextDecoder();
      let buffer = '';
      let receivedAny = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim();
            if (raw && raw !== '[DONE]') {
              try {
                const parsed = JSON.parse(raw);
                const textChunk = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (textChunk) {
                  receivedAny = true;
                  onChunk(textChunk);
                }
              } catch {
                // Ignore SSE line parse errors
              }
            }
          }
        }
      }

      if (receivedAny) {
        return true;
      }
    } catch (err: any) {
      console.warn(`[ChatAPI] Exception with model ${model}:`, err?.message || err);
    }
  }

  // Non-streaming fallback if SSE streaming endpoints failed
  for (const model of models) {
    try {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 2500, temperature: 0.3 }
        })
      });

      if (res.ok) {
        const data: any = await res.json();
        const fullText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (fullText) {
          onChunk(fullText);
          return true;
        }
      }
    } catch (err: any) {
      console.warn(`[ChatAPI] Fallback generateContent exception with ${model}:`, err?.message || err);
    }
  }

  return false;
}

/**
 * POST /api/chat
 * Streams AI chat responses about user's QueueIt library using Gemini.
 */
router.post('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ detail: 'Unauthorized' });
  }

  const { message, history = [] } = req.body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ detail: 'Message string is required' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[ChatAPI Error] GEMINI_API_KEY environment variable is not configured.');
    return res.status(500).json({ detail: 'AI Chat is currently unavailable due to missing API key configuration.' });
  }

  // Setup SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendSSE = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // 1. Fetch user items from Supabase
    const { data: rawItems, error: dbErr } = await supabase
      .from('items')
      .select('*')
      .eq('user_id', userId);

    if (dbErr) {
      console.error('[ChatAPI Error] Supabase items fetch failed:', dbErr);
    }

    const items = await fallbackDb.mergeItemsMetadata(userId, rawItems || []);

    // Handle empty user queue
    if (!items || items.length === 0) {
      const emptyMsg = `Your QueueIt library is currently empty! Save some articles or YouTube videos using the browser extension or Dashboard, and I'll help you summarize, organize, and answer questions about them.`;
      sendSSE({ type: 'token', text: emptyMsg });
      sendSSE({ type: 'sources', data: [] });
      sendSSE({ type: 'done' });
      return res.end();
    }

    // 2. Compute Queue Stats
    const total = items.length;
    const completed = items.filter((i: any) => i.status === 'completed').length;
    const reading = items.filter((i: any) => i.status === 'reading').length;
    const unread = items.filter((i: any) => i.status === 'unread' || !i.status).length;
    const categoriesSet = new Set<string>();
    items.forEach((i: any) => {
      const type = (i.content_type || 'article').toLowerCase();
      if (type === 'youtube') categoriesSet.add('YouTube Videos');
      else if (type === 'article') categoriesSet.add('Articles');
      else categoriesSet.add(type.charAt(0).toUpperCase() + type.slice(1));
    });

    const userStats = {
      total,
      completed,
      reading,
      unread,
      categories: Array.from(categoriesSet)
    };

    // 3. Score & Select Relevant Items (max 8)
    const queryLower = message.toLowerCase().trim();
    const keywords = extractKeywords(queryLower);
    const isBroadQuery = Array.from(BROAD_KEYWORDS).some(kw => queryLower.includes(kw));

    let matchingItems: any[] = [];
    if (isBroadQuery) {
      matchingItems = [...items].sort((a: any, b: any) => (b.priority_score || 0) - (a.priority_score || 0));
    } else {
      matchingItems = scoreItems(items, keywords, queryLower);
      if (matchingItems.length === 0) {
        // Fallback: top priority items if keywords didn't match directly
        matchingItems = [...items].sort((a: any, b: any) => (b.priority_score || 0) - (a.priority_score || 0));
      }
    }

    const topMatching = matchingItems.slice(0, 8);

    // 4. Format Conversation History (max 10 recent messages)
    const recentHistory = Array.isArray(history) ? history.slice(-10) : [];
    const historyStr = recentHistory.map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');

    // 5. Build LLM Prompt
    const prompt = buildChatPrompt(message, topMatching, historyStr, userStats);

    // 6. Execute Gemini Stream
    const success = await generateGeminiChatStream(prompt, apiKey, (tokenChunk) => {
      sendSSE({ type: 'token', text: tokenChunk });
    });

    if (!success) {
      console.warn('[ChatAPI] All Gemini models failed or rate-limited. Sending clean fallback error.');
      const fallbackErr = `The AI service is currently rate-limited or experiencing high traffic. Please try again in a few moments.`;
      sendSSE({ type: 'error', text: fallbackErr });
      return res.end();
    }

    // 7. Send Sources Frame & Done Event
    const sourcesData = topMatching.map((i: any) => ({
      id: i.id,
      title: i.title,
      url: i.url,
      content_type: i.content_type,
      priority_score: i.priority_score,
      estimated_read_time: i.estimated_read_time,
      status: i.status
    }));

    sendSSE({ type: 'sources', data: sourcesData });
    sendSSE({ type: 'done' });
    res.end();
  } catch (err: any) {
    console.error('[ChatAPI Error] Unexpected exception in chat route:', err?.stack || err);
    sendSSE({ type: 'error', text: 'An unexpected server error occurred while processing your chat request.' });
    res.end();
  }
});

export default router;
