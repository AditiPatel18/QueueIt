import { AnalyticsService } from '../../src/services/analyticsService';

describe('AnalyticsService Unit Tests', () => {
  describe('getItemReadingTime', () => {
    it('should accurately convert duration_seconds to minutes for YouTube items', () => {
      const ytItem = {
        content_type: 'youtube',
        duration_seconds: 900, // 15 minutes in seconds
        estimated_read_time: 15,
      };
      const readTime = AnalyticsService.getItemReadingTime(ytItem);
      expect(readTime).toBe(15);
    });

    it('should use estimated_read_time in minutes directly for non-YouTube articles', () => {
      const articleItem = {
        content_type: 'article',
        estimated_read_time: 8,
      };
      const readTime = AnalyticsService.getItemReadingTime(articleItem);
      expect(readTime).toBe(8);
    });

    it('should fallback to calculating read time from extracted text word count', () => {
      const textItem = {
        extracted_text: 'word '.repeat(450), // 450 words
      };
      const readTime = AnalyticsService.getItemReadingTime(textItem);
      expect(readTime).toBe(2); // 450 words / 225 wpm = 2 min
    });
  });
});
