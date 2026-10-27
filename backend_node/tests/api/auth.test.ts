import request from 'supertest';
import app from '../../src/app';
import { supabase, supabaseAuth } from '../../src/config/supabase';

jest.mock('../../src/config/supabase', () => {
  const mockAdmin = {
    createUser: jest.fn(),
    listUsers: jest.fn(),
    updateUserById: jest.fn(),
  };
  const mockAuth = {
    signUp: jest.fn(),
    signInWithPassword: jest.fn(),
    getUser: jest.fn(),
    admin: mockAdmin,
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

    it('should never call admin.createUser or auto-verify email in production', async () => {
      const prevEnv = process.env.NODE_ENV;
      const prevFlag = process.env.ALLOW_AUTO_CONFIRM_TEST_USERS;
      try {
        process.env.NODE_ENV = 'production';
        process.env.ALLOW_AUTO_CONFIRM_TEST_USERS = 'true'; // Even if flag is set, production MUST block it

        (supabase.auth.signUp as jest.Mock).mockResolvedValueOnce({
          data: {
            user: { id: 'prod-user', email: 'prod@example.com', email_confirmed_at: null },
            session: null,
          },
          error: null,
        });

        const response = await request(app)
          .post('/api/auth/signup')
          .send({ email: 'prod@example.com', password: 'securePassword123' });

        expect(response.status).toBe(200);
        expect((supabase.auth as any).admin.createUser).not.toHaveBeenCalled();
        expect(supabase.auth.signUp).toHaveBeenCalledWith({
          email: 'prod@example.com',
          password: 'securePassword123',
          options: expect.any(Object),
        });
        expect(response.body.data.user.email_confirmed_at).toBeNull();
        expect(response.body.data.session).toBeNull();
      } finally {
        process.env.NODE_ENV = prevEnv;
        process.env.ALLOW_AUTO_CONFIRM_TEST_USERS = prevFlag;
      }
    });

    it('should allow admin.createUser with email_confirm only when explicitly configured in non-production', async () => {
      const prevEnv = process.env.NODE_ENV;
      const prevFlag = process.env.ALLOW_AUTO_CONFIRM_TEST_USERS;
      try {
        process.env.NODE_ENV = 'development';
        process.env.ALLOW_AUTO_CONFIRM_TEST_USERS = 'true';

        ((supabase.auth as any).admin.createUser as jest.Mock).mockResolvedValueOnce({
          data: {
            user: { id: 'dev-user', email: 'dev@example.com', email_confirmed_at: '2026-10-27T00:00:00Z' },
          },
          error: null,
        });

        const response = await request(app)
          .post('/api/auth/signup')
          .send({ email: 'dev@example.com', password: 'securePassword123' });

        expect(response.status).toBe(200);
        expect((supabase.auth as any).admin.createUser).toHaveBeenCalledWith(
          expect.objectContaining({
            email: 'dev@example.com',
            email_confirm: true,
          })
        );
      } finally {
        process.env.NODE_ENV = prevEnv;
        process.env.ALLOW_AUTO_CONFIRM_TEST_USERS = prevFlag;
      }
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

    it('should reject unconfirmed email accounts without invoking admin auto-confirm in production', async () => {
      const prevEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';

        (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValueOnce({
          data: { user: null, session: null },
          error: { message: 'Email not confirmed' },
        });

        const response = await request(app)
          .post('/api/auth/login')
          .send({ email: 'unconfirmed@example.com', password: 'password123' });

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Email not confirmed');
        expect((supabase.auth as any).admin.listUsers).not.toHaveBeenCalled();
        expect((supabase.auth as any).admin.updateUserById).not.toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
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
