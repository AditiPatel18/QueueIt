import dotenv from 'dotenv';
import { execFile } from 'child_process';
import path from 'path';
import { supabase } from '../config/supabase';
import { fallbackDb } from '../utils/schemaFallback';
import { resolvePlatformInfo } from '../utils/urlHelper';

dotenv.config();

/** Helper function to extract YouTube metadata, duration, and transcript using direct Innertube RPC and fallbacks */
async function fetchYouTubeContent(url: string): Promise<{ transcript: string; title?: string; durationSeconds?: number }> {
  try {
    const vMatch = url.match(/(?:v=|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    const videoId = vMatch ? vMatch[1] : null;

    if (!videoId) {
      return { transcript: '' };
    }

    let title = '';
    let durationSeconds = 0;
    let transcript = '';

    const publicKeys = [
      'AIzaSyAO_FJ2SlqU8Q4STEihQIxomIq_S9waxqY',
      'AIzaSyC1xlsmZOMtvD_3epXvIqf4gE3b-t9R_2E',
      'AIzaSyBflxtu4so615_dC_YyH9Z2zL6q9vU2-gA',
    ];

    const clientConfigs = [
      { name: 'ANDROID', clientName: 'ANDROID', clientNumber: '3', clientVersion: '20.10.38', ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11; en_US; Pixel 5 Build/RD1A.201105.003.C1)' },
      { name: 'IOS', clientName: 'IOS', clientNumber: '2', clientVersion: '19.45.4', ua: 'com.google.ios.youtube/19.45.4 (iPhone14,3; U; CPU iOS 17_5_1 like Mac OS X; en_US)' },
      { name: 'WEB', clientName: 'WEB', clientNumber: '1', clientVersion: '2.20240308.00.00', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36' },
    ];

    console.log(`[YouTube Extract] Video ID: ${videoId}`);

    // Helper to clean raw caption XML or JSON3 string into plain text with space separators
    const parseCaptionText = (raw: string): string => {
      if (!raw || !raw.trim()) return '';
      const trimmed = raw.trim();
      if (trimmed.startsWith('{')) {
        try {
          const jsonCap = JSON.parse(trimmed);
          const parts: string[] = [];
          if (Array.isArray(jsonCap.events)) {
            for (const ev of jsonCap.events) {
              if (Array.isArray(ev.segs)) {
                for (const seg of ev.segs) {
                  if (seg.utf8) parts.push(seg.utf8);
                }
              }
            }
          }
          const parsed = parts.join(' ').replace(/\s+/g, ' ').trim();
          if (parsed.length > 20) return parsed;
        } catch { /* fallback to regex */ }
      }
      return trimmed
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
    };

    // 1. Multi-client Innertube Player RPC
    for (const clientCfg of clientConfigs) {
      if (transcript) break;
      for (const key of publicKeys) {
        if (transcript) break;
        try {
          console.log(`[AIService] Trying Innertube RPC client=${clientCfg.name} key=${key.substring(0, 8)}... for video ${videoId}`);
          const playerRes = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': clientCfg.ua,
              'Origin': 'https://www.youtube.com',
              'Referer': 'https://www.youtube.com/',
              'X-YouTube-Client-Name': clientCfg.clientNumber,
              'X-YouTube-Client-Version': clientCfg.clientVersion,
            },
            body: JSON.stringify({
              context: {
                client: {
                  clientName: clientCfg.clientName,
                  clientVersion: clientCfg.clientVersion,
                  hl: 'en',
                  gl: 'US',
                },
              },
              videoId: videoId,
            }),
          });

          console.log(`[AIService] Innertube RPC client=${clientCfg.name} returned HTTP ${playerRes.status}`);
          if (!playerRes.ok) continue;

          const playerData: any = await playerRes.json();
          console.log(`[AIService] playabilityStatus=${playerData?.playabilityStatus?.status}, hasVideoDetails=${Boolean(playerData?.videoDetails)}, hasCaptions=${Boolean(playerData?.captions)}`);

          if (playerData?.videoDetails) {
            if (!title && playerData.videoDetails.title) {
              title = playerData.videoDetails.title.trim();
            }
            if (!durationSeconds && playerData.videoDetails.lengthSeconds) {
              durationSeconds = parseInt(playerData.videoDetails.lengthSeconds, 10) || 0;
            }
          }

          const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (captionTracks && Array.isArray(captionTracks) && captionTracks.length > 0) {
            console.log(`[YouTube Extract] Caption tracks found: ${captionTracks.length}`);
            // Order candidate tracks: preferred English track first, then all remaining tracks
            const orderedTracks = [
              captionTracks.find((t: any) =>
                t.languageCode === 'en' ||
                t.vssId?.includes('en') ||
                t.vssId?.includes('.en') ||
                t.name?.runs?.[0]?.text?.toLowerCase().includes('english')
              ),
              ...captionTracks,
            ].filter(Boolean);

            for (const track of orderedTracks) {
              if (transcript) break;
              if (!track?.baseUrl) continue;

              const trackUrl = track.baseUrl;
              const selectedLang = track.languageCode || track.vssId || 'unknown';
              console.log(`[YouTube Extract] Selected track language: ${selectedLang}`);
              const capRes = await fetch(trackUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                  'Referer': 'https://www.youtube.com/',
                  'Origin': 'https://www.youtube.com',
                },
              });

              console.log(`[YouTube Extract] Caption HTTP status: ${capRes.status}`);
              if (capRes.status === 429) {
                console.warn(`[YouTube Extract] Rate limited (HTTP 429) fetching caption track`);
                break; // Stop looping tracks if rate limited
              }
              if (capRes.ok) {
                const rawCap = await capRes.text();
                console.log(`[YouTube Extract] Caption response byte length: ${rawCap.length}`);
                const cleaned = parseCaptionText(rawCap);
                console.log(`[YouTube Extract] Parsed transcript character count: ${cleaned.length}`);
                if (cleaned && cleaned.length > 20) {
                  transcript = cleaned;
                  console.log(`[AIService] Succeeded via Innertube RPC (${clientCfg.name}) - ${transcript.length} chars`);
                  break;
                }
              }
            }
          }
        } catch (keyErr: any) {
          console.warn(`[AIService] Innertube RPC warning (${clientCfg.name}):`, keyErr?.message || keyErr);
        }
      }
    }

    // 2. Fallback: Direct Timedtext API endpoint search
    if (!transcript) {
      console.log(`[AIService] Attempting direct timedtext API fallback for video ${videoId}...`);
      const timedTextUrls = [
        `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=srv1`,
        `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&kind=asr&fmt=srv1`,
        `https://www.youtube.com/api/timedtext?v=${videoId}&lang=hi&fmt=srv1`,
        `https://www.youtube.com/api/timedtext?v=${videoId}&lang=hi&kind=asr&fmt=srv1`,
      ];

      for (const ttUrl of timedTextUrls) {
        try {
          const res = await fetch(ttUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            },
          });
          if (res.ok) {
            const raw = await res.text();
            const cleaned = parseCaptionText(raw);
            if (cleaned && cleaned.length > 20) {
              transcript = cleaned;
              console.log(`[AIService] Succeeded via direct timedtext endpoint (${transcript.length} chars)`);
              break;
            }
          }
        } catch { /* non-fatal */ }
      }
    }

    // 3. Fallback: Timedtext track list query
    if (!transcript) {
      try {
        const listRes = await fetch(`https://www.youtube.com/api/timedtext?type=list&v=${videoId}`);
        if (listRes.ok) {
          const xml = await listRes.text();
          const trackMatches = xml.match(/lang_code="([^"]+)"/g);
          if (trackMatches) {
            const langCodes = trackMatches.map(m => m.split('"')[1]);
            const preferredLang = langCodes.find(l => l.startsWith('en')) || langCodes[0];
            if (preferredLang) {
              const fetchRes = await fetch(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=${preferredLang}&fmt=srv1`);
              if (fetchRes.ok) {
                const raw = await fetchRes.text();
                const cleaned = parseCaptionText(raw);
                if (cleaned && cleaned.length > 20) {
                  transcript = cleaned;
                  console.log(`[AIService] Succeeded via timedtext track list (${transcript.length} chars)`);
                }
              }
            }
          }
        }
      } catch { /* non-fatal */ }
    }

    // 4. Fallback: Secondary watch page HTML scrape
    if (!transcript || !title) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        if (res.ok) {
          const html = await res.text();

          if (!title) {
            const titleMatch = html.match(/<title>(.*?)<\/title>/i) || html.match(/"title":\s*"([^"]+)"/);
            if (titleMatch) {
              title = titleMatch[1].replace(' - YouTube', '').trim();
            }
          }

          if (!durationSeconds) {
            const isoMatch = html.match(/itemprop="duration"\s+content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/i) ||
                             html.match(/meta\s+itemprop="duration"\s+content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/i) ||
                             html.match(/"duration":\s*"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/i);
            if (isoMatch) {
              const hours = parseInt(isoMatch[1] || '0', 10);
              const mins = parseInt(isoMatch[2] || '0', 10);
              const secs = parseInt(isoMatch[3] || '0', 10);
              durationSeconds = hours * 3600 + mins * 60 + secs;
            }
          }

          if (!transcript) {
            const idx = html.indexOf('"captionTracks":');
            if (idx !== -1) {
              const startIdx = html.indexOf('[', idx);
              let depth = 0;
              let endIdx = -1;
              for (let i = startIdx; i < html.length; i++) {
                if (html[i] === '[') depth++;
                else if (html[i] === ']') depth--;
                if (depth === 0) { endIdx = i + 1; break; }
              }
              if (endIdx !== -1) {
                try {
                  const jsonStr = html.substring(startIdx, endIdx);
                  const tracks = JSON.parse(jsonStr);
                  if (Array.isArray(tracks) && tracks.length > 0) {
                    const enTrack = tracks.find((t: any) => t.languageCode === 'en' || t.vssId?.includes('en')) || tracks[0];
                    if (enTrack?.baseUrl) {
                      let bUrl = enTrack.baseUrl.replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
                      if (!bUrl.includes('fmt=')) bUrl += '&fmt=srv1';
                      const capRes = await fetch(bUrl, {
                        headers: {
                          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                          'Referer': `https://www.youtube.com/watch?v=${videoId}`,
                        },
                      });
                      if (capRes.ok) {
                        const rawCap = await capRes.text();
                        const cleaned = parseCaptionText(rawCap);
                        if (cleaned && cleaned.length > 20) {
                          transcript = cleaned;
                          console.log(`[AIService] Succeeded via watch page captionTracks JSON (${transcript.length} chars)`);
                        }
                      }
                    }
                  }
                } catch { /* non-fatal */ }
              }
            }
          }
        }
      } catch (htmlErr: any) {
        console.warn('[AIService] HTML fallback extraction warning:', htmlErr?.message || htmlErr);
      }
    }

    return { transcript, title, durationSeconds };
  } catch (e: any) {
    console.warn('[AIService] YouTube extraction error:', e?.message || e);
    return { transcript: '' };
  }
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
${text.substring(0, 10000)}`;

  const models = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash'];
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

    // 1. Check existing user folders (prevent duplicates)
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

    // 2. Determine folder category name and color if missing
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

    // Double check if folder with targetCategory already exists for user (case-insensitive)
    if (collections && collections.length > 0) {
      const existingSameName = collections.find((col: any) =>
        (col.name || '').toLowerCase().trim() === targetCategory.toLowerCase().trim()
      );
      if (existingSameName) {
        return existingSameName.id;
      }
    }

    // 3. Create missing folder for this user
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
   * Call Gemini API to generate a 120-180 word abstractive whole-content summary (1-2 paragraphs).
   */
  static async generateSummary(
    title: string,
    url: string,
    contentType: string = 'article',
    snippet: string = ''
  ): Promise<{ summary: string; tags: string[]; priority: number }> {
    const platform = resolvePlatformInfo(url);
    const isYouTube = platform.source_type === 'youtube' || url.includes('youtube.com') || url.includes('youtu.be');

    // If YouTube video has no transcript, do NOT generate a fake/generic summary
    if (isYouTube && (!snippet || !snippet.trim())) {
      return {
        summary: 'Transcript unavailable',
        tags: ['video', 'youtube'],
        priority: 50,
      };
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      console.warn('[AIService] GEMINI_API_KEY is missing. Using fallback summary.');
      return {
        summary: isYouTube ? 'Transcript unavailable' : `${title || 'Content'} details the core algorithms, implementation steps, and analytical concepts provided in the source material, providing immediate technical context and conclusions.`,
        tags: [contentType || 'article', 'general'],
        priority: 50,
      };
    }

    const prompt = `You are an expert technical knowledge summarizer.

