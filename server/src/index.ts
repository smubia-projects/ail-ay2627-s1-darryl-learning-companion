import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import cors from 'cors';
import express from 'express';
import { createApp } from './http-app.js';
import { createLocalRunsService } from './ai-runs.js';
import { bootstrapDatabase, closePools, sharedPool } from './db.js';
import { createGenerationService } from './generation.js';
import { rateLimitGate } from './rate-limit.js';
import { createTopicSuggestionService } from './topic-suggestions.js';
import { createTutorService } from './tutor.js';

/**
 * LearningCompanion API (Cloud Run). API-only: the React client is deployed separately
 * on Vercel and calls these routes through VITE_API_BASE.
 */
// Local development reads the repo-root .env; on Cloud Run env vars come from the service.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const port = Number(process.env.PORT?.trim() || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) console.warn('DATABASE_URL is not set: lessons, topics and progress are unavailable.');
const localRuns = process.env.NODE_ENV === 'production' || !databaseUrl ? undefined : createLocalRunsService(databaseUrl);
const generation = databaseUrl ? createGenerationService(databaseUrl) : undefined;
const tutor = databaseUrl ? createTutorService(databaseUrl) : undefined;
const suggestions = createTopicSuggestionService();

const allowedOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map(origin => origin.trim().replace(/\/$/, '')).filter(Boolean);
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
// No CORS_ORIGINS (local dev) allows any origin; otherwise only the listed Vercel origin(s).
app.use(cors({ origin: (origin, callback) => callback(null, !origin || !allowedOrigins.length || allowedOrigins.includes(origin)) }));
app.use(createApp(undefined, localRuns, generation, undefined, suggestions, tutor, rateLimitGate));

// Schema + starter catalogue bootstrap runs before the server accepts traffic.
if (databaseUrl) await bootstrapDatabase(sharedPool(databaseUrl));
const server = app.listen(port, '0.0.0.0', () => {
  console.info(`LearningCompanion API listening on 0.0.0.0:${port}`);
});
// Lesson generation can take minutes; keep sockets open past Node's defaults (Cloud Run caps at 300 s).
server.requestTimeout = 310_000;
server.headersTimeout = 315_000;
server.on('error', error => {
  console.error(`API could not start (${error.message}).`);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => {
    void Promise.all([localRuns?.close(), generation?.close(), tutor?.close(), suggestions.close()])
      .then(() => closePools()).finally(() => process.exit(0));
  }));
}
