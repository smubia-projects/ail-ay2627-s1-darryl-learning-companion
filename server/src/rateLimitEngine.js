/**
 * Centralised rate-limit engine — Express.
 *
 * Copy this file into the project alongside your app entry point as
 * `rateLimitEngine.js`, then create the middleware with the project slug and
 * its buckets:
 *
 *   import { createRateLimiter } from './rateLimitEngine.js'
 *
 *   const limiter = createRateLimiter({
 *     project: 'my-project',
 *     buckets: { chat: Number(process.env.RATE_LIMIT_CHAT_MAX || 5) },
 *     redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_URL,
 *     redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.UPSTASH_REDIS_TOKEN,
 *     defaultWindow: Number(process.env.RATE_LIMIT_WINDOW_SECONDS || 432000),
 *   })
 *
 *   app.post('/api/chat', limiter('chat'), chatHandler)
 *
 * Requires `@upstash/redis`. Limits and switches are read from the shared Upstash
 * Redis DB at request time, cached, with the `buckets` values as the fallback.
 * See the central rate-limit config documentation for the key schema.
 */
import { Redis } from '@upstash/redis'

export const ENGINE_VERSION = '1.3.0'

function clientIp(req) {
  // Cloud Run / proxies sit in front, so req.ip can be the proxy. Prefer XFF.
  const xff = req.headers['x-forwarded-for']
  if (xff) return String(xff).split(',')[0].trim()
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown'
}

export function createRateLimiter({
  project,
  buckets,
  redisUrl,
  redisToken,
  defaultWindow = 432000,
  cacheTtl = 90,
}) {
  const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null
  const cache = { t: 0, salt: '', killed: false, limits: { ...buckets }, window: defaultWindow }

  async function refresh() {
    const now = Date.now() / 1000
    if (now - cache.t < cacheTtl) return
    try {
      // One MGET covers globals + both modes (counts as a single command).
      const keys = [
        'config:kill_all',
        'config:event_mode',
        'config:ratelimit_salt',
        `config:${project}:mode_override`,
        `config:${project}:enabled`,
      ]
      for (const m of ['default', 'demo']) {
        keys.push(`config:${project}:${m}:window`)
        for (const b of Object.keys(buckets)) keys.push(`config:${project}:${m}:${b}`)
      }
      const values = await redis.mget(...keys)
      const data = {}
      keys.forEach((k, i) => { data[k] = values[i] })

      cache.killed =
        String(data['config:kill_all']) === '1' ||
        String(data[`config:${project}:enabled`]) === '0'

      let mode = data[`config:${project}:mode_override`] || data['config:event_mode'] || 'default'
      if (mode !== 'default' && mode !== 'demo') mode = 'default'
      cache.salt = data['config:ratelimit_salt'] || ''

      const w = data[`config:${project}:${mode}:window`]
      cache.window = w != null ? parseInt(w) : defaultWindow

      const limits = {}
      for (const [bucket, def] of Object.entries(buckets)) {
        const v = data[`config:${project}:${mode}:${bucket}`]
        limits[bucket] = v != null ? parseInt(v) : def
      }
      cache.limits = limits
      cache.t = now
    } catch {
      // Config unreachable -> keep defaults, stay live, never block.
      cache.killed = false
      cache.limits = { ...buckets }
      cache.window = defaultWindow
      cache.t = now
    }
  }

  return function (bucket) {
    return async function (req, res, next) {
      if (!redis) return next() // limiting disabled (no creds)
      await refresh()

      if (cache.killed) {
        return res.status(503).json({ message: 'This demo is temporarily paused. Check back soon.' })
      }

      const max = cache.limits[bucket] != null ? cache.limits[bucket] : buckets[bucket] || 0
      if (max <= 0) return next()

      const key = `ratelimit:${cache.salt}:${project}:${bucket}:${clientIp(req)}`
      let count
      try {
        count = await redis.incr(key)
        if (count === 1) await redis.expire(key, cache.window)
      } catch {
        return next() // transient Redis error -> fail open
      }
      if (count > max) {
        return res.status(429).json({ message: 'Rate limit exceeded.', queries_used: max })
      }
      next()
    }
  }
}
