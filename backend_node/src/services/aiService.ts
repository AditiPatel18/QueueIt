import dotenv from 'dotenv';
import path from 'path';
import { supabase } from '../config/supabase';
import { fallbackDb } from '../utils/schemaFallback';
import { resolvePlatformInfo } from '../utils/urlHelper';
import { YouTubeExtractor } from './youtubeExtractor';

dotenv.config();

/** Helper function to extract YouTube metadata, duration, and transcript using YouTubeExtractor */
async function fetchYouTubeContent(url: string): Promise<{ transcript: string; title?: string; durationSeconds?: number }> {
  const result = await YouTubeExtractor.extractYouTubeContent(url);
  return {
    transcript: result.transcript || '',
    title: result.title,
    durationSeconds: result.durationSeconds,
  };
}

/** Helper function to fetch web article content when transcript is missing for non-YouTube URLs */
async function fetchWebArticleContent(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return '';

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text') && !contentType.includes('html') && !contentType.includes('json') && !contentType.includes('xml')) {
      return '';
    }

    const html = await res.text();
    if (!html) return '';

    let cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ');

    cleaned = cleaned
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned;
  } catch (err: any) {
    console.warn(`[AIService] Web article fetch error for ${url}:`, err?.message || err);
    return '';
  }
}

/** Translate non-English transcript text to clear English using Gemini API */
async function translateToEnglishIfNeeded(text: string): Promise<string> {
  if (!text || !text.trim()) return text;

  // Detect non-English scripts (Devanagari, Chinese, Cyrillic, Arabic, Tamil, Telugu, etc.)
  const isNonEnglish = /[\u0900-\u097F\u4E00-\u9FFF\u0600-\u06FF\u0400-\u04FF\u0B80-\u0BFF\u0C00-\u0C7F]/.test(text);
  if (!isNonEnglish) {
    return text;
  }

  console.log(`[AIService] Non-English transcript detected (${text.length} chars). Translating to English...`);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return text;

  const prompt = `Translate the following entire transcript/content into clear, natural, accurate English.
Preserve all technical terms, code snippet names, algorithms, software names, and core concepts across all sections.
Return ONLY the final translated English text without any explanations, meta-comments, or preambles.

Text:
${text.substring(0, 10000)}`;

  const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-flash-latest'];
  for (const model of models) {
    try {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 2000,
            temperature: 0.2,
          },
        }),
      });

      if (res.ok) {
        const data: any = await res.json();
        const translated = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (translated && translated.trim().length > 30) {
          console.log(`[AIService] Successfully translated transcript to English (${translated.trim().length} chars).`);
          return translated.trim();
        }
      }
    } catch (e) {
      console.warn(`[AIService] Translation error with model ${model}:`, e);
    }
  }

  return text;
}

