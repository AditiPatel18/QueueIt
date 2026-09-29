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

    if (fs.existsSync(localBinLinux)) {
      return localBinLinux;
    }
    if (fs.existsSync(localBinWin)) {
      return localBinWin;
    }
    if (process.platform !== 'win32' && fs.existsSync('/usr/local/bin/yt-dlp')) {
      return '/usr/local/bin/yt-dlp';
    }

    return 'yt-dlp';
  }

  public static getYtDlpPath(): string {
    return this.resolveYtDlpPath();
  }

  public static getSubLangs(): string {
    return process.env.YTDLP_SUB_LANGS || 'en.*,en,hi.*,hi';
  }

  public static getTimeoutMs(): number {
    return parseInt(process.env.YTDLP_TIMEOUT_MS || '35000', 10);
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

  public static async extractYouTubeContent(url: string): Promise<YouTubeExtractionResult> {
    const videoId = this.extractVideoId(url);
    const ytDlpVersion = await this.getYtDlpVersion();

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
      console.log(`[YouTube Extract] Skipping videoId=${videoId} due to active exponential backoff (${waitSec}s remaining).`);
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

    console.log(`[YouTube Extract] ===== Starting YouTube Extraction =====`);
    console.log(`[YouTube Extract] Video URL: ${url}`);
    console.log(`[YouTube Extract] Video ID: ${videoId}`);
    console.log(`[YouTube Extract] yt-dlp Version: ${ytDlpVersion}`);

    const ytDlpPath = this.getYtDlpPath();
    const subLangs = this.getSubLangs();
    const timeoutMs = this.getTimeoutMs();
    const playerClient = this.getPlayerClient();

    const args = ['--dump-json', '--skip-download', '--no-warnings'];
    if (playerClient) {
      args.push('--extractor-args', `youtube:player_client=${playerClient}`);
    }
    args.push(url);

    let stdout = '';
    let stderr = '';
    let execError: any = null;

    try {
      console.log(`[YouTube Extract] Method: yt-dlp JSON metadata dump`);
      const res = await execFileAsync(ytDlpPath, args, { timeout: timeoutMs, maxBuffer: 15 * 1024 * 1024 });
      stdout = res.stdout || '';
      stderr = res.stderr || '';
    } catch (err: any) {
      execError = err;
      stdout = err?.stdout || '';
      stderr = err?.stderr || err?.message || String(err);
    }

    if (stderr) {
      console.log(`[YouTube Extract] yt-dlp stderr output:`, stderr.substring(0, 500));
    }

    if (execError && (!stdout || !stdout.trim())) {
      console.error(`[YouTube Extract] Failure: yt-dlp execution error for videoId=${videoId}:`, stderr);
      const is429 = stderr.includes('429') || stderr.toLowerCase().includes('too many requests');
      const is403 = stderr.includes('403') || stderr.toLowerCase().includes('forbidden') || stderr.toLowerCase().includes('please sign in');
      const isPoToken = stderr.toLowerCase().includes('bot') || stderr.toLowerCase().includes('po token') || stderr.toLowerCase().includes('js runtime');

      this.recordFailure(videoId, is429);

      let userMsg = 'YouTube video extraction failed';
      if (is429) userMsg = 'YouTube rate limit reached (HTTP 429). Please retry shortly.';
      else if (is403) userMsg = 'YouTube video requires sign-in or is restricted (HTTP 403).';
      else if (isPoToken) userMsg = 'YouTube anti-bot verification active for this video.';
      else if (stderr.includes('unavailable')) userMsg = 'YouTube video is unavailable or private.';

      return {
        success: false,
        videoId,
        url,
        extractionMethod: 'yt-dlp CLI',
        ytDlpVersion,
        transcriptLength: 0,
        error: userMsg,
        stderr: stderr.substring(0, 1000),
        isRateLimited: is429,
      };
    }

    let metadata: any = null;
    try {
      metadata = JSON.parse(stdout.trim());
    } catch (parseErr: any) {
      console.error(`[YouTube Extract] Failure: Failed to parse yt-dlp JSON output for videoId=${videoId}`);
      this.recordFailure(videoId, false);
      return {
        success: false,
        videoId,
        url,
        extractionMethod: 'yt-dlp JSON parse',
        ytDlpVersion,
        transcriptLength: 0,
        error: 'Failed to parse video metadata JSON from yt-dlp',
        stderr,
      };
    }

    const title = metadata?.title || metadata?.fulltitle || '';
    const durationSeconds = Math.round(metadata?.duration || metadata?.duration_seconds || 0);

    console.log(`[YouTube Extract] Extracted Metadata - Title: "${title}", Duration: ${durationSeconds}s`);

    const subtitles = metadata?.subtitles || {};
    const autoCaptions = metadata?.automatic_captions || {};

    console.log(`[YouTube Extract] Subtitle Languages Available: ${Object.keys(subtitles).join(', ') || 'none'}`);
    console.log(`[YouTube Extract] Auto Caption Languages Available: ${Object.keys(autoCaptions).join(', ') || 'none'}`);

    // Select caption track
    let chosenTrackFormats: any[] | null = null;
    let chosenLang = '';
    let chosenKind = '';

    const preferredLangs = ['en', 'en-US', 'en-GB', 'hi'];
    for (const lang of preferredLangs) {
      if (subtitles[lang]) {
        chosenTrackFormats = subtitles[lang];
        chosenLang = lang;
        chosenKind = 'manual';
        break;
      }
    }

    if (!chosenTrackFormats) {
      const manualKeys = Object.keys(subtitles);
      const enManualKey = manualKeys.find(k => k.startsWith('en'));
      if (enManualKey) {
        chosenTrackFormats = subtitles[enManualKey];
        chosenLang = enManualKey;
        chosenKind = 'manual';
      } else if (manualKeys.length > 0) {
        chosenTrackFormats = subtitles[manualKeys[0]];
        chosenLang = manualKeys[0];
        chosenKind = 'manual';
      }
    }

    if (!chosenTrackFormats) {
      for (const lang of preferredLangs) {
        if (autoCaptions[lang]) {
          chosenTrackFormats = autoCaptions[lang];
          chosenLang = lang;
          chosenKind = 'automatic';
          break;
        }
      }
    }

    if (!chosenTrackFormats) {
      const autoKeys = Object.keys(autoCaptions);
      const enAutoKey = autoKeys.find(k => k.startsWith('en'));
      if (enAutoKey) {
        chosenTrackFormats = autoCaptions[enAutoKey];
        chosenLang = enAutoKey;
        chosenKind = 'automatic';
      } else if (autoKeys.length > 0) {
        chosenTrackFormats = autoCaptions[autoKeys[0]];
        chosenLang = autoKeys[0];
        chosenKind = 'automatic';
      }
    }

    if (!chosenTrackFormats || !Array.isArray(chosenTrackFormats) || chosenTrackFormats.length === 0) {
      console.warn(`[YouTube Extract] Failure: No subtitle or caption tracks found for videoId=${videoId}`);
      this.recordFailure(videoId, false);
      return {
        success: false,
        videoId,
        url,
        title,
        durationSeconds,
        extractionMethod: 'yt-dlp track inspection',
        ytDlpVersion,
        transcriptLength: 0,
        error: 'No subtitles or captions available for this video.',
      };
    }

    console.log(`[YouTube Extract] Selected ${chosenKind} caption track for lang="${chosenLang}" (${chosenTrackFormats.length} format options)`);

    const vttFormat = chosenTrackFormats.find((f: any) => f.ext === 'vtt') ||
                      chosenTrackFormats.find((f: any) => f.ext === 'srv1') ||
                      chosenTrackFormats.find((f: any) => f.ext === 'json3') ||
                      chosenTrackFormats[0];

    if (!vttFormat || !vttFormat.url) {
      console.warn(`[YouTube Extract] Failure: Selected caption track has no valid download URL for videoId=${videoId}`);
      this.recordFailure(videoId, false);
      return {
        success: false,
        videoId,
        url,
        title,
        durationSeconds,
        extractionMethod: 'yt-dlp track URL',
        ytDlpVersion,
        transcriptLength: 0,
        error: 'Caption track format URL unavailable.',
      };
    }

    let rawCaptionContent = '';
    try {
      console.log(`[YouTube Extract] Fetching caption track URL (${vttFormat.ext || 'vtt'})...`);
      const capRes = await fetch(vttFormat.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Referer': 'https://www.youtube.com/',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (capRes.ok) {
        rawCaptionContent = await capRes.text();
      } else {
        console.warn(`[YouTube Extract] HTTP ${capRes.status} returned fetching caption track URL.`);
      }
    } catch (fetchErr: any) {
      console.warn(`[YouTube Extract] Direct fetch error for caption track:`, fetchErr?.message || fetchErr);
    }

    // Fallback: If direct fetch failed or returned empty, run yt-dlp subtitle download
    if (!rawCaptionContent || !rawCaptionContent.trim()) {
      console.log(`[YouTube Extract] Falling back to yt-dlp file-based subtitle download...`);
      const tempDir = path.join(process.cwd(), 'scratch');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const tempPrefix = path.join(tempDir, `yt_sub_${videoId}_${Date.now()}`);

      try {
        await execFileAsync(
          ytDlpPath,
          ['--write-sub', '--write-auto-sub', '--sub-lang', subLangs, '--skip-download', '--convert-subs', 'vtt', '--output', `${tempPrefix}`, url],
          { timeout: timeoutMs }
        );

        const createdFiles = fs.readdirSync(tempDir).filter(f => f.startsWith(path.basename(tempPrefix)));
        if (createdFiles.length > 0) {
          const firstSub = path.join(tempDir, createdFiles[0]);
          rawCaptionContent = fs.readFileSync(firstSub, 'utf-8');
          for (const f of createdFiles) {
            try { fs.unlinkSync(path.join(tempDir, f)); } catch {}
          }
        }
      } catch (subErr: any) {
        console.warn(`[YouTube Extract] Fallback yt-dlp subtitle download failed:`, subErr?.message || subErr);
      }
    }

    const cleanedTranscript = this.cleanVttCaptionText(rawCaptionContent);
    const transcriptLength = cleanedTranscript.length;

    if (!cleanedTranscript || transcriptLength < 20) {
      console.warn(`[YouTube Extract] Failure: Cleaned transcript is empty or too short (${transcriptLength} chars) for videoId=${videoId}`);
      this.recordFailure(videoId, false);
      return {
        success: false,
        videoId,
        url,
        title,
        durationSeconds,
        extractionMethod: 'yt-dlp caption cleaning',
        ytDlpVersion,
        transcriptLength: 0,
        error: 'Extracted transcript is empty or unreadable.',
      };
    }

    console.log(`[YouTube Extract] Extraction Success! Transcript Length: ${transcriptLength} chars.`);
    this.recordSuccess(videoId);

    return {
      success: true,
      videoId,
      url,
      title,
      durationSeconds,
      transcript: cleanedTranscript,
      extractionMethod: `yt-dlp (${chosenKind} ${chosenLang} captions)`,
      ytDlpVersion,
      transcriptLength,
    };
  }
}
