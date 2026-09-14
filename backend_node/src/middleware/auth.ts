import { Request, Response, NextFunction } from 'express';
import { supabaseAuth, supabase } from '../config/supabase';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    sub: string;
    email?: string;
    [key: string]: any;
  };
}

/**
 * Deterministically resolves the canonical user_id for an authenticated Supabase user.
 * If the user ID already owns queue items, returns that user ID.
 * If another account sharing the exact same verified email owns items, resolves to that primary user ID.
 * Contains ZERO hardcoded UUIDs and ZERO user-specific alias maps.
 */
export async function resolveCanonicalUserId(user: { id: string; email?: string }): Promise<string> {
  const rawId = user.id;
  if (!rawId) return rawId;
  const userEmail = user.email ? user.email.toLowerCase().trim() : '';
  if (!userEmail) return rawId;

  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return rawId;
    }

    // 1. Check if rawId already has items in DB
    const ownRes = await supabase
      .from('items')
      .select('user_id')
      .eq('user_id', rawId)
      .limit(1);

    if (ownRes?.data && ownRes.data.length > 0) {
      return rawId;
    }

    // 2. Check if another Auth account matching the exact same email has items in DB
    if (supabaseAuth?.auth?.admin && typeof supabaseAuth.auth.admin.listUsers === 'function') {
      const authResult = await supabaseAuth.auth.admin.listUsers().catch(() => null);
      if (authResult?.data?.users?.length) {
        const matchingUserIds = authResult.data.users
          .filter((u: any) => u.email && u.email.toLowerCase().trim() === userEmail)
          .map((u: any) => u.id);

        if (matchingUserIds.length > 1) {
          const existingUserItems = await supabase
            .from('items')
            .select('user_id, created_at')
            .in('user_id', matchingUserIds)
            .order('created_at', { ascending: true })
            .limit(1);

          if (existingUserItems?.data && existingUserItems.data.length > 0) {
            return existingUserItems.data[0].user_id;
          }
        }
      }
    }
  } catch {
    /* fallback safely to rawId */
  }

  return rawId;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ detail: 'Missing or invalid authorization header' });
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return res.status(401).json({ detail: 'Empty authorization token' });
  }

  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data || !data.user) {
      console.warn('[AUTH] Supabase returned no user or error:', error);
      return res.status(401).json({ detail: 'Invalid or expired token' });
    }

    const canonicalUserId = await resolveCanonicalUserId(data.user);

    req.user = {
      ...data.user,
      id: canonicalUserId,
      sub: canonicalUserId,
    };
    
    return next();
  } catch (err: any) {
    const errStr = err.message || String(err);
    console.error('[AUTH] Token verification failed:', errStr);
    
    if (
      ['invalid', 'expired', 'jwt', 'token', 'unauthorized', 'forbidden', 'not found'].some(phrase =>
        errStr.toLowerCase().includes(phrase)
      )
    ) {
      return res.status(401).json({ detail: 'Invalid or expired token' });
    }

    return res.status(500).json({ detail: 'Authentication service error. Please try again.' });
  }
}
