import request from 'supertest';
import app from '../../src/app';
import { supabase, supabaseAuth } from '../../src/config/supabase';

jest.mock('../../src/config/supabase', () => {
  const mockAuth = {
    signUp: jest.fn(),
    signInWithPassword: jest.fn(),
    getUser: jest.fn(),
  };
  const mockFrom = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
  });
  return {
    supabase: { auth: mockAuth, from: mockFrom },
    supabaseAuth: { auth: mockAuth, from: mockFrom },
  };
});

describe('Auth API Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/auth/signup', () => {
    it('should normalize email to lowercase and create new account', async () => {
      (supabase.auth.signUp as jest.Mock).mockResolvedValueOnce({
        data: {
          user: { id: 'user-123', email: 'testuser@example.com' },
          session: { access_token: 'mock-token' },
        },
        error: null,
      });

      const response = await request(app)
        .post('/api/auth/signup')
        .send({ email: '  TestUser@Example.COM  ', password: 'securePassword123' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(supabase.auth.signUp).toHaveBeenCalledWith({
        email: 'testuser@example.com',
        password: 'securePassword123',
        options: expect.any(Object),
      });
    });

    it('should reject signup with missing credentials', async () => {
      const response = await request(app)
        .post('/api/auth/signup')
        .send({ email: '' });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should authenticate user with valid credentials', async () => {
      (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValueOnce({
        data: {
          user: { id: 'user-123', email: 'user@example.com' },
          session: { access_token: 'valid-jwt-token' },
        },
        error: null,
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'USER@EXAMPLE.COM ', password: 'password123' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 401 on invalid credentials', async () => {
      (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Invalid login credentials' },
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'wrong@example.com', password: 'wrongpassword' });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should reject unauthenticated request without Authorization header', async () => {
      const response = await request(app).get('/api/auth/me');
      expect(response.status).toBe(401);
    });

    it('should return user object when valid token is provided', async () => {
      (supabaseAuth.auth.getUser as jest.Mock).mockResolvedValueOnce({
        data: { user: { id: 'user-123', email: 'user@example.com' } },
        error: null,
      });

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-token-123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
