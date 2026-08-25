import request from 'supertest';
import app from '../../src/app';
import { supabase, supabaseAuth } from '../../src/config/supabase';

jest.mock('../../src/config/supabase', () => {
  const mockAuth = {
    getUser: jest.fn().mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    }),
  };
  const mockFrom = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: [], error: null }),
  });
  return {
    supabase: { auth: mockAuth, from: mockFrom },
    supabaseAuth: { auth: mockAuth, from: mockFrom },
  };
});

global.fetch = jest.fn() as jest.Mock;

describe('Collections, Analytics, Chat & Health API Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (supabaseAuth.auth.getUser as jest.Mock).mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    });
  });

  describe('GET /health', () => {
    it('should return health status 200 OK', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('GET /api/collections', () => {
    it('should return collections for authenticated user', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({
          data: [{ id: 'col-1', name: 'Articles', user_id: 'test-user-id' }],
          error: null,
        }),
      });

      const res = await request(app)
        .get('/api/collections')
        .set('Authorization', 'Bearer valid-jwt-token');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/analytics', () => {
    it('should calculate and return user dashboard metrics', async () => {
      (supabase.from as jest.Mock).mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({
          data: [
            { id: '1', status: 'completed', duration_seconds: 600, content_type: 'youtube' },
            { id: '2', status: 'unread', estimated_read_time: 5, content_type: 'article' },
          ],
          error: null,
        }),
      });

      const res = await request(app)
        .get('/api/analytics')
        .set('Authorization', 'Bearer valid-jwt-token');

      expect(res.status).toBe(200);
      expect(res.body.total_items).toBeDefined();
    });
  });

  describe('POST /api/chat', () => {
    it('should respond to user prompt with Gemini mock response', async () => {
      const mockGeminiReply = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Here is information from your saved queue.' }],
            },
          },
        ],
      };

      (global.fetch as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockGeminiReply),
          text: () => Promise.resolve(JSON.stringify(mockGeminiReply)),
        })
      );

      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', 'Bearer valid-jwt-token')
        .send({ message: 'What articles do I have saved about DSA?' });

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
    });
  });
});
