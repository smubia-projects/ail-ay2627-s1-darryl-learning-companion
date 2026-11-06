import type { NextFunction, Request, Response } from 'express';
// Vendored shared engine, byte-identical to DOCS/shared/rate-limit/engine/node. Do not edit it here.
import { createRateLimiter } from './rateLimitEngine.js';
import type { RateLimitBucket, RateLimitGate } from './http-app.js';

/**
 * Rate-limit adapter: the shared engine with this project's slug and one bucket per LLM
 * action. The engine handles X-Forwarded-For, central config from the control sheet,
 * event mode, the kill switch (503) and fail-open. Without Upstash credentials it is a
 * no-op, which is what local development wants.
 */
type Middleware = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const limiter = createRateLimiter({
  // Slug = full project folder name (matches the central control-sheet rows).
  project: 'ail-ay2627-s1-darryl-learning-companion',
  buckets: {
    gen: Number(process.env.RATE_LIMIT_GEN_MAX || 5),
    tutor: Number(process.env.RATE_LIMIT_TUTOR_MAX || 5),
    suggest: Number(process.env.RATE_LIMIT_SUGGEST_MAX || 5),
  },
  redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_URL,
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN,
  defaultWindow: Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 432000),
}) as (bucket: string) => Middleware;

const middleware: Record<RateLimitBucket, Middleware> = {
  gen: limiter('gen'), tutor: limiter('tutor'), suggest: limiter('suggest'),
};

/**
 * Runs the engine middleware inside a route, after cheap checks, so cached lessons and
 * already-prepared topics do not use up a visitor's quota. If the engine answered (429 or
 * 503) it never calls next(), and the route must stop.
 */
export const rateLimitGate: RateLimitGate = async (bucket, req, res) => {
  let allowed = false;
  await middleware[bucket](req, res, () => { allowed = true; });
  return allowed && !res.headersSent;
};
