import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabase, supabaseAuth } from '../config/supabase';

const router = Router();

function formatResponse(success: boolean, data: any = null, error: string | null = null) {
  return { success, data, error };
}

// ---------------------------------------------------------------------------
// POST /api/auth/signup
// ---------------------------------------------------------------------------
router.post('/signup', async (req, res: Response) => {
  const { email, password, name, full_name } = req.body || {};
  if (!email || !password) {
    return res.status(400).json(formatResponse(false, null, 'Email and password are required'));
  }
  const cleanEmail = String(email).trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return res.status(400).json(formatResponse(false, null, 'Invalid email address format'));
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json(formatResponse(false, null, 'Password must be at least 6 characters long'));
  }
  const userName = String(name || full_name || '').trim();
  try {
    let userResult: any = null;
    let sessionResult: any = null;

    // In test/development only, allow explicit auto-confirm of test users if explicitly enabled by environment configuration
    const allowTestAutoConfirm =
      process.env.NODE_ENV !== 'production' &&
      process.env.ALLOW_AUTO_CONFIRM_TEST_USERS === 'true' &&
      typeof (supabase.auth as any)?.admin?.createUser === 'function';

    if (allowTestAutoConfirm) {
      try {
        const { data: adminUser } = await (supabase.auth as any).admin.createUser({
          email: cleanEmail,
          password: String(password),
          email_confirm: true,
          user_metadata: { name: userName, full_name: userName },
        });
        if (adminUser?.user) {
          userResult = adminUser.user;
        }
      } catch { /* fallback to standard signUp */ }
    }

    if (!userResult) {
      const { data, error } = await supabaseAuth.auth.signUp({
        email: cleanEmail,
        password: String(password),
        options: {
          data: { name: userName, full_name: userName },
        },
      });
      if (error) {
        return res.status(400).json(formatResponse(false, null, error?.message || 'Signup failed'));
      }
      userResult = data?.user;
      if (data?.session) {
        sessionResult = data.session;
      }
    }

    if (!sessionResult) {
      try {
        const loginRes = await supabaseAuth.auth.signInWithPassword({
          email: cleanEmail,
          password: String(password),
        });
        if (loginRes?.data?.session) {
          sessionResult = loginRes.data.session;
        }
      } catch { /* non-fatal */ }
    }

    return res.json(formatResponse(true, { user: userResult, session: sessionResult }));
  } catch (err: any) {
    return res.status(400).json(formatResponse(false, null, err.message || String(err)));
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
router.post('/login', async (req, res: Response) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json(formatResponse(false, null, 'Email and password are required'));
  }
  const cleanEmail = String(email).trim().toLowerCase();
  try {
    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email: cleanEmail,
      password: String(password),
    });

    if (error || !data?.session) {
      return res.status(401).json(formatResponse(false, null, error?.message || 'Invalid login credentials'));
    }
    return res.json(formatResponse(true, {
      session: data.session,
      user: data.user,
    }));
  } catch (err: any) {
    return res.status(401).json(formatResponse(false, null, err.message || String(err)));
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
router.get('/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  return res.json(formatResponse(true, { user: req.user }));
});

export default router;
