import { Router } from 'express';
import { YouTubeExtractor } from '../services/youtubeExtractor';

const router = Router();

router.get('/', async (req, res) => {
  const diag = await YouTubeExtractor.checkYtDlpAvailability();
  res.json({
    status: 'ok',
    ytDlpAvailable: diag.available,
    ytDlpResolvedPath: diag.resolvedPath,
    ytDlpVersion: diag.version,
    ...(diag.error ? { ytDlpError: diag.error } : {}),
  });
});

export default router;