/** Deterministic content preparation / chunking strategy before sending to Gemini */
export function prepareContentForSummarization(rawText: string, maxChars: number = 12000): string {
  if (!rawText || !rawText.trim()) return '';
  const cleaned = rawText.trim();
  if (cleaned.length <= maxChars) {
    return cleaned;
  }

  // Preserve Beginning (35% of maxChars ~ 4200 chars)
  const headBudget = Math.floor(maxChars * 0.35);
  let head = cleaned.substring(0, headBudget);
  const lastHeadPara = head.lastIndexOf('\n');
  if (lastHeadPara > headBudget * 0.6) {
    head = head.substring(0, lastHeadPara);
  } else {
    const lastHeadPeriod = head.lastIndexOf('. ');
    if (lastHeadPeriod > headBudget * 0.6) {
      head = head.substring(0, lastHeadPeriod + 1);
    }
  }

  // Preserve Ending / Conclusion (25% of maxChars ~ 3000 chars)
  const tailBudget = Math.floor(maxChars * 0.25);
  let tail = cleaned.substring(cleaned.length - tailBudget);
  const firstTailPara = tail.indexOf('\n');
  if (firstTailPara !== -1 && firstTailPara < tailBudget * 0.4) {
    tail = tail.substring(firstTailPara + 1);
  } else {
    const firstTailPeriod = tail.indexOf('. ');
    if (firstTailPeriod !== -1 && firstTailPeriod < tailBudget * 0.4) {
      tail = tail.substring(firstTailPeriod + 2);
    }
  }

  // Middle portion between Head and Tail
  const middleStart = head.length;
  const middleEnd = cleaned.length - tail.length;
  const middleText = cleaned.substring(middleStart, middleEnd).trim();

  if (!middleText) {
    return `${head.trim()}\n\n[... content truncated ...]\n\n${tail.trim()}`;
  }

  const paragraphs = middleText.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 30);
  if (paragraphs.length === 0) {
    return `${head.trim()}\n\n[... content truncated ...]\n\n${tail.trim()}`;
  }

  const scoreBlock = (block: string) => {
    const words = block.split(/\s+/).filter(Boolean);
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    const techOrCapital = words.filter(w => /^[A-Z0-9]/.test(w) || w.length > 7).length;
    return uniqueWords.size + (techOrCapital * 2);
  };

  const scoredBlocks = paragraphs.map((block, idx) => ({
    block,
    idx,
    score: scoreBlock(block),
  }));

  scoredBlocks.sort((a, b) => b.score - a.score);

  const middleBudget = maxChars - head.length - tail.length - 100;
  const selectedBlocks: { block: string; idx: number }[] = [];
  let currentMiddleLen = 0;

  for (const item of scoredBlocks) {
    if (currentMiddleLen + item.block.length + 4 <= middleBudget) {
      selectedBlocks.push(item);
      currentMiddleLen += item.block.length + 4;
    }
  }

  selectedBlocks.sort((a, b) => a.idx - b.idx);
  const middlePrepared = selectedBlocks.map(b => b.block).join('\n\n');

  return `${head.trim()}\n\n[... key section ...]\n\n${middlePrepared}\n\n[... conclusion ...]\n\n${tail.trim()}`;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/** Quality control validator for generated summaries */
export function validateSummary(summary: string, sourceContent: string): ValidationResult {
  if (!summary || !summary.trim()) {
    return { valid: false, reason: 'Summary is empty or whitespace only.' };
  }

  const cleaned = summary.trim();
  const summaryWords = cleaned.split(/\s+/).filter(Boolean).length;
  const summaryChars = cleaned.length;
  const sourceWords = sourceContent ? sourceContent.split(/\s+/).filter(Boolean).length : 0;

  // 1. Word count & length checks
  if (sourceWords >= 100) {
    if (summaryWords < 30 || summaryChars < 150) {
      return { valid: false, reason: `Summary is suspiciously short (${summaryWords} words, ${summaryChars} chars) for standard content.` };
    }
    if (summaryWords > 350) {
      return { valid: false, reason: `Summary exceeds maximum concise length (${summaryWords} words).` };
    }
  } else {
    if (summaryWords < 5 || summaryChars < 20) {
      return { valid: false, reason: `Summary is too short (${summaryWords} words).` };
    }
    if (sourceWords > 0 && summaryWords > Math.max(80, Math.ceil(sourceWords * 2.0))) {
      return { valid: false, reason: `Summary contains excessive padding (${summaryWords} words for ${sourceWords}-word source).` };
    }
  }

  const lower = cleaned.toLowerCase();

  // 2. Forbidden meta-language & prompt leakage phrases
  const forbiddenPhrases = [
    'as an ai',
    'i am an ai',
    'i cannot',
    'i am unable',
    'here is a summary',
    "here's a summary",
    'in this video',
    'this video shows',
    'this video explains',
    'this video covers',
    'this article',
    'in this article',
    'this tutorial',
    'the speaker',
    'the author',
    'transcript unavailable',
    'content unavailable',
    'summary unavailable',
    'no prohibited',
    'evaluation checklist',
  ];

  for (const phrase of forbiddenPhrases) {
    if (lower.includes(phrase)) {
      return { valid: false, reason: `Summary contains forbidden meta-language or prompt leakage: "${phrase}"` };
    }
  }

  if (lower.startsWith('summary:') || lower.startsWith('overview:') || lower.startsWith('key takeaways:')) {
    return { valid: false, reason: 'Summary contains forbidden section header prefix.' };
  }

  // 3. Verbatim transcript fragment check
  if (sourceWords > 150 && sourceContent.includes(cleaned)) {
    return { valid: false, reason: 'Summary is a verbatim transcript fragment rather than a synthesized summary.' };
  }

  // 4. Source content vocabulary relevance check
  const sourceWordSet = new Set(
    sourceContent
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3)
  );

  if (sourceWordSet.size >= 15) {
    const summarySignificantWords = cleaned
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3);

    const overlapCount = summarySignificantWords.filter(w => sourceWordSet.has(w)).length;
    const overlapRatio = summarySignificantWords.length > 0 ? overlapCount / summarySignificantWords.length : 0;

    if (overlapRatio < 0.12) {
      return { valid: false, reason: `Summary lacks vocabulary overlap with source content (${Math.round(overlapRatio * 100)}% overlap).` };
    }
  }

  return { valid: true };
}