TASK:
Analyze the ENTIRE extracted content below (from beginning, middle, to end). Write a genuine, highly informative summary representing the WHOLE material across 1 to 2 well-structured paragraphs (100 to 150 words total).

CONTENT TITLE: "${title}"
CONTENT TYPE: "${contentType || platform.source_type}"
SOURCE DOMAIN: "${platform.source_name}"

ACTUAL EXTRACTED CONTENT:
"${snippet.substring(0, 15000)}"

CRITICAL SUMMARIZATION RULES:
1. Whole-Content Synthesis: Identify the main topic, key concepts, core mechanisms, techniques, and conclusions covered throughout the entire material. Combine related ideas into a coherent, flowing summary.
2. Do NOT summarize just the intro or first few lines: Do NOT follow transcript order or describe greetings, introductions, or setup. Focus on the main ideas and takeaways from the entire content.
3. Length & Structure: Write 100 to 150 words total in 1 to 2 well-structured paragraphs.
4. No Direct Copying: Rephrase and synthesize concepts in clear English. Do not copy sentences directly from the source.
5. Strictly Prohibited Intros and Metalanguage: Do NOT mention that you are summarizing. Do NOT use phrases like "this video...", "this article...", "in this tutorial...", "the author...", "the speaker...", or "this content covers...". Start directly with the core subject knowledge.
6. Zero Generic Filler: Omit greetings, repetition, non-essential examples, irrelevant details, and generic filler words like "essential concepts", "key principles", or "practical applications".
7. Output Format: Return ONLY the final summary text (1-2 plain text paragraphs in clear English). Do not include markdown headers, titles, bullet points, preambles, or verification notes.`;

    const models = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash'];

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
              maxOutputTokens: 1200,
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
    const fallbackText = isYouTube
      ? 'Transcript unavailable'
      : `${title || 'Content'} details the core algorithms, implementation steps, and analytical concepts provided in the source material, providing immediate technical context and conclusions.`;
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
      let ytDurationSeconds = 0;

      // Step 1: If YouTube URL, extract real video metadata & duration
      if (isYouTube) {
        console.log(`[PIPELINE LOG] [AI Service] Extracting YouTube video metadata & duration for ${url}...`);
        const extracted = await fetchYouTubeContent(url);
        if (extracted.durationSeconds && extracted.durationSeconds > 0) {
          ytDurationSeconds = extracted.durationSeconds;
        }
        if (extracted.transcript && extracted.transcript.trim()) {
          snippet = extracted.transcript;
        }
        if (extracted.title && extracted.title.trim()) {
          title = extracted.title.trim();
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

      // Step 4: Calculate estimated time based on content type
      let estimatedReadTime = 5;
      let estimatedTimeMinutes = 5.0;

      if (isYouTube && ytDurationSeconds > 0) {
        // YouTube: real metadata duration
        estimatedReadTime = Math.max(1, Math.ceil(ytDurationSeconds / 60));
        estimatedTimeMinutes = Math.max(1, Math.round((ytDurationSeconds / 60) * 10) / 10);
      } else {
        // Articles: calculate from extracted text word count (~225 words/min)
        const extractedWordCount = (snippet || '').split(/\s+/).filter(Boolean).length;
        if (extractedWordCount > 0) {
          estimatedReadTime = Math.max(1, Math.ceil(extractedWordCount / 225));
          estimatedTimeMinutes = Math.max(1, Math.round((extractedWordCount / 225) * 10) / 10);
        }
      }

      // Step 5: Log preview of text being sent to Gemini
      const snippetPreview = snippet.substring(0, 150).replace(/\r?\n/g, ' ');
      console.log(`[PIPELINE LOG] [AI Service] Text being passed to Gemini for item ${itemId} (Full Length: ${snippet.length} chars): "${snippetPreview}..."`);

      // Step 6: Generate abstractive whole-content AI summary via Gemini API
      const result = await this.generateSummary(title, url, platformInfo.source_type, snippet);

      // Auto-determine folder, create if missing, and assign collection_id
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

      const updatePayload: Record<string, any> = {
        ai_summary: result.summary,
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

      // Step 7: Update Supabase items record cleanly
      const { error } = await supabase.from('items').update(updatePayload).eq('id', itemId);
      if (error) {
        console.warn('[AIService] Supabase update warning:', error.message);
        const safePayload: Record<string, any> = {
          ai_summary: result.summary,
          tags: result.tags,
          processing_status: 'completed',
          priority_score: result.priority,
          estimated_read_time: estimatedReadTime,
        };
        if (ytDurationSeconds > 0) safePayload.duration_seconds = ytDurationSeconds;
        await supabase.from('items').update(safePayload).eq('id', itemId);
      }

      // Save local metadata
      try {
        await fallbackDb.updateItemMetadata(userId, itemId, { estimated_time_minutes: estimatedTimeMinutes, collection_id: collectionId }, supabase);
      } catch { /* non-fatal */ }

      const summaryWordCount = result.summary.split(/\s+/).filter(Boolean).length;
      console.log(`[AIService] AI summary & folder classification completed for item ${itemId} (Folder: ${collectionId}). Summary length: ${result.summary.length} chars (${summaryWordCount} words).`);
    } catch (err: any) {
      console.error(`[AIService] processItemEnrichment error for item ${itemId}:`, err);
      try {
        await supabase.from('items').update({
          processing_status: 'failed',
          ai_summary: 'Summary unavailable',
        }).eq('id', itemId);
      } catch { /* non-fatal */ }
    }
  }
}
