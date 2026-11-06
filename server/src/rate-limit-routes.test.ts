import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, type RateLimitGate } from './http-app.js';
import type { GenerationService, SavedSession } from './generation.js';

const conceptId = '00000000-0000-4000-8000-000000000101';
const requestId = '00000000-0000-4000-8000-000000000401';
const profileService = { getProfile: async () => ({ userId: '00000000-0000-4000-8000-000000000901' }) as never };
// Mirrors the shared engine's over-limit answer.
const limited: RateLimitGate = async (_bucket, _req, res) => {
  res.status(429).json({ message: 'Rate limit exceeded.', queries_used: 5 });
  return false;
};

describe('LLM route rate limiting', () => {
  it('serves cached lessons without consuming the generation quota', async () => {
    const cached = { id: 'cached' } as unknown as SavedSession;
    const start = vi.fn();
    const gate = vi.fn(limited);
    const generation = { reuse: vi.fn(async () => cached), start, get: vi.fn(), setPosition: vi.fn(), close: vi.fn() } as unknown as GenerationService;
    const app = createApp(profileService, undefined, generation, undefined, undefined, undefined, gate);
    const response = await request(app).post('/api/sessions').set('Authorization', 'Bearer visitor')
      .send({ conceptId, mode: 'learn', requestId }).expect(200);
    expect(response.body.data).toEqual({ id: 'cached' });
    expect(gate).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('stops before generating when the gate answers 429', async () => {
    const start = vi.fn();
    const gate = vi.fn(limited);
    const generation = { reuse: vi.fn(async () => null), start, get: vi.fn(), setPosition: vi.fn(), close: vi.fn() } as unknown as GenerationService;
    const app = createApp(profileService, undefined, generation, undefined, undefined, undefined, gate);
    const response = await request(app).post('/api/sessions').set('Authorization', 'Bearer visitor')
      .send({ conceptId, mode: 'learn', requestId }).expect(429);
    expect(response.body).toEqual({ message: 'Rate limit exceeded.', queries_used: 5 });
    expect(gate).toHaveBeenCalledWith('gen', expect.anything(), expect.anything());
    expect(start).not.toHaveBeenCalled();
  });
});
