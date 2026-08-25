export const mockAuth = {
  signUp: jest.fn().mockResolvedValue({
    data: { user: { id: 'user-123', email: 'testuser@example.com' }, session: { access_token: 'mock-token' } },
    error: null,
  }),
  signInWithPassword: jest.fn().mockResolvedValue({
    data: { user: { id: 'user-123', email: 'user@example.com' }, session: { access_token: 'valid-jwt-token' } },
    error: null,
  }),
  getUser: jest.fn().mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'user@example.com' } },
    error: null,
  }),
};

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

export const createMockQueryBuilder = () => {
  const builder: any = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    contains: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    filter: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    single: jest.fn().mockResolvedValue({ data: defaultItem, error: null }),
    then: (resolve: any) => resolve({ data: [defaultItem], count: 1, error: null }),
  };
  return builder;
};

export const mockQueryBuilder = createMockQueryBuilder();

export const supabase = {
  auth: mockAuth,
  from: jest.fn().mockImplementation(() => createMockQueryBuilder()),
};

export const supabaseAuth = {
  auth: mockAuth,
  from: jest.fn().mockImplementation(() => createMockQueryBuilder()),
};
