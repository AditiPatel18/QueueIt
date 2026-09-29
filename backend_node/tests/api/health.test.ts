import request from 'supertest';
import app from '../../src/app';
import { YouTubeExtractor } from '../../src/services/youtubeExtractor';

describe('Health Diagnostic API Endpoint Tests', () => {
  it('GET /api/health should return status ok and yt-dlp diagnostic fields', async () => {
    jest.spyOn(YouTubeExtractor, 'checkYtDlpAvailability').mockResolvedValueOnce({
      available: true,
      resolvedPath: '/usr/local/bin/yt-dlp',
      version: '2026.08.19',
    });

    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.ytDlpAvailable).toBe(true);
    expect(res.body.ytDlpResolvedPath).toBe('/usr/local/bin/yt-dlp');
    expect(res.body.ytDlpVersion).toBe('2026.08.19');
    expect(res.body).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
    expect(res.body).not.toHaveProperty('GEMINI_API_KEY');
  });

  it('GET /health infrastructure endpoint should also return status ok and yt-dlp diagnostic fields', async () => {
    jest.spyOn(YouTubeExtractor, 'checkYtDlpAvailability').mockResolvedValueOnce({
      available: false,
      resolvedPath: 'yt-dlp',
      version: 'unavailable',
      error: 'Binary missing',
    });

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.ytDlpAvailable).toBe(false);
    expect(res.body.ytDlpResolvedPath).toBe('yt-dlp');
    expect(res.body.ytDlpVersion).toBe('unavailable');
    expect(res.body.ytDlpError).toBe('Binary missing');
  });
});
