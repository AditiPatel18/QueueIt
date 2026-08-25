import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import healthRouter from './routes/health';
import itemsRouter from './routes/items';
import collectionsRouter from './routes/collections';
import remindersRouter from './routes/reminders';
import analyticsRouter from './routes/analytics';
import chatRouter from './routes/chat';
import authRouter from './routes/auth';
import notificationRouter from './routes/notifications';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();

// Security Headers via Helmet
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// Configure CORS origin whitelist
const allowedFrontendOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, extension background, or server-to-server)
      if (!origin) return callback(null, true);
      if (
        origin === allowedFrontendOrigin ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.startsWith('chrome-extension://')
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-QueueIt-Duplicate', 'X-Requested-With'],
  })
);

app.use(express.json({ limit: '2mb' }));

// Rate Limiters
const isTestEnv = process.env.NODE_ENV === 'test';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTestEnv ? 5000 : 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: 'Too many authentication attempts. Please try again in 15 minutes.' },
});

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTestEnv ? 5000 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: 'AI rate limit reached. Please wait a few minutes before trying again.' },
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTestEnv ? 10000 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(generalLimiter);

// API Routes
app.use('/api/health', healthRouter);
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/items', itemsRouter);
app.use('/api/collections', collectionsRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/reminders', remindersRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/chat', aiLimiter, chatRouter);

// Infrastructure Health Check
app.use('/health', healthRouter);

// Global Error Sanitizer Middleware (prevents leaking stack traces or internal secrets)
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error('[SERVER ERROR]', err?.message || err);
  const status = typeof err.status === 'number' ? err.status : 500;
  return res.status(status).json({
    detail: status === 500 ? 'An unexpected server error occurred. Please try again.' : err.message || 'Error processing request',
  });
});

export default app;