export function cleanSummaryText(rawText: string): string {
  if (!rawText) return '';
  let cleaned = rawText.trim();

  // Strip markdown code fences if Gemini returns ```json or ```text
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json|text)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  // Handle JSON response object if present
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed.summary === 'string') {
        cleaned = parsed.summary.trim();
      }
    } catch { /* non-fatal */ }
  }

  // 1. Remove surrounding quotation marks
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'")) ||
    (cleaned.startsWith('“') && cleaned.endsWith('”'))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // 2. Strip Markdown bold/headers
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/#+\s+([^\n]+)/g, '$1');

  // 3. Remove lines echoing evaluation checklists or prompt instructions
  const paragraphs = cleaned.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const filteredParagraphs = paragraphs.map(para => {
    const lines = para.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const validLines = lines.filter(line => {
      const lower = line.toLowerCase();
      if (
        lower.startsWith('checked') ||
        lower.startsWith('no prohibited') ||
        lower.startsWith('plain text') ||
        lower.startsWith('verification') ||
        lower.startsWith('validation') ||
        lower.startsWith('no metalanguage') ||
        lower.startsWith('passed') ||
        lower.startsWith('summary requirement') ||
        lower.startsWith('length check') ||
        lower.includes('prohibited generic filler') ||
        lower.includes('complete sentences') ||
        lower.includes('words total')
      ) {
        return false;
      }
      return true;
    });
    return validLines.join(' ');
  }).filter(Boolean);

  cleaned = filteredParagraphs.join('\n\n');

  // 4. Remove preambles & metalanguage intros
  cleaned = cleaned.replace(/^(?:(?:\*?Draft\s*\d+:?\*?|Draft\s*\d+\s*[-:]?)\s*)/i, '');
  const draftIdx = cleaned.search(/(?:\*?Draft\s*\d+:?\*?\s*)/i);
  if (draftIdx > 0) {
    const afterDraft = cleaned.substring(draftIdx).replace(/^(?:\*?Draft\s*\d+:?\*?\s*)/i, '').trim();
    if (afterDraft.length > 30) {
      cleaned = afterDraft;
    }
  }

  const preambles = [
    /^(?:in\s+this\s+(?:video|article|tutorial|post|content|paper|repository|page)|this\s+(?:video|article|tutorial|post|content|repository|page)\s+(?:is\s+about|covers|explains|discusses|shows|explores|provides|presents)|the\s+content\s+discusses|today\s+we\s+will|welcome\s+to|the\s+speaker\s+(?:explains|discusses|presents|shows)|the\s+author\s+(?:explains|discusses|presents|shows))[,:\s]*/i,
    /^(?:summary|overview|key\s+takeaways?|final\s+summary|content\s+summary)[:\s]*/i,
  ];

  for (const pat of preambles) {
    cleaned = cleaned.replace(pat, '');
  }

  cleaned = cleaned.trim();
  if (cleaned && cleaned.length > 0 && cleaned[0].toLowerCase() !== cleaned[0].toUpperCase()) {
    cleaned = cleaned[0].toUpperCase() + cleaned.slice(1);
  }

  // 5. Ensure ending punctuation
  const lastChar = cleaned.slice(-1);
  if (!['.', '!', '?'].includes(lastChar)) {
    const lastPunct = Math.max(
      cleaned.lastIndexOf('.'),
      cleaned.lastIndexOf('!'),
      cleaned.lastIndexOf('?')
    );
    if (lastPunct > 20) {
      cleaned = cleaned.substring(0, lastPunct + 1).trim();
    }
  }

  return cleaned;
}

