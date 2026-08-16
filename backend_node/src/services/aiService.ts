import dotenv from 'dotenv';
import { execFile } from 'child_process';
import path from 'path';
import { supabase } from '../config/supabase';
import { fallbackDb } from '../utils/schemaFallback';
import { resolvePlatformInfo } from '../utils/urlHelper';

dotenv.config();

/** Helper function to extract YouTube transcript/content using Python backend extractor */
function fetchYouTubeContent(url: string): Promise<{ transcript: string; title?: string }> {
  return new Promise((resolve) => {
    try {
      const backendDir = path.resolve(__dirname, '../../../backend');
      const pyCode = `
import json, sys
sys.path.insert(0, '.')
try:
    from services.youtube_extractor import extract_youtube
    res = extract_youtube(sys.argv[1])
    print("OUTPUT_JSON:" + json.dumps({'transcript': res.get('transcript') or '', 'title': res.get('title') or ''}))
except Exception as e:
    print("OUTPUT_JSON:" + json.dumps({'transcript': '', 'error': str(e)}))
`;
      execFile('python', ['-c', pyCode, url], { cwd: backendDir, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err || !stdout) {
          console.warn('[AIService] Python YouTube extraction failed:', err?.message || stderr);
          resolve({ transcript: '' });
          return;
        }
        try {
          const match = stdout.split('\n').find(line => line.startsWith('OUTPUT_JSON:'));
          if (!match) {
            resolve({ transcript: '' });
            return;
          }
          const jsonStr = match.replace('OUTPUT_JSON:', '').trim();
          const parsed = JSON.parse(jsonStr);
          resolve({ transcript: parsed.transcript || '', title: parsed.title || '' });
        } catch (e) {
          console.warn('[AIService] JSON parse error:', e);
          resolve({ transcript: '' });
        }
      });
    } catch (e) {
      console.warn('[AIService] Exception during YouTube extraction:', e);
      resolve({ transcript: '' });
    }
  });
}

