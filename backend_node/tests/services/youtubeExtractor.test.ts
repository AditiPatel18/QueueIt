import { YouTubeExtractor } from '../../src/services/youtubeExtractor';
import { AIService } from '../../src/services/aiService';
import { supabase } from '../../src/config/supabase';
import { fallbackDb } from '../../src/utils/schemaFallback';

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

// Mock fallbackDb
jest.mock('../../src/utils/schemaFallback', () => ({
  fallbackDb: {
    updateItemMetadata: jest.fn().mockResolvedValue(undefined),
    mergeSingleItemMetadata: jest.fn().mockImplementation((userId, item) => Promise.resolve(item)),
    listCollections: jest.fn().mockResolvedValue([]),
    createCollection: jest.fn().mockResolvedValue(null),
  },
}));

global.fetch = jest.fn() as jest.Mock;

describe('YouTubeExtractor & AI Pipeline Regression Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('YouTubeExtractor Helper Methods & Configurations', () => {
    it('should extract video ID correctly from various YouTube URLs', () => {
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

    it('should configure bounded timeouts and non-wildcard subtitle languages to prevent 429 errors', () => {
      const langs = YouTubeExtractor.getSubLangs();
      // Must not contain wildcard en.* which causes yt-dlp to request all auto-translated variants and trigger HTTP 429
      expect(langs).not.toContain('en.*');
      expect(langs).toContain('en');
      expect(YouTubeExtractor.getMetadataTimeoutMs()).toBeLessThanOrEqual(15000);
      expect(YouTubeExtractor.getSubtitlesTimeoutMs()).toBeLessThanOrEqual(25000);
    });
  });

  describe('Test 1: Representative YouTube Video with Captions', () => {
    it('should extract transcript & metadata and generate a complete summary', async () => {
      const videoUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      const mockTranscript = 'In this lecture on system architecture, we explore microservices versus monolithic patterns. Monoliths offer simplicity and rapid initial deployment, but become unwieldy as teams scale. Microservices introduce independent deployability and fault isolation at the expense of network latency and data consistency challenges.';

      jest.spyOn(YouTubeExtractor, 'extractYouTubeContent').mockResolvedValueOnce({
        success: true,
        videoId: 'dQw4w9WgXcQ',
        url: videoUrl,
        title: 'System Architecture: Microservices vs Monoliths',
        durationSeconds: 600,
        transcript: mockTranscript,
        extractionMethod: 'yt-dlp captions',
        ytDlpVersion: '2026.08.19',
        transcriptLength: mockTranscript.length,
      });

      const mockSummary = 'The lecture evaluates architectural trade-offs between monolithic architectures and microservices. Monoliths excel in straightforward deployment and unified codebase management during early stages, while microservices enable autonomous scaling and localized fault isolation for larger organizations at the cost of operational complexity.';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: mockSummary }] } }]
        }),
      });

      const updateMock = jest.fn().mockReturnThis();
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        update: updateMock,
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      await AIService.processItemEnrichment('item-yt-captions', videoUrl, 'user-123');

      // Verify Supabase update with completed status and correct metadata
      const updateCalls = updateMock.mock.calls;
      const completedCall = updateCalls.find(call => call[0] && call[0].processing_status === 'completed');
      expect(completedCall).toBeDefined();
      expect(completedCall[0].ai_summary).toBe(mockSummary);
      expect(completedCall[0].duration_seconds).toBe(600);
      expect(completedCall[0]).not.toHaveProperty('notes');
    });
  });

  describe('Test 2: YouTube Video WITHOUT Available Captions', () => {
    it('should fail gracefully without pretending description is transcript or returning fake summary', async () => {
      const videoUrl = 'https://www.youtube.com/watch?v=no_captions_vid';

      jest.spyOn(YouTubeExtractor, 'extractYouTubeContent').mockResolvedValueOnce({
        success: false,
        videoId: 'no_captions_vid',
        url: videoUrl,
        title: 'Video Without Any Captions',
        durationSeconds: 120,
        extractionMethod: 'yt-dlp',
        ytDlpVersion: '2026.08.19',
        transcriptLength: 0,
        error: 'No subtitles or captions available for this video.',
      });

      const updateMock = jest.fn().mockReturnThis();
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        update: updateMock,
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: {
            title: 'Video Without Any Captions',
            description: 'This is just a description, not a transcript! Subscribe and check out our sponsors.',
            extracted_text: null,
          },
          error: null,
        }),
      });

      await AIService.processItemEnrichment('item-no-captions', videoUrl, 'user-123');

      // Verify that it failed gracefully
      const updateCalls = updateMock.mock.calls;
      const failedCall = updateCalls.find(call => call[0] && call[0].processing_status === 'failed');
      expect(failedCall).toBeDefined();
      expect(failedCall[0].ai_summary).toBeNull();
      expect(failedCall[0]).not.toHaveProperty('notes');

      // Verify fallbackDb received the extraction failure note
      expect(fallbackDb.updateItemMetadata).toHaveBeenCalledWith(
        'user-123',
        'item-no-captions',
        expect.objectContaining({ notes: expect.stringContaining('No subtitles or captions available') }),
        expect.anything()
      );
    });
  });

  describe('Test 3: Normal Web Article Extraction & Summarization', () => {
    it('should extract and summarize a normal web article successfully', async () => {
      const articleUrl = 'https://blog.example.com/engineering/distributed-caching';
      const articleContent = 'Distributed caching is a technique used in large-scale applications to store frequently accessed data across multiple cache servers in memory. By doing so, applications can bypass costly database queries and reduce latency to single-digit milliseconds. Common strategies include cache-aside, write-through, and write-behind patterns, each balancing data consistency against write latency.';

      const mockArticleSummary = 'Distributed caching optimizes application throughput by retaining hot data across multi-node in-memory clusters. Implementing patterns such as cache-aside and write-through significantly mitigates database contention while maintaining low-latency reads across distributed microservices.';

      const updateMock = jest.fn().mockReturnThis();
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        update: updateMock,
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: {
            extracted_text: articleContent,
            description: 'Engineering blog post on caching',
            title: 'Distributed Caching Patterns',
          },
          error: null,
        }),
      });

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: mockArticleSummary }] } }]
        }),
      });

      await AIService.processItemEnrichment('item-article-1', articleUrl, 'user-123');

      const updateCalls = updateMock.mock.calls;
      const completedCall = updateCalls.find(call => call[0] && call[0].processing_status === 'completed');
      expect(completedCall).toBeDefined();
      expect(completedCall[0].ai_summary).toBe(mockArticleSummary);
      expect(completedCall[0].processing_status).toBe('completed');
    });
  });

  describe('Test 4: Retry After Failure Resetting State Consistently', () => {
    it('should reset stale failure state, clear locks, and allow successful re-extraction', async () => {
      const videoUrl = 'https://www.youtube.com/watch?v=retry_success_vid';
      const transcript = 'Retried video content with valid captions describing continuous integration pipelines and automated build workflows.';
      const summary = 'Continuous integration pipelines automate code compilation, testing, and deployment to guarantee release stability across development teams.';

      // First run: fails
      jest.spyOn(YouTubeExtractor, 'extractYouTubeContent')
        .mockResolvedValueOnce({
          success: false,
          videoId: 'retry_success_vid',
          url: videoUrl,
          extractionMethod: 'yt-dlp',
          ytDlpVersion: '2026.08.19',
          transcriptLength: 0,
          error: 'Transient network failure',
        })
        .mockResolvedValueOnce({
          success: true,
          videoId: 'retry_success_vid',
          url: videoUrl,
          title: 'CI/CD Pipelines Explained',
          durationSeconds: 180,
          transcript,
          extractionMethod: 'yt-dlp captions',
          ytDlpVersion: '2026.08.19',
          transcriptLength: transcript.length,
        });

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: summary }] } }]
        }),
      });

      const updateMock = jest.fn().mockReturnThis();
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        update: updateMock,
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      // Run 1: Failure
      await AIService.processItemEnrichment('retry-item-id', videoUrl, 'user-123');
      const failCall = updateMock.mock.calls.find(call => call[0] && call[0].processing_status === 'failed');
      expect(failCall).toBeDefined();

      // Run 2: Retry succeeds
      await AIService.processItemEnrichment('retry-item-id', videoUrl, 'user-123');
      const successCall = updateMock.mock.calls.find(call => call[0] && call[0].processing_status === 'completed');
      expect(successCall).toBeDefined();
      expect(successCall[0].ai_summary).toBe(summary);
    });
  });

  describe('Test 5: Superseded & Stale Run Protection (Regression for Race Conditions)', () => {
    it('should discard late summary save if a newer retry run has superseded it', async () => {
      const url = 'https://example.com/race-condition-test';

      const updateMock = jest.fn().mockReturnThis();
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        update: updateMock,
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { extracted_text: 'Text for race condition test...' },
          error: null,
        }),
      });

      // Simulate run 1 starting, but before saving, run 2 starts with a newer runId
      const run1Promise = AIService.processItemEnrichment('race-item-1', url, 'user-123');

      // Simulate rapid retry starting run 2 for the same item ID
      const run2Promise = AIService.processItemEnrichment('race-item-1', url, 'user-123');

      const validSummary = 'Race condition test text analyzing concurrent asynchronous execution pipelines and distributed consistency models across isolated workers.';
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: validSummary }] } }]
        }),
      });

      await Promise.all([run1Promise, run2Promise]);

      // Only the active run should write completed status; superseded runs are discarded
      const completedCalls = updateMock.mock.calls.filter(call => call[0] && call[0].processing_status === 'completed');
      expect(completedCalls.length).toBe(1);
    });
  });
});
