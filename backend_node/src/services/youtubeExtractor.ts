import { execFile } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = util.promisify(execFile);

export interface YouTubeExtractionResult {
  success: boolean;
  videoId: string;
  url: string;
  title?: string;
  durationSeconds?: number;
  transcript?: string;
  extractionMethod: string;
  ytDlpVersion: string;
  transcriptLength: number;
  error?: string;
  stderr?: string;
  isRateLimited?: boolean;
}

interface BackoffState {
  failureCount: number;
  backoffUntil: number;
  isRateLimited: boolean;
  reason?: string;
}

// In-memory exponential backoff map per videoId
const ytBackoffMap = new Map<string, BackoffState>();

// Global host-level rate limit state to protect the IP from being hammered
let globalYtRateLimitUntil = 0;
let globalRateLimitCount = 0;

// In-flight extraction requests to prevent multiple concurrent yt-dlp calls for the same video
const activeExtractions = new Set<string>();

export interface YtDlpDiagnosticInfo {
  available: boolean;
  resolvedPath: string;
  version: string;
  error?: string;
}

export class YouTubeExtractor {
  public static execRunner = (file: string, args: string[], options: any): Promise<{ stdout: string; stderr: string }> =>
    execFileAsync(file, args, options) as any;

  public static isGlobalRateLimited(): boolean {
    if (Date.now() < globalYtRateLimitUntil) {
      return true;
    }
    if (globalYtRateLimitUntil > 0) {
      globalYtRateLimitUntil = 0;
    }
    return false;
  }

  public static getGlobalRateLimitRemainingSec(): number {
    if (Date.now() < globalYtRateLimitUntil) {
      return Math.ceil((globalYtRateLimitUntil - Date.now()) / 1000);
    }
    return 0;
  }

  public static resetGlobalRateLimit(): void {
    globalYtRateLimitUntil = 0;
    globalRateLimitCount = 0;
  }

  public static resolveYtDlpPath(): string {
    if (process.env.YTDLP_PATH && process.env.YTDLP_PATH.trim()) {
      return process.env.YTDLP_PATH.trim();
    }

    const rootDir = process.cwd();
    const localBinLinux = path.join(rootDir, 'bin', 'yt-dlp');
    const localBinWin = path.join(rootDir, 'bin', 'yt-dlp.exe');

    if (process.platform === 'win32') {
      if (fs.existsSync(localBinWin)) {
        return localBinWin;
      }
      return 'yt-dlp';
    } else {
      if (fs.existsSync('/opt/yt-dlp-venv/bin/yt-dlp')) {
        return '/opt/yt-dlp-venv/bin/yt-dlp';
      }
      if (fs.existsSync('/usr/local/bin/yt-dlp')) {
        return '/usr/local/bin/yt-dlp';
      }
      if (fs.existsSync(localBinLinux)) {
        return localBinLinux;
      }
      return 'yt-dlp';
    }
  }

  public static getYtDlpPath(): string {
    return this.resolveYtDlpPath();
  }

  public static getSubLangs(): string {
    return process.env.YTDLP_SUB_LANGS || 'en,en-US,en-GB';
  }

  public static getMetadataTimeoutMs(): number {
    return parseInt(process.env.YTDLP_META_TIMEOUT_MS || '12000', 10);
  }

  public static getSubtitlesTimeoutMs(): number {
    return parseInt(process.env.YTDLP_SUB_TIMEOUT_MS || '18000', 10);
  }

  public static getTimeoutMs(): number {
    return parseInt(process.env.YTDLP_TIMEOUT_MS || '25000', 10);
  }

  public static getPlayerClient(): string | null {
    return process.env.YTDLP_PLAYER_CLIENT || null;
  }

  public static async getYtDlpVersion(): Promise<string> {
    try {
      const { stdout } = await this.execRunner(this.getYtDlpPath(), ['--version'], { timeout: 5000 });
      return (stdout || '').trim();
    } catch {
      return 'unknown';
    }
  }

