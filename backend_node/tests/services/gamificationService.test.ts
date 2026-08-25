import { GamificationService, getLocalDateStr } from '../../src/services/gamificationService';

jest.mock('../../src/config/supabase', () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}));

describe('GamificationService & Helper Unit Tests', () => {
  describe('getLocalDateStr', () => {
    it('should format date strings properly', () => {
      const date = new Date('2026-08-25T12:00:00Z');
      const formatted = getLocalDateStr('UTC', date);
      expect(formatted).toBe('2026-08-25');
    });
  });

  describe('GamificationService initialization', () => {
    it('should get or initialize user gamification stats object', async () => {
      const stats = await GamificationService.getOrInit('mock-user-123');
      expect(stats.user_id).toBe('mock-user-123');
      expect(stats.level).toBeGreaterThanOrEqual(1);
    });
  });
});
