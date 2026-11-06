import { errorEnvelopeSchema } from '@learning-companion/shared';

/**
 * Central API access. The Express API runs on Cloud Run and the browser calls it directly
 * through VITE_API_BASE (empty in local dev, where Vite proxies /api), so each visitor is
 * rate limited on their own IP.
 *
 * There is no login: each browser gets a random visitor ID, kept in localStorage and sent
 * as the bearer token. The API stores that visitor's progress under this ID.
 *
 * Responses from the shared rate-limit engine are broadcast as window events that
 * <RateLimitGate /> turns into UI:
 *  - 429 -> RATE_LIMIT_EVENT with { queriesUsed } (body.queries_used / detail.queries_used)
 *  - 503 -> DEMO_PAUSED_EVENT with { message } (the kill switch; the app never sends 503 itself)
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').trim().replace(/\/$/, '');
const SLUG = 'ail-ay2627-s1-darryl-learning-companion';
const VISITOR_KEY = `${SLUG}:visitor-id`;
export const RATE_LIMIT_EVENT = `${SLUG}:rate-limit`;
export const DEMO_PAUSED_EVENT = `${SLUG}:demo-paused`;

let memoryVisitorId: string | null = null;
export function getVisitorId(): string {
  try {
    const stored = window.localStorage.getItem(VISITOR_KEY);
    if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored)) return stored;
    const created = crypto.randomUUID();
    window.localStorage.setItem(VISITOR_KEY, created);
    return created;
  } catch {
    // Storage blocked (private mode): keep one ID for this page view.
    memoryVisitorId ??= crypto.randomUUID();
    return memoryVisitorId;
  }
}
/** Forget this browser's visitor ID, so the next request starts a fresh learner. */
export function resetVisitorId() {
  memoryVisitorId = null;
  try { window.localStorage.removeItem(VISITOR_KEY); } catch { /* storage unavailable */ }
}

export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

/** Fetches `/api${path}` and returns the `data` field of the success envelope. */
export async function apiRequest<T = unknown>(path: string, init: RequestInit = {}, timeoutMs = 10_000,
  fallbackMessage = 'Something went wrong. Please try again.'): Promise<T> {
  const response = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${getVisitorId()}`, 'Content-Type': 'application/json', ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const record = (body ?? {}) as { message?: unknown; queries_used?: unknown; detail?: { message?: unknown; queries_used?: unknown } };
    if (response.status === 429) {
      const used = Number(record.queries_used ?? record.detail?.queries_used ?? 0);
      window.dispatchEvent(new CustomEvent(RATE_LIMIT_EVENT, { detail: { queriesUsed: Number.isFinite(used) ? used : 0 } }));
    }
    if (response.status === 503) {
      const message = record.detail?.message ?? record.message;
      window.dispatchEvent(new CustomEvent(DEMO_PAUSED_EVENT, { detail: { message: typeof message === 'string' ? message : '' } }));
    }
    const parsed = errorEnvelopeSchema.safeParse(body);
    throw new ApiRequestError(parsed.success ? parsed.data.error.message : fallbackMessage, response.status);
  }
  return (body as { data: T }).data;
}

/** True for 429/503: the CTA modal or paused notice already explains it, so skip inline errors. */
export const handledByGate = (error: unknown) =>
  error instanceof ApiRequestError && (error.status === 429 || error.status === 503);
