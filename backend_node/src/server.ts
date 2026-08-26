import app from './app';
import { fallbackDb } from './utils/schemaFallback';
import { startReminderScheduler, startNotificationQueueWorker } from './services/schedulerService';

const PORT = Number(process.env.PORT) || 8001;

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Server is running on port ${PORT}`);

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
