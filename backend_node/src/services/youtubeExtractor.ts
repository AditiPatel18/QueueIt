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
}

// In-memory exponential backoff map per videoId
const ytBackoffMap = new Map<string, BackoffState>();

export interface YtDlpDiagnosticInfo {
  available: boolean;
  resolvedPath: string;
  version: string;
  error?: string;
}

export class YouTubeExtractor {
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
      const { stdout } = await execFileAsync(this.getYtDlpPath(), ['--version'], { timeout: 5000 });
      return (stdout || '').trim();
    } catch {
      return 'unknown';
    }
  }

  public static async checkYtDlpAvailability(): Promise<YtDlpDiagnosticInfo> {
    const resolvedPath = this.resolveYtDlpPath();
    try {
      const { stdout } = await execFileAsync(resolvedPath, ['--version'], { timeout: 5000 });
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

  public static isVideoInBackoff(videoId: string): { inBackoff: boolean; backoffUntil?: number } {
    const state = ytBackoffMap.get(videoId);
    if (!state) return { inBackoff: false };
    if (Date.now() < state.backoffUntil) {
      return { inBackoff: true, backoffUntil: state.backoffUntil };
    }
    ytBackoffMap.delete(videoId);
    return { inBackoff: false };
  }

  public static recordFailure(videoId: string, isRateLimited: boolean): void {
    const existing = ytBackoffMap.get(videoId) || { failureCount: 0, backoffUntil: 0 };
    const count = existing.failureCount + 1;
    // Exponential backoff: 1 min, 3 min, 10 min
    const delayMinutes = isRateLimited ? (count === 1 ? 2 : count === 2 ? 5 : 15) : (count === 1 ? 1 : count === 2 ? 3 : 10);
    const backoffUntil = Date.now() + delayMinutes * 60 * 1000;
    ytBackoffMap.set(videoId, { failureCount: count, backoffUntil });
  }

  public static recordSuccess(videoId: string): void {
    ytBackoffMap.delete(videoId);
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
    const ytDlpVersion = await this.getYtDlpVersion();
    const logPrefix = options?.itemId ? `[Item ${options.itemId}] [YouTube]` : `[YouTube Extract]`;

    if (!videoId) {
      return {
        success: false,
        videoId: '',
        url,
        extractionMethod: 'yt-dlp',
        ytDlpVersion,
        transcriptLength: 0,
        error: 'Invalid YouTube URL: Could not extract video ID',
      };
    }

    const { inBackoff, backoffUntil } = this.isVideoInBackoff(videoId);
    if (inBackoff && backoffUntil) {
      const waitSec = Math.ceil((backoffUntil - Date.now()) / 1000);
      console.log(`${logPrefix} Skipping videoId=${videoId} due to active exponential backoff (${waitSec}s remaining).`);
      return {
        success: false,
        videoId,
        url,
        extractionMethod: 'yt-dlp (backoff active)',
        ytDlpVersion,
        transcriptLength: 0,
        error: `Extraction paused due to YouTube rate limits or errors. Retrying in ${Math.ceil(waitSec / 60)}m.`,
        isRateLimited: true,
      };
    }

    const ytDlpPath = this.getYtDlpPath();
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
      const metaRes = await execFileAsync(ytDlpPath, metaArgs, {
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

      // Fallback: If playerClient was passed and failed, try standard default args immediately
      if (playerClient) {
        try {
          const fallbackMetaArgs = [
            '--print', '%(id)s|||%(duration)s|||%(title)s',
            '--no-playlist',
            '--socket-timeout', '10',
            '--skip-download',
            '--no-warnings',
            url,
          ];
          const fallbackRes = await execFileAsync(ytDlpPath, fallbackMetaArgs, {
            timeout: metaTimeoutMs,
            signal: options?.signal,
          });
          parseMetaOutput(fallbackRes.stdout || '');
          if (title) {
            console.log(`${logPrefix} [Stage: YOUTUBE_META_COMPLETED] (Fallback) Title: "${title}", Duration: ${durationSeconds}s`);
          }
        } catch { /* proceed to oembed fallback */ }
      }

      const is429 = stderr.includes('429') || stderr.toLowerCase().includes('too many requests');
      const is403 = stderr.includes('403') || stderr.toLowerCase().includes('forbidden') || stderr.toLowerCase().includes('please sign in');
      const isBot = stderr.toLowerCase().includes('bot') || stderr.toLowerCase().includes('po_token') || stderr.toLowerCase().includes('sign in to confirm');
      const isUnavailable = stderr.toLowerCase().includes('unavailable') || stderr.toLowerCase().includes('private video');

      if (is429 || is403 || isBot || isUnavailable) {
        this.recordFailure(videoId, is429);
        let userMsg = 'YouTube video extraction failed';
        if (isBot) userMsg = 'YouTube anti-bot verification active for this video.';
        else if (is429) userMsg = 'YouTube rate limit reached (HTTP 429). Please retry shortly.';
        else if (is403) userMsg = 'YouTube video requires sign-in or is age/region-restricted (HTTP 403).';
        else if (isUnavailable) userMsg = 'YouTube video is unavailable or private.';

        return {
          success: false,
          videoId,
          url,
          extractionMethod: 'yt-dlp metadata',
          ytDlpVersion,
          transcriptLength: 0,
          error: userMsg,
          stderr: stderr.substring(0, 500),
          isRateLimited: is429,
        };
      }
    }

    // Fast oEmbed fallback for title if yt-dlp metadata returned empty
    if (!title) {
      try {
        const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
          signal: AbortSignal.timeout(3000),
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
      '--no-abort-on-error',
      '-o', `${tempPrefix}.%(ext)s`,
    ];
    if (playerClient) {
      subArgs.push('--extractor-args', `youtube:player_client=${playerClient}`);
    }
    subArgs.push(url);

    let rawCaptionContent = '';
    try {
      await execFileAsync(ytDlpPath, subArgs, {
        timeout: subTimeoutMs,
        signal: options?.signal,
      });
    } catch (subErr: any) {
      console.log(`${logPrefix} Subtitle process note: ${subErr?.message || subErr}`);
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

    // Fallback subtitle extraction: If primary sub request yielded no files (e.g. 429 on auto-translate or no English track), try native original captions
    if (!rawCaptionContent && !options?.signal?.aborted) {
      console.log(`${logPrefix} [Stage: YOUTUBE_SUBTITLES_FALLBACK] Primary subs unavailable. Attempting native captions (hi-orig,hi)...`);
      const fbPrefix = path.join(tempDir, `yt_sub_fb_${videoId}_${Date.now()}`);
      const fallbackSubArgs = [
        '--write-sub',
        '--write-auto-sub',
        '--sub-lang', 'hi-orig,hi,en.*',
        '--skip-download',
        '--sub-format', 'vtt',
        '--no-playlist',
        '--socket-timeout', '10',
        '--no-abort-on-error',
        '-o', `${fbPrefix}.%(ext)s`,
      ];
      if (playerClient) {
        fallbackSubArgs.push('--extractor-args', `youtube:player_client=${playerClient}`);
      }
      fallbackSubArgs.push(url);

      try {
        await execFileAsync(ytDlpPath, fallbackSubArgs, {
          timeout: subTimeoutMs,
          signal: options?.signal,
        });
      } catch (fbErr: any) {
        console.log(`${logPrefix} Fallback subtitle process note: ${fbErr?.message || fbErr}`);
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
      this.recordFailure(videoId, false);
      return {
        success: false,
        videoId,
        url,
        title,
        durationSeconds,
        extractionMethod: 'yt-dlp',
        ytDlpVersion,
        transcriptLength: 0,
        error: 'No subtitles or captions available for this video.',
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
  }
}
