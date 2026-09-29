import app from './app';
import { fallbackDb } from './utils/schemaFallback';
import { startReminderScheduler, startNotificationQueueWorker } from './services/schedulerService';
import { YouTubeExtractor } from './services/youtubeExtractor';

const PORT = Number(process.env.PORT) || 10000;

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Server is running on port ${PORT}`);

  // Check yt-dlp executable availability & version
  try {
    const diag = await YouTubeExtractor.checkYtDlpAvailability();
    if (diag.available) {
      console.log(`[YouTubeExtractor] Executable ready. Path: "${diag.resolvedPath}", Version: "${diag.version}"`);
    } else {
      console.error(`[YouTubeExtractor] PRODUCTION CONFIGURATION ERROR: yt-dlp binary is missing or not executable! Resolved path: "${diag.resolvedPath}". Error: ${diag.error || 'Unknown error'}`);
    }
  } catch (diagErr) {
    console.error('[YouTubeExtractor] Error checking yt-dlp availability at startup:', diagErr);
  }

  try {
    await fallbackDb.ready;
    if (!fallbackDb.initialized) {
      console.error('[Server] FATAL: fallbackDb.initialized is false. Scheduler & worker will not start.');
      return;
    }
    const ok = await fallbackDb.verifyRequiredTables();
    if (!ok) {
      console.error('[Server] FATAL: SQLite schema verification failed. Scheduler & worker will not start.');
      return;
    }
    await startReminderScheduler();
    await startNotificationQueueWorker();
  } catch (err) {
    console.error('[Server] Error during service startup:', err);
  }
});