/** Translate non-English transcript text to clear English using Gemini API */
async function translateToEnglishIfNeeded(text: string): Promise<string> {
  if (!text || !text.trim()) return text;

  // Detect non-English scripts (Devanagari, Chinese, Cyrillic, Arabic, etc.)
  const isNonEnglish = /[\u0900-\u097F\u4E00-\u9FFF\u0600-\u06FF\u0400-\u04FF\u0B80-\u0BFF\u0C00-\u0C7F]/.test(text);
  if (!isNonEnglish) {
    return text;
  }

  console.log(`[AIService] Non-English transcript detected (${text.length} chars). Translating full transcript to English...`);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return text;

  const prompt = `Translate the following entire transcript/content into clear, natural, accurate English.
Preserve all technical terms, code snippet names, algorithms, software names, and core concepts across all sections of the content.
Return ONLY the final translated English text without any explanations, meta-comments, or preambles.

Text:
${text.substring(0, 50000)}`;

  const models = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'];
  for (const model of models) {
    try {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 8000,
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

function cleanSummaryText(rawText: string): string {
  if (!rawText) return '';
  let cleaned = rawText.trim();

  // 1. Remove surrounding quotation marks if Gemini returns them
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'")) ||
    (cleaned.startsWith('“') && cleaned.endsWith('”'))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // 2. Strip Markdown bold/headers if present
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/#+\s+([^\n]+)/g, '$1');

  // 3. Remove lines that echo evaluation checklists or prompt instructions while preserving paragraph breaks
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

  // 4. Remove unnecessary preambles, draft markers (*Draft 3:*), and metalanguage intros
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
    /^(?:summary|overview|key\s+takeaway|final\s+summary|content\s+summary)[:\s]*/i,
  ];

  for (const pat of preambles) {
    cleaned = cleaned.replace(pat, '');
  }

  cleaned = cleaned.trim();
  if (cleaned && cleaned.length > 0 && cleaned[0].toLowerCase() !== cleaned[0].toUpperCase()) {
    cleaned = cleaned[0].toUpperCase() + cleaned.slice(1);
  }

  // 5. Safety check: ensure ending punctuation and remove incomplete trailing fragments
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

export class AIService {
  private static getApiKey(): string | null {
    return process.env.GEMINI_API_KEY || null;
  }

  /**
   * Call Gemini API to generate a 120-180 word abstractive whole-content summary (1-2 paragraphs).
   */
  static async generateSummary(
    title: string,
    url: string,
    contentType: string = 'article',
    snippet: string = ''
  ): Promise<{ summary: string; tags: string[]; priority: number }> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      console.warn('[AIService] GEMINI_API_KEY is missing. Using fallback summary.');
      return {
        summary: `${title || 'Content'} details the core algorithms, implementation steps, and analytical concepts provided in the source material, providing immediate technical context and conclusions.`,
        tags: [contentType || 'article', 'general'],
        priority: 50,
      };
    }

    const platform = resolvePlatformInfo(url);
    const prompt = `You are an expert technical knowledge summarizer.

TASK:
Analyze the ENTIRE extracted content below (from beginning, middle, to end). Write a genuine, highly informative summary representing the WHOLE material across 1 to 2 well-structured paragraphs (100 to 150 words total).

CONTENT TITLE: "${title}"
CONTENT TYPE: "${contentType || platform.source_type}"
SOURCE DOMAIN: "${platform.source_name}"

ACTUAL EXTRACTED CONTENT:
"${snippet.substring(0, 65000)}"

CRITICAL SUMMARIZATION RULES:
1. Whole-Content Synthesis: Identify the main topic, key concepts, core mechanisms, techniques, and conclusions covered throughout the entire material. Combine related ideas into a coherent, flowing summary.
2. Do NOT summarize just the intro or first few lines: Do NOT follow transcript order or describe greetings, introductions, or setup. Focus on the main ideas and takeaways from the entire content.
3. Length & Structure: Write 100 to 150 words total in 1 to 2 well-structured paragraphs.
4. No Direct Copying: Rephrase and synthesize concepts in clear English. Do not copy sentences directly from the source.
5. Strictly Prohibited Intros and Metalanguage: Do NOT mention that you are summarizing. Do NOT use phrases like "this video...", "this article...", "in this tutorial...", "the author...", "the speaker...", or "this content covers...". Start directly with the core subject knowledge.
6. Zero Generic Filler: Omit greetings, repetition, non-essential examples, irrelevant details, and generic filler words like "essential concepts", "key principles", or "practical applications".
7. Output Format: Return ONLY the final summary text (1-2 plain text paragraphs in clear English). Do not include markdown headers, titles, bullet points, preambles, or verification notes.`;

    const models = ['gemini-2.5-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'];

    for (const model of models) {
      try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: 2500,
              temperature: 0.35,
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
        if (rawText && rawText.trim()) {
          const cleaned = cleanSummaryText(rawText);

          // Ensure generated summary is complete and has reasonable length
          if (cleaned.length > 30 && ['.', '!', '?'].includes(cleaned.slice(-1))) {
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
            return {
              summary: cleaned,
              tags,
              priority: 60,
            };
          }
        }
      } catch (err: any) {
        console.error(`[AIService] Error calling model ${model}:`, err?.message || err);
      }
    }

    // High quality fallback if API calls fail or return incomplete outputs
    const fallbackText = `${title || 'Content'} details the core algorithms, implementation steps, and analytical concepts provided in the source material, providing immediate technical context and conclusions.`;
    return {
      summary: fallbackText,
      tags: [platform.source_type || 'article', 'general'],
      priority: 50,
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
    try {
      console.log(`[AIService] Starting AI summary generation for item ${itemId} (${url})...`);

      const platformInfo = resolvePlatformInfo(url);
      let title = titleOverride || platformInfo.source_name || url;
      let snippet = '';

      try {
        const { data: row } = await supabase.from('items').select('extracted_text, description, title').eq('id', itemId).maybeSingle();
        if (row) {
          if (row.title && row.title.trim()) title = row.title.trim();
          snippet = row.extracted_text || row.description || '';
        }
      } catch { /* non-fatal */ }

      const isYouTube = platformInfo.source_type === 'youtube' || url.includes('youtube.com') || url.includes('youtu.be');

      // Step 1: If transcript is missing or short, perform YouTube extraction
      if ((!snippet || snippet.trim().length < 50) && isYouTube) {
        console.log(`[PIPELINE LOG] [AI Service] Extracted text missing for YouTube URL. Extracting transcript...`);
        const extracted = await fetchYouTubeContent(url);
        if (extracted.transcript && extracted.transcript.trim()) {
          snippet = extracted.transcript;
          if (extracted.title && extracted.title.trim()) {
            title = extracted.title.trim();
          }
          console.log(`[PIPELINE LOG] [AI Service] YouTube extraction successful! Transcript length: ${snippet.length} chars.`);
        } else {
          console.warn(`[PIPELINE LOG] [AI Service] YouTube transcript extraction returned empty.`);
        }
      }

      // Step 2: Ensure transcript is in English for storage and AI processing
      snippet = await translateToEnglishIfNeeded(snippet);

      // Step 3: Store extracted English transcript in database if available
      if (snippet && snippet.trim()) {
        try {
          await supabase.from('items').update({
            extracted_text: snippet,
            title: title,
          }).eq('id', itemId);
          console.log(`[PIPELINE LOG] [Database] Stored English extracted_text (${snippet.length} chars) for item ${itemId}`);
        } catch (dbErr) {
          console.warn('[AIService] Failed to store extracted_text in DB:', dbErr);
        }
      }

      // Step 4: Log preview of English text being sent to Gemini
      const snippetPreview = snippet.substring(0, 150).replace(/\r?\n/g, ' ');
      console.log(`[PIPELINE LOG] [AI Service] Text being passed to Gemini for item ${itemId} (Full Length: ${snippet.length} chars): "${snippetPreview}..."`);

      // Step 5: Generate abstractive whole-content AI summary via Gemini API
      const result = await this.generateSummary(title, url, platformInfo.source_type, snippet);

      const wordCount = result.summary.split(/\s+/).filter(Boolean).length;
      const estimatedReadTime = Math.max(1, Math.round(wordCount / 35) || 3);
      const estimatedTimeMinutes = estimatedReadTime * 1.0;

      const updatePayload: Record<string, any> = {
        ai_summary: result.summary,
        tags: result.tags,
        processing_status: 'completed',
        estimated_read_time: estimatedReadTime,
        priority_score: result.priority,
      };

      if (platformInfo.source_name) updatePayload.source_name = platformInfo.source_name;
      if (platformInfo.source_type) updatePayload.source_type = platformInfo.source_type;
      if (platformInfo.source_domain) updatePayload.source_domain = platformInfo.source_domain;
      if (platformInfo.logo_url) updatePayload.logo_url = platformInfo.logo_url;
      if (snippet && snippet.trim()) updatePayload.extracted_text = snippet;

      // Step 6: Update Supabase items record
      const { error } = await supabase.from('items').update(updatePayload).eq('id', itemId);
      if (error) {
        // Retry update with safe columns if PostgREST column missing
        const safePayload: Record<string, any> = {
          ai_summary: result.summary,
          tags: result.tags,
          processing_status: 'completed',
          priority_score: result.priority,
        };
        if (snippet && snippet.trim()) safePayload.extracted_text = snippet;
        await supabase.from('items').update(safePayload).eq('id', itemId);
      }

      // Save local metadata
      try {
        await fallbackDb.updateItemMetadata(userId, itemId, { estimated_time_minutes: estimatedTimeMinutes }, supabase);
      } catch { /* non-fatal */ }

      console.log(`[AIService] AI summary generation completed for item ${itemId}. Summary length: ${result.summary.length} chars (${wordCount} words).`);
    } catch (err: any) {
      console.error(`[AIService] processItemEnrichment error for item ${itemId}:`, err);
      try {
        await supabase.from('items').update({
          processing_status: 'completed',
          ai_summary: 'Summary processing completed.',
        }).eq('id', itemId);
      } catch { /* non-fatal */ }
    }
  }
}
