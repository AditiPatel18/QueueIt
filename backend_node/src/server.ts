import app from './app';
import { startReminderScheduler } from './services/schedulerService';

const PORT = process.env.PORT || 8001;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);

  // Start background reminder scheduler & worker queue
  startReminderScheduler().catch(err => {
    console.error('Failed to start reminder scheduler:', err);
  });
});
