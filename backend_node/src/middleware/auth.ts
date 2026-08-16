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

    req.user = {
      ...data.user,
      id: data.user.id,
      sub: data.user.id,
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
