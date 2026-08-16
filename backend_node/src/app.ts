import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import healthRouter from './routes/health';
import itemsRouter from './routes/items';
import collectionsRouter from './routes/collections';
import remindersRouter from './routes/reminders';
import analyticsRouter from './routes/analytics';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/health', healthRouter);
app.use('/api/items', itemsRouter);
app.use('/api/collections', collectionsRouter);
app.use('/api/reminders', remindersRouter);
app.use('/api/analytics', analyticsRouter);

// Fallback for non-prefixed health check if needed by infrastructure
app.use('/health', healthRouter);

export default app;
