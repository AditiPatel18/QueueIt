import { YouTubeExtractor } from '../../src/services/youtubeExtractor';
import { AIService } from '../../src/services/aiService';
import { supabase } from '../../src/config/supabase';

// Mock Supabase
jest.mock('../../src/config/supabase', () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      single: jest.fn().mockResolvedValue({ data: { id: 'mock-item-id' }, error: null }),
    }),
  },
}));

global.fetch = jest.fn() as jest.Mock;

describe('YouTubeExtractor & Extraction Pipeline Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('YouTubeExtractor Helper Methods', () => {
    it('should extract video ID correctly from YouTube URLs', () => {
      expect(YouTubeExtractor.extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(YouTubeExtractor.extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(YouTubeExtractor.extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(YouTubeExtractor.extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
      expect(YouTubeExtractor.extractVideoId('https://example.com/not-youtube')).toBeNull();
    });

    it('should clean raw WebVTT caption text properly', () => {
      const rawVtt = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:04.000
<c>Hello</c> <b>world</b>! ♪

00:00:04.000 --> 00:00:07.000
This is a test transcript line.
This is a test transcript line.`;

      const cleaned = YouTubeExtractor.cleanVttCaptionText(rawVtt);
      expect(cleaned).toBe('Hello world! This is a test transcript line.');
    });
  });

  describe('Successful YouTube Extraction', () => {
    it('should successfully extract transcript & metadata for a valid YouTube video', async () => {
      const videoUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      
      jest.spyOn(YouTubeExtractor, 'extractYouTubeContent').mockResolvedValueOnce({
        success: true,
        videoId: 'dQw4w9WgXcQ',
        url: videoUrl,
        title: 'Rick Astley - Never Gonna Give You Up',
        durationSeconds: 213,
        transcript: 'Never gonna give you up, never gonna let you down. Full test transcript content here.',
        extractionMethod: 'yt-dlp (manual en captions)',
        ytDlpVersion: '2026.08.19',
        transcriptLength: 85,
      });

      const result = await YouTubeExtractor.extractYouTubeContent(videoUrl);

      expect(result.success).toBe(true);
      expect(result.videoId).toBe('dQw4w9WgXcQ');
      expect(result.title).toBe('Rick Astley - Never Gonna Give You Up');
      expect(result.durationSeconds).toBe(213);
      expect(result.transcript).toContain('Never gonna give you up');
      expect(result.transcriptLength).toBeGreaterThan(20);
      expect(result.extractionMethod).toContain('yt-dlp');
    });
  });

  describe('YouTube Extraction Failure Handling', () => {
    it('should handle extraction failure for invalid video URL and set processing_status to failed', async () => {
      const invalidUrl = 'https://www.youtube.com/watch?v=invalid_vid';

      jest.spyOn(YouTubeExtractor, 'extractYouTubeContent').mockResolvedValueOnce({
        success: false,
        videoId: 'invalid_vid',
        url: invalidUrl,
        extractionMethod: 'yt-dlp CLI',
        ytDlpVersion: '2026.08.19',
        transcriptLength: 0,
        error: 'YouTube video is unavailable or private.',
      });

      const mockRow = { extracted_text: null, description: null, title: null };
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: mockRow, error: null }),
      });

      await AIService.processItemEnrichment('test-failed-item-id', invalidUrl, 'user-123');

      // Verify Supabase update was called with processing_status: 'failed' and notes containing [Extraction Failed]
      const updateCalls = (supabase.from('items').update as jest.Mock).mock.calls;
      const failedUpdate = updateCalls.find(c => c[0] && c[0].processing_status === 'failed');
      expect(failedUpdate).toBeDefined();
      expect(failedUpdate[0].notes).toContain('[Extraction Failed]');
      expect(failedUpdate[0].ai_summary).toBeNull();
    });

    it('should record failure and respect backoff window for rate limited videos', async () => {
      const url = 'https://www.youtube.com/watch?v=rateLim1234';
      const videoId = YouTubeExtractor.extractVideoId(url)!;
      YouTubeExtractor.recordFailure(videoId, true);

      const check = YouTubeExtractor.isVideoInBackoff(videoId);
      expect(check.inBackoff).toBe(true);

      const res = await YouTubeExtractor.extractYouTubeContent(url);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Extraction paused');
    });
  });
});
