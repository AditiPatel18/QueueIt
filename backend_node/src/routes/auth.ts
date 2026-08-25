import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabase } from '../config/supabase';

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

    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password: String(password),
      options: {
        data: { name: userName, full_name: userName },
      },
    });

    if (error) {
      const { data: adminUser, error: adminErr } = await supabase.auth.admin.createUser({
        email: cleanEmail,
        password: String(password),
        email_confirm: true,
        user_metadata: { name: userName, full_name: userName },
      });
      if (adminErr || !adminUser.user) {
        return res.status(400).json(formatResponse(false, null, error?.message || adminErr?.message || 'Signup failed'));
      }
      userResult = adminUser.user;
    } else {
      userResult = data.user;
      sessionResult = data.session;
      if (userResult?.id && !userResult.email_confirmed_at) {
        try {
          await supabase.auth.admin.updateUserById(userResult.id, { email_confirm: true });
        } catch { /* non-fatal */ }
      }
    }

    if (!sessionResult) {
      const { data: loginData } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: String(password),
      });
      if (loginData?.session) sessionResult = loginData.session;
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
    let { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: String(password),
    });

    // Backward compatibility check for legacy or unconfirmed accounts
    if (error && (error.message.includes('Invalid') || error.message.includes('confirm'))) {
      try {
        const { data: userList } = await supabase.auth.admin.listUsers();
        const existingUser = userList?.users?.find(
          (u) => (u.email || '').toLowerCase().trim() === cleanEmail
        );

        if (existingUser) {
          if (!existingUser.email_confirmed_at) {
            await supabase.auth.admin.updateUserById(existingUser.id, { email_confirm: true });
            const retry = await supabase.auth.signInWithPassword({
              email: cleanEmail,
              password: String(password),
            });
            if (retry.data?.session) {
              data = retry.data;
              error = null;
            }
          }
        }
      } catch { /* non-fatal fallback */ }
    }

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
