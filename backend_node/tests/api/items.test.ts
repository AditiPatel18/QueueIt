import request from 'supertest';
import app from '../../src/app';
import { supabase, supabaseAuth } from '../../src/config/supabase';
import { fallbackDb } from '../../src/utils/schemaFallback';

const defaultItem = {
  id: 'rec-item-1',
  user_id: 'test-user-id',
  url: 'https://example.com/test',
  title: 'Learn TypeScript',
  status: 'unread',
  priority_score: 90,
  tags: ['typescript'],
  processing_status: 'completed',
};

const createBuilder = () => {
  const builder: any = {};
  builder.select = jest.fn().mockReturnValue(builder);
  builder.insert = jest.fn().mockReturnValue(builder);
  builder.update = jest.fn().mockReturnValue(builder);
  builder.delete = jest.fn().mockReturnValue(builder);
  builder.eq = jest.fn().mockReturnValue(builder);
  builder.in = jest.fn().mockReturnValue(builder);
  builder.order = jest.fn().mockReturnValue(builder);
  builder.limit = jest.fn().mockReturnValue(builder);
  builder.range = jest.fn().mockReturnValue(builder);
  builder.contains = jest.fn().mockReturnValue(builder);
  builder.is = jest.fn().mockReturnValue(builder);
  builder.not = jest.fn().mockReturnValue(builder);
  builder.filter = jest.fn().mockReturnValue(builder);
  builder.or = jest.fn().mockReturnValue(builder);
  builder.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  builder.single = jest.fn().mockResolvedValue({ data: defaultItem, error: null });
  builder.then = function (onfulfilled: any) {
    return Promise.resolve({ data: [defaultItem], count: 1, error: null }).then(onfulfilled);
  };
  return builder;
};

jest.mock('../../src/config/supabase', () => {
  const mockAuth = {
    signUp: jest.fn(),
    signInWithPassword: jest.fn(),
    getUser: jest.fn().mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    }),
  };

  return {
    supabase: {
      auth: mockAuth,
      from: jest.fn(),
    },
    supabaseAuth: {
      auth: mockAuth,
      from: jest.fn(),
    },
  };
});

jest.mock('../../src/utils/schemaFallback', () => ({
  fallbackDb: {
    mergeItemsMetadata: jest.fn().mockImplementation((userId, items) => Promise.resolve(items || [])),
    mergeSingleItemMetadata: jest.fn().mockImplementation((userId, item) => Promise.resolve(item || { id: 'rec-item-1', url: 'https://example.com/test', title: 'Learn TypeScript' })),
    getItemTracking: jest.fn().mockResolvedValue({}),
    recordItemRecommendation: jest.fn().mockResolvedValue(true),
    updateItemMetadata: jest.fn().mockResolvedValue(true),
    listCollections: jest.fn().mockResolvedValue([]),
    createCollection: jest.fn().mockResolvedValue({ id: 'col-1', name: 'Test' }),
    getCollections: jest.fn().mockResolvedValue([]),
  },
  openDb: jest.fn(),
  dbGet: jest.fn(),
  dbAll: jest.fn(),
  dbRun: jest.fn(),
}));

describe('Items API Integration Tests', () => {
  beforeEach(() => {
    (supabaseAuth.auth.getUser as jest.Mock).mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    });
    (supabase.from as jest.Mock).mockImplementation(() => createBuilder());
    (supabaseAuth.from as jest.Mock).mockImplementation(() => createBuilder());
    (fallbackDb.mergeItemsMetadata as jest.Mock).mockImplementation((userId, items) => Promise.resolve(items || []));
    (fallbackDb.mergeSingleItemMetadata as jest.Mock).mockImplementation((userId, item) => Promise.resolve(item || { id: 'rec-item-1', url: 'https://example.com/test', title: 'Learn TypeScript' }));
    (fallbackDb.getItemTracking as jest.Mock).mockResolvedValue({});
    (fallbackDb.recordItemRecommendation as jest.Mock).mockResolvedValue(true);
  });

  describe('GET /api/items', () => {
    it('should reject unauthenticated request', async () => {
      (supabaseAuth.auth.getUser as jest.Mock).mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Invalid token' },
      });

      const res = await request(app).get('/api/items');
      expect(res.status).toBe(401);
    });

    it('should fetch user queue items when authenticated', async () => {
      const res = await request(app)
        .get('/api/items')
        .set('Authorization', 'Bearer valid-jwt-token');

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
    });
  });

  describe('POST /api/items', () => {
    it('should create a new queue item', async () => {
      const res = await request(app)
        .post('/api/items')
        .set('Authorization', 'Bearer valid-jwt-token')
        .send({ url: 'https://example.com/new-item-unique', title: 'Test Webpage' });

      expect(res.status).toBe(201);
      expect(res.body).toBeDefined();
    });
  });

  describe('GET /api/items/recommendations/next', () => {
    it('should return top recommendation item and clear reason', async () => {
      const res = await request(app)
        .get('/api/items/recommendations/next')
        .set('Authorization', 'Bearer valid-jwt-token');

      expect(res.status).toBe(200);
      expect(res.body.suggestion).toBeDefined();
      expect(res.body.suggestion.item_id).toBe('rec-item-1');
      expect(res.body.suggestion.title).toBe('Learn TypeScript');
    });
  });
});