  public static async checkYtDlpAvailability(): Promise<YtDlpDiagnosticInfo> {
    const resolvedPath = this.resolveYtDlpPath();
    try {
      const { stdout } = await this.execRunner(resolvedPath, ['--version'], { timeout: 5000 });
      const version = (stdout || '').trim();
      if (version) {
        return { available: true, resolvedPath, version };
      } else {
        return { available: false, resolvedPath, version: 'unknown', error: 'yt-dlp returned empty output' };
      }
    } catch (err: any) {
      const stderr = err?.stderr ? String(err.stderr).trim() : '';
      const message = err?.message ? String(err.message).trim() : String(err);
      const detailedError = stderr ? `${message} | stderr: ${stderr}` : message;
      return {
        available: false,
        resolvedPath,
        version: 'unavailable',
        error: detailedError,
      };
    }
  }

  public static extractVideoId(url: string): string | null {
    if (!url) return null;
    const match = url.match(/(?:v=|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  public static isVideoInBackoff(videoId: string): {
    inBackoff: boolean;
    backoffUntil?: number;
    isRateLimited?: boolean;
    reason?: string;
  } {
    const state = ytBackoffMap.get(videoId);
    if (!state) return { inBackoff: false };
    if (Date.now() < state.backoffUntil) {
      return {
        inBackoff: true,
        backoffUntil: state.backoffUntil,
        isRateLimited: state.isRateLimited,
        reason: state.reason,
      };
    }
    ytBackoffMap.delete(videoId);
    return { inBackoff: false };
  }

  public static recordFailure(videoId: string, isRateLimited: boolean, reason?: string): void {
    const existing = ytBackoffMap.get(videoId) || { failureCount: 0, backoffUntil: 0, isRateLimited: false };
    const count = existing.failureCount + 1;

    let delayMs = 0;
    if (isRateLimited) {
      globalRateLimitCount = Math.min(globalRateLimitCount + 1, 5);
      // Exponential backoff with jitter: 3 min (1st), 7 min (2nd), 15 min (3rd+)
      const baseDelayMs = globalRateLimitCount === 1 ? 3 * 60 * 1000 : globalRateLimitCount === 2 ? 7 * 60 * 1000 : 15 * 60 * 1000;
      const jitterMs = Math.floor(Math.random() * 30000); // 0-30s random jitter
      delayMs = baseDelayMs + jitterMs;
      globalYtRateLimitUntil = Math.max(globalYtRateLimitUntil, Date.now() + delayMs);
    } else {
      // Non-rate-limited failure: short circuit-breaker cooldown (15 sec, 30 sec, 60 sec)
      delayMs = count === 1 ? 15 * 1000 : count === 2 ? 30 * 1000 : 60 * 1000;
    }

    const backoffUntil = Date.now() + delayMs;
    ytBackoffMap.set(videoId, { failureCount: count, backoffUntil, isRateLimited, reason });
  }

  public static clearBackoff(videoId: string): void {
    ytBackoffMap.delete(videoId);
  }

  public static recordSuccess(videoId: string): void {
    ytBackoffMap.delete(videoId);
    globalRateLimitCount = Math.max(0, globalRateLimitCount - 1);
    if (globalRateLimitCount === 0) {
      globalYtRateLimitUntil = 0;
    }
  }

  public static cleanVttCaptionText(rawVtt: string): string {
    if (!rawVtt || !rawVtt.trim()) return '';
    const lines = rawVtt.split(/\r?\n/);
    const textLines: string[] = [];
    for (let line of lines) {
      line = line.trim();
      if (
        !line ||
        line.startsWith('WEBVTT') ||
        line.startsWith('Kind:') ||
        line.startsWith('Language:') ||
        line.startsWith('NOTE') ||
        line.includes('-->') ||
        /^\d+$/.test(line)
      ) {
        continue;
      }
      // Remove VTT cue formatting tags <c>, <b>, <i>, <00:00:00.000>
      let cleaned = line.replace(/<[^>]+>/g, '');
      // Unescape HTML entities
      cleaned = cleaned
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/♪/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (cleaned && (textLines.length === 0 || textLines[textLines.length - 1] !== cleaned)) {
        textLines.push(cleaned);
      }
    }
    return textLines.join(' ').replace(/\s+/g, ' ').trim();
  }

  public static async extractYouTubeContent(
    url: string,
    options?: { signal?: AbortSignal; itemId?: string }
  ): Promise<YouTubeExtractionResult> {
    const videoId = this.extractVideoId(url);
    const logPrefix = options?.itemId ? `[Item ${options.itemId}] [YouTube]` : `[YouTube Extract]`;

    if (!videoId) {
      return {
        success: false,
        videoId: '',
        url,
        extractionMethod: 'yt-dlp',
        ytDlpVersion: 'unknown',
        transcriptLength: 0,
        error: 'Invalid YouTube URL: Could not extract video ID',
      };
    }

    // 1. Check in-flight concurrent extractions for the exact same video
    if (activeExtractions.has(videoId)) {
      console.warn(`${logPrefix} Extraction for videoId=${videoId} is already in progress.`);
      return {
        success: false,
        videoId,
        url,
        extractionMethod: 'yt-dlp (concurrent lock)',
        ytDlpVersion: 'unknown',
        transcriptLength: 0,
        error: 'Extraction already in progress for this video. Please wait.',
      };
    }

    // 2. Check global server-level rate limit
    if (this.isGlobalRateLimited()) {
      const waitSec = this.getGlobalRateLimitRemainingSec();
      const waitMin = Math.ceil(waitSec / 60);
      const errorMsg = `Extraction paused due to YouTube rate limits on this server (HTTP 429). Retrying in ${waitMin}m.`;
      console.log(`${logPrefix} Skipping videoId=${videoId} due to active global server cooldown (${waitSec}s remaining).`);
      return {
        success: false,
        videoId,
        url,
        extractionMethod: 'yt-dlp (global cooldown active)',
        ytDlpVersion: 'unknown',
        transcriptLength: 0,
        error: errorMsg,
        isRateLimited: true,
      };
    }

    // 3. Check per-video cooldown
    const { inBackoff, backoffUntil, isRateLimited: backoffIsRateLimit, reason: backoffReason } = this.isVideoInBackoff(videoId);
    if (inBackoff && backoffUntil) {
      const waitSec = Math.ceil((backoffUntil - Date.now()) / 1000);
      console.log(`${logPrefix} Skipping videoId=${videoId} due to active cooldown (${waitSec}s remaining, rateLimited=${Boolean(backoffIsRateLimit)}).`);
      const errorMsg = backoffIsRateLimit
        ? `Extraction paused due to YouTube rate limits. Retrying in ${Math.ceil(waitSec / 60)}m.`
        : (backoffReason || `Extraction temporarily on cooldown. Retrying in ${waitSec}s.`);

      return {
        success: false,
        videoId,
        url,
        extractionMethod: 'yt-dlp (cooldown active)',
        ytDlpVersion: 'unknown',
        transcriptLength: 0,
        error: errorMsg,
        isRateLimited: Boolean(backoffIsRateLimit),
      };
    }

    activeExtractions.add(videoId);

    try {
      const ytDlpPath = this.getYtDlpPath();
      const ytDlpVersion = await this.getYtDlpVersion();
      const subLangs = this.getSubLangs();
      const metaTimeoutMs = this.getMetadataTimeoutMs();
      const subTimeoutMs = this.getSubtitlesTimeoutMs();
      const playerClient = this.getPlayerClient();

      // ── STAGE 1: METADATA EXTRACTION (Bounded to 12s) ──────────────────────
      console.log(`${logPrefix} [Stage: YOUTUBE_META_STARTED] Video ID: ${videoId}, yt-dlp: ${ytDlpPath} (${ytDlpVersion})`);
      const metaArgs = [
        '--print', '%(id)s|||%(duration)s|||%(title)s',
        '--no-playlist',
        '--socket-timeout', '10',
        '--extractor-retries', '1',
        '--skip-download',
        '--no-warnings',
      ];
      if (playerClient) {
        metaArgs.push('--extractor-args', `youtube:player_client=${playerClient}`);
      }
      metaArgs.push(url);

      let title = '';
      let durationSeconds = 0;

      const parseMetaOutput = (metaOutput: string) => {
        const parts = metaOutput.trim().split('|||');
        if (parts.length >= 3) {
          durationSeconds = parseInt(parts[1], 10) || 0;
          title = parts.slice(2).join('|||').trim();
        } else if (parts.length === 2) {
          durationSeconds = parseInt(parts[0], 10) || 0;
          title = parts[1].trim();
        }
      };

      try {
        const metaRes = await this.execRunner(ytDlpPath, metaArgs, {
          timeout: metaTimeoutMs,
          signal: options?.signal,
        });
        parseMetaOutput(metaRes.stdout || '');
        if (title) {
          console.log(`${logPrefix} [Stage: YOUTUBE_META_COMPLETED] Title: "${title}", Duration: ${durationSeconds}s`);
        }
      } catch (metaErr: any) {
        const stderr = metaErr?.stderr ? String(metaErr.stderr).trim() : metaErr?.message || String(metaErr);
        console.warn(`${logPrefix} Metadata extraction note: ${stderr.substring(0, 300)}`);

        const is429 = stderr.includes('429') || stderr.toLowerCase().includes('too many requests');
        if (is429) {
          console.warn(`${logPrefix} [Stage: YOUTUBE_META_FAILED] YouTube rate limit reached (HTTP 429). Halting extraction to avoid repeated requests.`);

          // Fast oEmbed fallback for title only (does not hit yt-dlp)
          if (!title) {
            try {
              const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
                signal: AbortSignal.timeout(4000),
              });
              if (oembedRes.ok) {
                const oembedData: any = await oembedRes.json();
                if (oembedData?.title) {
                  title = String(oembedData.title).trim();
                  console.log(`${logPrefix} [Stage: YOUTUBE_META_OEMBED] Title from oembed: "${title}"`);
                }
              }
            } catch { /* non-fatal */ }
          }

          const userMsg = 'YouTube rate limit reached (HTTP 429). Server extraction is temporarily cooling down.';
          this.recordFailure(videoId, true, userMsg);
          return {
            success: false,
            videoId,
            url,
            title,
            durationSeconds: 0,
            extractionMethod: 'yt-dlp metadata (rate-limited)',
            ytDlpVersion,
            transcriptLength: 0,
            error: userMsg,
            stderr: stderr.substring(0, 500),
            isRateLimited: true,
          };
        }

        const isUnavailable = stderr.toLowerCase().includes('unavailable') || stderr.toLowerCase().includes('private video');
        if (isUnavailable) {
          this.recordFailure(videoId, false, 'YouTube video is unavailable or private.');
          return {
            success: false,
            videoId,
            url,
            extractionMethod: 'yt-dlp metadata',
            ytDlpVersion,
            transcriptLength: 0,
            error: 'YouTube video is unavailable or private.',
            stderr: stderr.substring(0, 500),
            isRateLimited: false,
          };
        }

        // Fallback: If playerClient was passed and failed (non-429), try standard default args immediately
        if (playerClient) {
          try {
            const fallbackMetaArgs = [
              '--print', '%(id)s|||%(duration)s|||%(title)s',
              '--no-playlist',
              '--socket-timeout', '10',
              '--extractor-retries', '1',
              '--skip-download',
              '--no-warnings',
              url,
            ];
            const fallbackRes = await this.execRunner(ytDlpPath, fallbackMetaArgs, {
              timeout: metaTimeoutMs,
              signal: options?.signal,
            });
            parseMetaOutput(fallbackRes.stdout || '');
            if (title) {
              console.log(`${logPrefix} [Stage: YOUTUBE_META_COMPLETED] (Fallback) Title: "${title}", Duration: ${durationSeconds}s`);
            }
          } catch { /* proceed to oembed fallback */ }
        }
      }

      // Fast oEmbed fallback for title if yt-dlp metadata returned empty
      if (!title) {
        try {
          const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
            signal: AbortSignal.timeout(4000),
          });
          if (oembedRes.ok) {
            const oembedData: any = await oembedRes.json();
            if (oembedData?.title) {
              title = String(oembedData.title).trim();
              console.log(`${logPrefix} [Stage: YOUTUBE_META_OEMBED] Title from oembed: "${title}"`);
            }
          }
        } catch { /* non-fatal */ }
      }

      if (options?.signal?.aborted) {
        return {
          success: false,
          videoId,
          url,
          title,
          durationSeconds,
          extractionMethod: 'yt-dlp',
          ytDlpVersion,
          transcriptLength: 0,
          error: 'Operation aborted',
        };
      }

      // ── STAGE 2: SUBTITLE EXTRACTION (Bounded to 18s) ──────────────────────
      console.log(`${logPrefix} [Stage: YOUTUBE_SUBTITLES_STARTED] Requesting subs (${subLangs})...`);
      const tempDir = path.join(process.cwd(), 'scratch');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const tempPrefix = path.join(tempDir, `yt_sub_${videoId}_${Date.now()}`);

      const subArgs = [
        '--write-sub',
        '--write-auto-sub',
        '--sub-lang', subLangs,
        '--skip-download',
        '--sub-format', 'vtt',
        '--no-playlist',
        '--socket-timeout', '10',
        '--extractor-retries', '1',
        '-o', `${tempPrefix}.%(ext)s`,
      ];
      if (playerClient) {
        subArgs.push('--extractor-args', `youtube:player_client=${playerClient}`);
      }
      subArgs.push(url);

      let rawCaptionContent = '';
      let subStderr = '';
      try {
        await this.execRunner(ytDlpPath, subArgs, {
          timeout: subTimeoutMs,
          signal: options?.signal,
        });
      } catch (subErr: any) {
        subStderr = subErr?.stderr ? String(subErr.stderr).trim() : subErr?.message || String(subErr);
        console.log(`${logPrefix} Subtitle process note: ${subStderr.substring(0, 300)}`);
      }

      try {
        if (fs.existsSync(tempDir)) {
          const prefixBase = path.basename(tempPrefix);
          const createdFiles = fs.readdirSync(tempDir).filter((f) => f.startsWith(prefixBase));
          if (createdFiles.length > 0) {
            const enFile = createdFiles.find((f) => f.includes('.en.') || f.endsWith('.en.vtt'));
            const hiFile = createdFiles.find((f) => f.includes('.hi.') || f.endsWith('.hi.vtt') || f.includes('.hi-orig.') || f.endsWith('.hi-orig.vtt'));
            const chosenFile = enFile || hiFile || createdFiles[0];
            rawCaptionContent = fs.readFileSync(path.join(tempDir, chosenFile), 'utf-8');

            for (const f of createdFiles) {
              try { fs.unlinkSync(path.join(tempDir, f)); } catch {}
            }
          }
        }
      } catch (fsErr) {
        console.warn(`${logPrefix} File cleanup error:`, fsErr);
      }

      // Check if primary subtitle request hit HTTP 429
      const isPrimary429 = subStderr.includes('429') || subStderr.toLowerCase().includes('too many requests');
      if (isPrimary429) {
        console.warn(`${logPrefix} [Stage: YOUTUBE_SUBTITLES_FAILED] Primary subtitles hit YouTube rate limit (HTTP 429). Skipping fallback subtitle extraction to avoid hammering.`);
        const userMsg = 'YouTube rate limit reached (HTTP 429). Please retry shortly.';
        this.recordFailure(videoId, true, userMsg);
        return {
          success: false,
          videoId,
          url,
          title,
          durationSeconds,
          extractionMethod: 'yt-dlp subtitles (rate-limited)',
          ytDlpVersion,
          transcriptLength: 0,
          error: userMsg,
          stderr: subStderr.substring(0, 500),
          isRateLimited: true,
        };
      }

      // Fallback subtitle extraction: ONLY if primary sub request yielded no files AND was NOT rate-limited
      if (!rawCaptionContent && !options?.signal?.aborted) {
        console.log(`${logPrefix} [Stage: YOUTUBE_SUBTITLES_FALLBACK] Primary subs unavailable. Attempting native captions (hi-orig,hi,en.*)...`);
        const fbPrefix = path.join(tempDir, `yt_sub_fb_${videoId}_${Date.now()}`);
        const fallbackSubArgs = [
          '--write-sub',
          '--write-auto-sub',
          '--sub-lang', 'hi-orig,hi,en.*',
          '--skip-download',
          '--sub-format', 'vtt',
          '--no-playlist',
          '--socket-timeout', '10',
          '--extractor-retries', '1',
          '-o', `${fbPrefix}.%(ext)s`,
        ];
        if (playerClient) {
          fallbackSubArgs.push('--extractor-args', `youtube:player_client=${playerClient}`);
        }
        fallbackSubArgs.push(url);

        try {
          await this.execRunner(ytDlpPath, fallbackSubArgs, {
            timeout: subTimeoutMs,
            signal: options?.signal,
          });
        } catch (fbErr: any) {
          const fbStderr = fbErr?.stderr ? String(fbErr.stderr).trim() : fbErr?.message || String(fbErr);
          if (fbStderr) subStderr = `${subStderr} | ${fbStderr}`.trim();
          console.log(`${logPrefix} Fallback subtitle process note: ${fbStderr.substring(0, 300)}`);
        }

        try {
          if (fs.existsSync(tempDir)) {
            const fbPrefixBase = path.basename(fbPrefix);
            const fbFiles = fs.readdirSync(tempDir).filter((f) => f.startsWith(fbPrefixBase));
            if (fbFiles.length > 0) {
              const enFile = fbFiles.find((f) => f.includes('.en.') || f.endsWith('.en.vtt'));
              const hiFile = fbFiles.find((f) => f.includes('.hi.') || f.endsWith('.hi.vtt') || f.includes('.hi-orig.') || f.endsWith('.hi-orig.vtt'));
              const chosenFile = enFile || hiFile || fbFiles[0];
              rawCaptionContent = fs.readFileSync(path.join(tempDir, chosenFile), 'utf-8');

              for (const f of fbFiles) {
                try { fs.unlinkSync(path.join(tempDir, f)); } catch {}
              }
            }
          }
        } catch (fsErr) {
          console.warn(`${logPrefix} Fallback file cleanup error:`, fsErr);
        }
      }

      const cleanedTranscript = this.cleanVttCaptionText(rawCaptionContent);
      const transcriptLength = cleanedTranscript.length;

      if (!cleanedTranscript || transcriptLength < 20) {
        console.warn(`${logPrefix} [Stage: YOUTUBE_SUBTITLES_FAILED] No usable transcript available (${transcriptLength} chars).`);

        const is429 = subStderr.includes('429') || subStderr.toLowerCase().includes('too many requests');
        const isBot = subStderr.toLowerCase().includes('bot') || subStderr.toLowerCase().includes('po_token') || subStderr.toLowerCase().includes('sign in to confirm');
        const is403 = subStderr.toLowerCase().includes('403') || subStderr.toLowerCase().includes('forbidden') || subStderr.toLowerCase().includes('please sign in');

        let userMsg = 'No subtitles or captions available for this video.';
        if (is429) {
          userMsg = 'YouTube rate limit reached (HTTP 429). Please retry shortly.';
        } else if (isBot || is403) {
          userMsg = 'YouTube anti-bot verification or sign-in required for captions on this video.';
        }

        this.recordFailure(videoId, is429, userMsg);
        return {
          success: false,
          videoId,
          url,
          title,
          durationSeconds,
          extractionMethod: 'yt-dlp',
          ytDlpVersion,
          transcriptLength: 0,
          error: userMsg,
          stderr: subStderr.substring(0, 500),
          isRateLimited: is429,
        };
      }

      console.log(`${logPrefix} [Stage: YOUTUBE_SUBTITLES_COMPLETED] Transcript length: ${transcriptLength} chars.`);
      this.recordSuccess(videoId);

      return {
        success: true,
        videoId,
        url,
        title,
        durationSeconds,
        transcript: cleanedTranscript,
        extractionMethod: 'yt-dlp captions',
        ytDlpVersion,
        transcriptLength,
      };
    } finally {
      activeExtractions.delete(videoId);
    }
  }
}