export async function determineFolderForItem(
  userId: string,
  item: {
    id: string;
    title?: string;
    tags?: string[];
    source_type?: string;
    url?: string;
    ai_summary?: string;
    description?: string;
  },
  supabaseClient: any
): Promise<string | null> {
  try {
    const collections = await fallbackDb.listCollections(userId, supabaseClient);

    const titleLower = (item.title || '').toLowerCase();
    const tagsArr = Array.isArray(item.tags)
      ? item.tags.map((t) => (t || '').toLowerCase().trim()).filter((t) => t && t !== 'uncategorized' && t !== 'general' && t !== 'article' && t !== 'web')
      : [];
    const sourceType = (item.source_type || '').toLowerCase();
    const urlLower = (item.url || '').toLowerCase();
    const summaryLower = (item.ai_summary || item.description || '').toLowerCase();
    const combinedText = `${titleLower} ${tagsArr.join(' ')} ${sourceType} ${urlLower} ${summaryLower}`;

    if (collections && collections.length > 0) {
      for (const col of collections) {
        const colNameLower = (col.name || '').toLowerCase().trim();
        if (!colNameLower) continue;

        if (combinedText.includes(colNameLower)) {
          return col.id;
        }

        const keywords = colNameLower.split(/\s+/).filter((k: string) => k.length > 2);
        const matchCount = keywords.filter((kw: string) => combinedText.includes(kw)).length;
        if (matchCount > 0) {
          return col.id;
        }
      }
    }

    let targetCategory = '';
    let targetColor = 'blue';

    if (tagsArr.length > 0) {
      const primaryTag = tagsArr[0];
      if (primaryTag.includes('ai') || primaryTag.includes('llm') || primaryTag.includes('gpt')) {
        targetCategory = 'AI';
        targetColor = 'purple';
      } else if (primaryTag.includes('code') || primaryTag.includes('tech') || primaryTag.includes('dev') || primaryTag.includes('python') || primaryTag.includes('rust')) {
        targetCategory = 'Tech';
        targetColor = 'purple';
      } else if (primaryTag.includes('research') || primaryTag.includes('science') || primaryTag.includes('paper')) {
        targetCategory = 'Research';
        targetColor = 'green';
      } else if (primaryTag.includes('design') || primaryTag.includes('css') || primaryTag.includes('ui')) {
        targetCategory = 'Design';
        targetColor = 'orange';
      } else if (primaryTag.includes('business') || primaryTag.includes('finance') || primaryTag.includes('market')) {
        targetCategory = 'Business';
        targetColor = 'yellow';
      } else {
        targetCategory = primaryTag.charAt(0).toUpperCase() + primaryTag.slice(1);
        targetColor = 'blue';
      }
    }

    if (!targetCategory) {
      if (sourceType === 'youtube' || urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
        targetCategory = 'Videos';
        targetColor = 'red';
      } else if (sourceType === 'github' || urlLower.includes('github.com')) {
        targetCategory = 'Development';
        targetColor = 'purple';
      } else if (urlLower.endsWith('.pdf') || titleLower.includes('pdf')) {
        targetCategory = 'PDFs';
        targetColor = 'orange';
      } else if (titleLower.includes('research') || summaryLower.includes('research')) {
        targetCategory = 'Research';
        targetColor = 'green';
      } else {
        targetCategory = 'Articles';
        targetColor = 'blue';
      }
    }

    if (collections && collections.length > 0) {
      const existingSameName = collections.find((col: any) =>
        (col.name || '').toLowerCase().trim() === targetCategory.toLowerCase().trim()
      );
      if (existingSameName) {
        return existingSameName.id;
      }
    }

    console.log(`[AutoFolder] Creating missing folder "${targetCategory}" (${targetColor}) for user ${userId}...`);
    const newCol = await fallbackDb.createCollection(userId, targetCategory, targetColor, supabaseClient);
    return newCol?.id || null;
  } catch (err) {
    console.error('[AutoFolder] Error determining/creating folder:', err);
    return null;
  }
}

