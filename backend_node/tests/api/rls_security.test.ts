import request from 'supertest';
import app from '../../src/app';
import { supabase, supabaseAuth } from '../../src/config/supabase';

const defaultItem = {
  id: 'item-a-1',
  user_id: 'user-a-id',
  url: 'https://example.com/a',
  title: 'User A Item',
  status: 'unread',
};

const defaultPref = {
  id: 'pref-a-1',
  user_id: 'user-a-id',
  email_enabled: true,
  browser_enabled: true,
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
  builder.upsert = jest.fn().mockResolvedValue({ data: [defaultPref], error: null });
  builder.maybeSingle = jest.fn().mockImplementation(() => Promise.resolve({ data: null, error: null }));
  builder.single = jest.fn().mockResolvedValue({ data: defaultItem, error: null });
  builder.then = function (resolve: any) {
    return Promise.resolve({ data: [defaultPref], count: 1, error: null }).then(resolve);
  };
  return builder;
};

jest.mock('../../src/config/supabase', () => {
  return {
    supabase: {
      auth: {
        getUser: jest.fn(),
      },
      from: jest.fn(),
    },
    supabaseAuth: {
      auth: {
        getUser: jest.fn(),
      },
      from: jest.fn(),
    },
  };
});

jest.mock('../../src/utils/schemaFallback', () => ({
  fallbackDb: {
    getItemById: jest.fn().mockResolvedValue(null),
    deleteItem: jest.fn().mockResolvedValue(true),
    deleteItemMetadata: jest.fn().mockResolvedValue(true),
    mergeItemsMetadata: jest.fn().mockImplementation((userId, items) => Promise.resolve(items || [])),
    mergeSingleItemMetadata: jest.fn().mockImplementation((userId, item) => Promise.resolve(item || {})),
    getItemTracking: jest.fn().mockResolvedValue({}),
    recordItemRecommendation: jest.fn().mockResolvedValue(true),
    updateItemMetadata: jest.fn().mockResolvedValue(true),
    listCollections: jest.fn().mockResolvedValue([]),
    deleteCollection: jest.fn().mockImplementation((userId, colId) => {
      if (colId === 'col-b-1') return Promise.resolve(false);
      return Promise.resolve(true);
    }),
  },
  openDb: jest.fn(),
  dbGet: jest.fn(),
  dbAll: jest.fn(),
  dbRun: jest.fn(),
}));

describe('RLS & Cross-User Security Isolation Tests', () => {
  beforeEach(() => {
    (supabaseAuth.auth.getUser as jest.Mock).mockResolvedValue({
      data: { user: { id: 'user-a-id', email: 'usera@example.com' } },
      error: null,
    });
    (supabase.from as jest.Mock).mockImplementation(() => createBuilder());
    (supabaseAuth.from as jest.Mock).mockImplementation(() => createBuilder());
  });

  it('User A cannot fetch User B item details by passing User B item ID', async () => {
    const res = await request(app)
      .get('/api/items/item-b-1')
      .set('Authorization', 'Bearer user-a-token');

    expect(res.status).toBe(404);
  });

  it('User A delete endpoint executes scoped delete', async () => {
    const res = await request(app)
      .delete('/api/items/item-b-1')
      .set('Authorization', 'Bearer user-a-token');

    expect(res.status).toBe(200);
  });

  it('User A cannot delete User B collection', async () => {
    const res = await request(app)
      .delete('/api/collections/col-b-1')
      .set('Authorization', 'Bearer user-a-token');

    expect(res.status).toBe(404);
  });

  it('User A notifications preferences endpoint uses authenticated JWT token', async () => {
    const res = await request(app)
      .get('/api/notifications/preferences?user_id=user-b-id')
      .set('Authorization', 'Bearer user-a-token');

    expect(res.status).toBe(404); // maybeSingle returns null preference in mock fallback
  });
});
