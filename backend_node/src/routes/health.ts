import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()),
    geminiKeyPrefix: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 6) + '...' : 'MISSING',
  });
});

router.get('/test-yt', async (req, res) => {
  const url = (req.query.url as string) || 'https://www.youtube.com/watch?v=bEjSsm0nNtw';
  try {
    const { AIService } = require('../services/aiService');
    const result = await AIService.extractYouTubeContent(url);
    return res.json({ url, result });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || String(err), stack: err?.stack });
  }
});

export default router;
