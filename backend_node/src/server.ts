import app from './app';
import { fallbackDb } from './utils/schemaFallback';
import { startReminderScheduler } from './services/schedulerService';

const PORT = Number(process.env.PORT) || 8001;

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Server is running on port ${PORT}`);

  try {
    await fallbackDb.ready;
    const ok = await fallbackDb.verifySchemaTables();
    if (!ok) {
      console.error('[Server] FATAL: SQLite schema verification failed. Reminder scheduler will not start.');
      return;
    }
    await startReminderScheduler();
  } catch (err) {
    console.error('Failed to start reminder scheduler:', err);
  }
});
