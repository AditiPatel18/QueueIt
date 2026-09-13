import { Request, Response, NextFunction } from 'express';
import { supabaseAuth } from '../config/supabase';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    sub: string;
    email?: string;
    [key: string]: any;
  };
}

const ACCOUNT_ALIAS_MAP: Record<string, string> = {
  '87975154-d112-4aeb-96e4-b6a9e120e9dc': 'dd669cb6-bbda-4e22-92b6-0f723849a1af',
  'a63fddcf-4dee-47be-b1a3-6fcf956ed3a5': 'dd669cb6-bbda-4e22-92b6-0f723849a1af',
};

const EMAIL_ALIAS_MAP: Record<string, string> = {
  'aditi18407@gmail.com': 'dd669cb6-bbda-4e22-92b6-0f723849a1af',
  'aditipatel18407@gmail.com': 'dd669cb6-bbda-4e22-92b6-0f723849a1af',
  'adipatel18407@gmail.com': 'dd669cb6-bbda-4e22-92b6-0f723849a1af',
};

export function resolvePrimaryUserId(rawUserId: string, email?: string): string {
  if (ACCOUNT_ALIAS_MAP[rawUserId]) {
    return ACCOUNT_ALIAS_MAP[rawUserId];
  }
  if (email && EMAIL_ALIAS_MAP[email.toLowerCase().trim()]) {
    return EMAIL_ALIAS_MAP[email.toLowerCase().trim()];
  }
  return rawUserId;
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

    const primaryUserId = resolvePrimaryUserId(data.user.id, data.user.email);

    req.user = {
      ...data.user,
      id: primaryUserId,
      sub: primaryUserId,
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
