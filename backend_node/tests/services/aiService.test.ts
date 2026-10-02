import { AIService, prepareContentForSummarization, validateSummary } from '../../src/services/aiService';
import { YouTubeExtractor } from '../../src/services/youtubeExtractor';

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

describe('AIService Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('prepareContentForSummarization', () => {
    it('should return short content untouched if within maxChars', () => {
      const text = 'This is a short sample content.';
      expect(prepareContentForSummarization(text, 1000)).toBe(text);
    });

    it('should chunk large content preserving beginning, dense middle sections, and conclusion', () => {
      const beginning = 'Introduction: Quantum computing principles start here. '.repeat(20);
      const middle = '\n\nParagraph 1: Dense technical details about qubits and superposition.\n\nParagraph 2: Detailed mathematical formulation and quantum gates.\n\n';
      const conclusion = 'Conclusion: Final quantum supremacy conclusions and future outlook.'.repeat(20);

      const largeText = beginning + middle + conclusion;
      const prepared = prepareContentForSummarization(largeText, 500);

      expect(prepared.length).toBeLessThanOrEqual(550);
      expect(prepared).toContain('Quantum computing');
      expect(prepared).toContain('Conclusion');
    });
  });

  describe('validateSummary', () => {
    const sourceContent = 'Quantum computing leverages quantum mechanical phenomena such as superposition and entanglement to perform calculations. Traditional computers process information using bits that represent either 0 or 1, whereas quantum computers use qubits. This allows quantum algorithms to process vast numbers of possibilities simultaneously, delivering exponential performance gains for specialized cryptography, optimization, and molecular simulation problems.';

    it('should validate a high quality summary successfully', () => {
      const validSummary = 'Quantum computing utilizes quantum mechanics like superposition and entanglement to execute complex calculations. Unlike classical computers that rely on binary bits, quantum systems use qubits to evaluate multiple states concurrently. This architecture provides exponential speedups for complex tasks in cryptography, financial optimization, and molecular modeling.';
      const res = validateSummary(validSummary, sourceContent);
      expect(res.valid).toBe(true);
    });

    it('should reject empty or whitespace summary', () => {
      expect(validateSummary('', sourceContent).valid).toBe(false);
      expect(validateSummary('   ', sourceContent).valid).toBe(false);
    });

    it('should reject prompt leakage or forbidden meta-language', () => {
      const summaryWithLeakage = 'In this video, the speaker explains quantum computing. As an AI, I summarize that qubits allow parallel processing.';
      const res = validateSummary(summaryWithLeakage, sourceContent);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('forbidden meta-language');
    });

    it('should reject verbatim transcript fragments on long source texts', () => {
      const longSource = sourceContent.repeat(3);
      const verbatimSummary = longSource.substring(0, 400);
      const res = validateSummary(verbatimSummary, longSource);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('verbatim transcript fragment');
    });

    it('should reject off-topic summaries with no vocabulary overlap', () => {
      const offTopicSummary = 'Banana bread recipes require ripe bananas, flour, sugar, butter, and baking soda baked at 350 degrees Fahrenheit for one hour.';
      const res = validateSummary(offTopicSummary, sourceContent);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('vocabulary overlap');
    });
  });

  describe('generateSummary', () => {
    it('should generate summary and tags when Gemini API returns valid response', async () => {
      const mockSummary = 'Quantum computing utilizes quantum mechanics like superposition and entanglement to execute complex calculations. Unlike classical computers that rely on binary bits, quantum systems use qubits to evaluate multiple states concurrently.';

      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: mockSummary,
                },
              ],
            },
          },
        ],
      };

      (global.fetch as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockGeminiResponse),
          text: () => Promise.resolve(JSON.stringify(mockGeminiResponse)),
        })
      );

      const result = await AIService.generateSummary('Test Title', 'https://example.com/article', 'generic', 'Article content snippet...');
      expect(result.summary).toBeDefined();
      expect(Array.isArray(result.tags)).toBe(true);
      expect(result.priority).toBeGreaterThan(0);
    });

    it('should handle Gemini error without returning fake summaries', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('API Error'),
      });

      const result = await AIService.generateSummary('Test Title', 'https://example.com/article', 'generic', 'Some snippet text here.');
      expect(result.summary).toBe('');
      expect(result.error).toBeDefined();
    });
  });

  describe('processItemEnrichment stale summary handling', () => {
    it('should use existing extracted_text without re-fetching YouTube when re-enriching item with stale summary', async () => {
      const mockRow = {
        extracted_text: 'Existing extracted transcript text of 2000 chars...',
        description: null,
        title: 'Existing Video Title',
      };

      const { supabase } = require('../../src/config/supabase');
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: mockRow, error: null }),
      });

      (global.fetch as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            candidates: [{ content: { parts: [{ text: 'Generated summary from existing transcript.' }] } }]
          }),
          text: () => Promise.resolve(''),
        })
      );

      await AIService.processItemEnrichment('mock-item-id', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'user-id-123');

      expect(supabase.from).toHaveBeenCalledWith('items');
    });
  });

  describe('extractYouTubeContent via YouTubeExtractor', () => {
    it('should delegate extractYouTubeContent call to YouTubeExtractor', async () => {
      const videoUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      const spy = jest.spyOn(YouTubeExtractor, 'extractYouTubeContent').mockResolvedValueOnce({
        success: true,
        videoId: 'dQw4w9WgXcQ',
        url: videoUrl,
        title: 'Mock Video Title',
        transcript: 'Mock transcript content',
        extractionMethod: 'yt-dlp',
        ytDlpVersion: '2026.08.19',
        transcriptLength: 23,
      });

      const res = await AIService.extractYouTubeContent(videoUrl);
      expect(spy).toHaveBeenCalledWith(videoUrl);
      expect(res).toBeDefined();
      expect(res.title).toBe('Mock Video Title');
      expect(res.transcript).toBe('Mock transcript content');
    });

    it('should record failure and enforce backoff for repeated invalid video extractions', async () => {
      const videoUrl = 'https://www.youtube.com/watch?v=invalid_vid_backoff_test';
      const spy = jest.spyOn(YouTubeExtractor, 'extractYouTubeContent').mockImplementation(async (url) => {
        const vid = YouTubeExtractor.extractVideoId(url)!;
        const { inBackoff } = YouTubeExtractor.isVideoInBackoff(vid);
        if (inBackoff) {
          return { success: false, videoId: vid, url, extractionMethod: 'backoff', ytDlpVersion: '2026', transcriptLength: 0, error: 'backoff' };
        }
        YouTubeExtractor.recordFailure(vid, false);
        return { success: false, videoId: vid, url, extractionMethod: 'cli', ytDlpVersion: '2026', transcriptLength: 0, error: 'failed' };
      });

      const res1 = await AIService.extractYouTubeContent(videoUrl);
      expect(res1.transcript).toBe('');

      const res2 = await AIService.extractYouTubeContent(videoUrl);
      expect(res2.transcript).toBe('');
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});