export class AIService {
  public static async extractYouTubeContent(url: string) {
    return fetchYouTubeContent(url);
  }

  private static getApiKey(): string | null {
    return process.env.GEMINI_API_KEY || null;
  }

  /**
   * Call Gemini API to generate a production-grade abstractive summary (120-220 words target for normal content, 1-3 paragraphs).
   */
  static async generateSummary(
    title: string,
    url: string,
    contentType: string = 'article',
    snippet: string = ''
  ): Promise<{ summary: string; tags: string[]; priority: number; error?: string }> {
    const platform = resolvePlatformInfo(url);

    if (!snippet || !snippet.trim() || snippet.trim().length < 20) {
      return {
        summary: '',
        tags: [contentType || platform.source_type || 'article', 'general'],
        priority: 50,
        error: 'No usable content provided for summarization.',
      };
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      console.warn('[AIService] GEMINI_API_KEY is missing.');
      return {
        summary: '',
        tags: [contentType || 'article', 'general'],
        priority: 50,
        error: 'GEMINI_API_KEY missing from environment configuration.',
      };
    }

    const preparedContent = prepareContentForSummarization(snippet, 12000);
    const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-flash-latest'];

    const primaryPrompt = `You are an expert technical content summarizer.

GOAL:
Generate a concise, highly informative, self-contained summary of the provided source content so a reader understands what it teaches without consuming the original source.

SOURCE TITLE: "${title}"
SOURCE TYPE: "${contentType || platform.source_type}"
SOURCE DOMAIN: "${platform.source_name}"

EXTRACTED SOURCE CONTENT:
"""
${preparedContent}
"""

STRICT INSTRUCTIONS:
1. Base your summary ONLY on the provided source content. Do NOT invent facts or extrapolate beyond what is present.
2. Clearly explain the main topic/purpose, important concepts, arguments, steps, workflows, or conclusions.
3. Preserve key technical terms, names, numbers, specifications, and relationships.
4. Remove repetition, filler, greetings, navigation text, ads, and irrelevant metadata.
5. Do NOT copy large sections verbatim. Rephrase and synthesize in clear English.
6. Do NOT mention that this is an AI summary or transcript. Do NOT use meta-phrases like "this video", "this article", "in this tutorial", "the author", "the speaker", "here is a summary", "summary:", "overview:". Start DIRECTLY with the core subject.
7. Format: Write 1 to 3 concise, well-structured plain text paragraphs.
8. Length: For normal content, target 120 to 220 words. For very short source content, write a shorter proportional summary without padding.
9. Do NOT output markdown headers, titles, bullet points, meta-commentary, or prompt instructions.`;

    let lastValidationReason = '';

    for (const model of models) {
      try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            contents: [{ parts: [{ text: primaryPrompt }] }],
            generationConfig: {
              maxOutputTokens: 1200,
              temperature: 0.3,
            },
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.warn(`[AIService] ${model} returned HTTP ${res.status}: ${errText.substring(0, 150)}`);
          continue;
        }

        const data: any = await res.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        let cleaned = cleanSummaryText(rawText);

        // Stage 4 Validation (Attempt 1)
        const val = validateSummary(cleaned, preparedContent);
        if (val.valid) {
          const tags = [platform.source_type || 'article', 'general'];
          if (
            title.toLowerCase().includes('code') ||
            title.toLowerCase().includes('algorithm') ||
            title.toLowerCase().includes('python') ||
            title.toLowerCase().includes('rag') ||
            title.toLowerCase().includes('llm') ||
            title.toLowerCase().includes('docker')
          ) {
            tags.push('tech');
          }
          return { summary: cleaned, tags, priority: 60 };
        }

        lastValidationReason = val.reason || 'Failed quality validation';
        console.warn(`[AIService] ${model} summary validation failed (Attempt 1): ${lastValidationReason}. Retrying ONCE with correction prompt...`);

        // Attempt 2: Retry ONCE with stronger correction prompt
        const correctionPrompt = `Your previous summary attempt was rejected: ${lastValidationReason}.

Rewrite the summary adhering STRICTLY to these instructions:
- Base the summary ONLY on the source text below.
- Do NOT use meta-phrases or preambles (e.g. "this video", "this article", "the author", "as an AI", "summary:", "in this content"). Start immediately with the core subject.
- Write 1 to 3 clear paragraphs (target 120-220 words for normal content).
- Do NOT include headers, bullet points, or commentary.

SOURCE TITLE: "${title}"
EXTRACTED SOURCE CONTENT:
"""
${preparedContent}
"""`;

        const retryRes = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            contents: [{ parts: [{ text: correctionPrompt }] }],
            generationConfig: {
              maxOutputTokens: 1200,
              temperature: 0.2,
            },
          }),
        });

        if (retryRes.ok) {
          const retryData: any = await retryRes.json();
          const retryRaw = retryData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          let retryCleaned = cleanSummaryText(retryRaw);
          const retryVal = validateSummary(retryCleaned, preparedContent);
          if (retryVal.valid) {
            console.log(`[AIService] Quality retry successful for ${model}. Summary validated.`);
            const tags = [platform.source_type || 'article', 'general'];
            return { summary: retryCleaned, tags, priority: 60 };
          }
          lastValidationReason = retryVal.reason || 'Retry failed validation';
          console.warn(`[AIService] ${model} retry summary validation failed: ${lastValidationReason}`);
        }
      } catch (err: any) {
        console.error(`[AIService] Error calling model ${model}:`, err?.message || err);
      }
    }

    return {
      summary: '',
      tags: [platform.source_type || 'article', 'general'],
      priority: 50,
      error: `Gemini summarization failed: ${lastValidationReason || 'API requests unfulfilled'}`,
    };
  }

  /**
   * Run background enrichment pipeline for a newly saved queue item.
   */
  static async processItemEnrichment(
    itemId: string,
    url: string,
    userId: string,
    titleOverride?: string | null
  ): Promise<void> {
    const ENRICHMENT_TIMEOUT_MS = 60000;
    const abortController = new AbortController();
    const { signal } = abortController;
    let isTimedOut = false;
    let timeoutTimer: NodeJS.Timeout | null = null;

    const checkAborted = () => {
      if (isTimedOut || signal.aborted) {
        throw new Error('Pipeline aborted due to timeout');
      }
    };

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        isTimedOut = true;
        abortController.abort();
        reject(new Error(`Enrichment pipeline timed out after ${ENRICHMENT_TIMEOUT_MS / 1000}s`));
      }, ENRICHMENT_TIMEOUT_MS);
    });

    const executionPromise = (async () => {
      const platformInfo = resolvePlatformInfo(url);
      let title = titleOverride || platformInfo.source_name || url;
      let existingTranscript = '';
      let existingDescription = '';

      try {
        const { data: row } = await supabase.from('items').select('extracted_text, description, title').eq('id', itemId).maybeSingle();
        if (row) {
          if (row.title && row.title.trim()) title = row.title.trim();
          existingTranscript = (row.extracted_text || '').trim();
          existingDescription = (row.description || '').trim();
        }
      } catch { /* non-fatal */ }

      checkAborted();

      const isYouTube = platformInfo.source_type === 'youtube' || url.includes('youtube.com') || url.includes('youtu.be');
      const isPdf = platformInfo.source_type === 'pdf' || url.toLowerCase().endsWith('.pdf') || url.toLowerCase().includes('/pdf/');
      let ytDurationSeconds = 0;
      let snippet = existingTranscript;

      // Update processing_status to 'processing'
      try {
        await supabase.from('items').update({ processing_status: 'processing' }).eq('id', itemId);
      } catch (err: any) {
        console.warn(`[AIService] Failed to update processing_status to processing: ${err?.message}`);
      }

      checkAborted();

      // STAGE 1: source loaded
      if (isYouTube) {
        if (!existingTranscript) {
          console.log(`[AIService] Stage 1: loading source via YouTubeExtractor for ${url}...`);
          const extractionResult = await YouTubeExtractor.extractYouTubeContent(url);
          checkAborted();

          if (extractionResult.durationSeconds && extractionResult.durationSeconds > 0) {
            ytDurationSeconds = extractionResult.durationSeconds;
          }
          if (extractionResult.title && extractionResult.title.trim()) {
            title = extractionResult.title.trim();
          }

          if (!extractionResult.success || !extractionResult.transcript || !extractionResult.transcript.trim()) {
            const failReason = extractionResult.error || 'No transcript or captions available for YouTube video';
            console.warn(`[AIService] Stage 1 Failed: YouTube transcript extraction failed: ${failReason}`);
            if (isTimedOut || signal.aborted) return;

            const failPayload: Record<string, any> = {
              processing_status: 'failed',
              ai_summary: null,
              notes: `[Extraction Failed] ${failReason}`,
              title,
            };
            if (ytDurationSeconds > 0) failPayload.duration_seconds = ytDurationSeconds;

            await supabase.from('items').update(failPayload).eq('id', itemId);
            try {
              await fallbackDb.updateItemMetadata(userId, itemId, { notes: `[Extraction Failed] ${failReason}` }, supabase);
            } catch { /* non-fatal */ }
            return;
          }

          snippet = extractionResult.transcript;
        }
      } else {
        // Non-YouTube source: use existing transcript/description or fetch web article text
        if (!snippet || !snippet.trim()) {
          snippet = existingDescription || '';
        }
        if (!snippet || !snippet.trim()) {
          console.log(`[AIService] Stage 1: fetching web article text for ${url}...`);
          snippet = await fetchWebArticleContent(url);
          checkAborted();
        }
      }

      if (!snippet || !snippet.trim() || snippet.trim().length < 20) {
        console.warn(`[AIService] Stage 1 Failed: No usable text content could be extracted for item ${itemId}`);
        if (isTimedOut || signal.aborted) return;
        const failPayload: Record<string, any> = {
          processing_status: 'failed',
          ai_summary: null,
          notes: '[Extraction Failed] No usable text content could be extracted from source.',
        };
        await supabase.from('items').update(failPayload).eq('id', itemId);
        try {
          await fallbackDb.updateItemMetadata(userId, itemId, { notes: '[Extraction Failed] No usable text content' }, supabase);
        } catch { /* non-fatal */ }
        return;
      }

      console.log(`[AIService] Stage 1: source loaded for item ${itemId} (${snippet.length} chars)`);
      checkAborted();

      // STAGE 2: content prepared
      snippet = await translateToEnglishIfNeeded(snippet);
      checkAborted();

      const preparedContent = prepareContentForSummarization(snippet, 12000);
      console.log(`[AIService] Stage 2: content prepared for item ${itemId} (Original: ${snippet.length} chars -> Prepared: ${preparedContent.length} chars)`);

      try {
        await supabase.from('items').update({
          extracted_text: snippet,
          title,
        }).eq('id', itemId);
      } catch (dbErr) {
        console.warn('[AIService] Failed to store extracted_text in DB:', dbErr);
      }

      checkAborted();

      let estimatedReadTime = 5;
      let estimatedTimeMinutes = 5.0;

      if (isYouTube && ytDurationSeconds > 0) {
        estimatedReadTime = Math.max(1, Math.ceil(ytDurationSeconds / 60));
        estimatedTimeMinutes = Math.max(1, Math.round((ytDurationSeconds / 60) * 10) / 10);
      } else {
        const extractedWordCount = (snippet || '').split(/\s+/).filter(Boolean).length;
        if (extractedWordCount > 0) {
          estimatedReadTime = Math.max(1, Math.ceil(extractedWordCount / 225));
          estimatedTimeMinutes = Math.max(1, Math.round((extractedWordCount / 225) * 10) / 10);
        }
      }

      // STAGE 3: Gemini request
      console.log(`[AIService] Stage 3: Gemini request sent for item ${itemId}`);
      const result = await this.generateSummary(title, url, platformInfo.source_type, preparedContent);
      checkAborted();

      // STAGE 4: summary validated
      if (!result.summary || !result.summary.trim()) {
        const failReason = result.error || 'Gemini summary generation failed quality validation.';
        console.warn(`[AIService] Stage 4 Failed: Summary validation failed for item ${itemId}: ${failReason}`);
        if (isTimedOut || signal.aborted) return;

        const failPayload: Record<string, any> = {
          processing_status: 'failed',
          ai_summary: null,
          notes: `[AI Generation Failed] ${failReason}`,
        };
        await supabase.from('items').update(failPayload).eq('id', itemId);
        try {
          await fallbackDb.updateItemMetadata(userId, itemId, { notes: `[AI Generation Failed] ${failReason}` }, supabase);
        } catch { /* non-fatal */ }
        return;
      }

      console.log(`[AIService] Stage 4: summary validated for item ${itemId}`);

      // Folder classification
      let collectionId: string | null = null;
      try {
        const { data: itemRow } = await supabase.from('items').select('collection_id').eq('id', itemId).maybeSingle();
        collectionId = itemRow?.collection_id || null;
      } catch { /* non-fatal */ }

      if (!collectionId) {
        collectionId = await determineFolderForItem(userId, {
          id: itemId,
          title,
          tags: result.tags,
          source_type: platformInfo.source_type,
          url,
          ai_summary: result.summary,
        }, supabase);
      }

      checkAborted();

      // STAGE 5: saved
      const updatePayload: Record<string, any> = {
        ai_summary: result.summary,
        notes: null,
        tags: result.tags,
        processing_status: 'completed',
        estimated_read_time: estimatedReadTime,
        priority_score: result.priority,
      };

      if (ytDurationSeconds > 0) {
        updatePayload.duration_seconds = ytDurationSeconds;
      }
      if (platformInfo.source_name) updatePayload.source_name = platformInfo.source_name;
      if (platformInfo.source_type) updatePayload.content_type = platformInfo.source_type;
      if (snippet && snippet.trim()) updatePayload.extracted_text = snippet;

      const { error } = await supabase.from('items').update(updatePayload).eq('id', itemId);
      if (error) {
        console.warn('[AIService] Supabase update warning:', error.message);
        const safePayload: Record<string, any> = {
          ai_summary: result.summary,
          notes: null,
          tags: result.tags,
          processing_status: 'completed',
          priority_score: result.priority,
          estimated_read_time: estimatedReadTime,
        };
        if (ytDurationSeconds > 0) safePayload.duration_seconds = ytDurationSeconds;
        await supabase.from('items').update(safePayload).eq('id', itemId);
      }

      try {
        await fallbackDb.updateItemMetadata(userId, itemId, { estimated_time_minutes: estimatedTimeMinutes, collection_id: collectionId }, supabase);
      } catch { /* non-fatal */ }

      const summaryWordCount = result.summary.split(/\s+/).filter(Boolean).length;
      console.log(`[AIService] Stage 5: saved item ${itemId} as completed (Summary length: ${result.summary.length} chars, ${summaryWordCount} words)`);
    })();

    try {
      await Promise.race([executionPromise, timeoutPromise]);
    } catch (err: any) {
      if (!isTimedOut) {
        console.error(`[AIService] processItemEnrichment error for item ${itemId}:`, err?.message || err);
      } else {
        console.warn(`[AIService] processItemEnrichment timed out for item ${itemId} after ${ENRICHMENT_TIMEOUT_MS / 1000}s`);
      }
      try {
        await supabase.from('items').update({
          processing_status: 'failed',
          ai_summary: null,
          notes: `[Extraction Failed] ${err?.message || err}`,
        }).eq('id', itemId);
      } catch { /* non-fatal */ }
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
  }
}

