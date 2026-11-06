import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PAUSED_EVENT, RATE_LIMIT_EVENT, apiRequest, getVisitorId, handledByGate, resetVisitorId } from './api';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('API client', () => {
  afterEach(() => { resetVisitorId(); });

  it('keeps one anonymous visitor ID and sends it as the bearer token', async () => {
    const fetchMock = vi.fn(async () => json(200, { data: { ok: true } }));
    vi.stubGlobal('fetch', fetchMock);
    const id = getVisitorId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(getVisitorId()).toBe(id);
    await expect(apiRequest('/me')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${id}` }) }));
  });

  it('announces the engine 429 with queries_used for the CTA modal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(429, { message: 'Rate limit exceeded.', queries_used: 5 })));
    const listener = vi.fn();
    window.addEventListener(RATE_LIMIT_EVENT, listener);
    const error = await apiRequest('/sessions', { method: 'POST' }).catch((caught: unknown) => caught);
    window.removeEventListener(RATE_LIMIT_EVENT, listener);
    expect(handledByGate(error)).toBe(true);
    expect((listener.mock.calls[0]![0] as CustomEvent).detail).toEqual({ queriesUsed: 5 });
  });

  it('announces a 503 kill-switch pause separately from the rate limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(503, { message: 'This demo is temporarily paused. Check back soon.' })));
    const paused = vi.fn();
    const limited = vi.fn();
    window.addEventListener(DEMO_PAUSED_EVENT, paused);
    window.addEventListener(RATE_LIMIT_EVENT, limited);
    await apiRequest('/sessions/x/tutor', { method: 'POST' }).catch(() => undefined);
    window.removeEventListener(DEMO_PAUSED_EVENT, paused);
    window.removeEventListener(RATE_LIMIT_EVENT, limited);
    expect((paused.mock.calls[0]![0] as CustomEvent).detail).toEqual({ message: 'This demo is temporarily paused. Check back soon.' });
    expect(limited).not.toHaveBeenCalled();
  });
});
