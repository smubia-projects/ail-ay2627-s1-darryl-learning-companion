import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { errorEnvelopeSchema, healthSchema, meEnvelopeSchema, type Profile } from '@learning-companion/shared';
import { createApp } from './http-app.js';
import { formatSgDateTime, safeSmokeRun } from './ai-runs.js';

describe('foundation API', () => {
  const profile: Profile = {
    userId: '00000000-0000-4000-8000-000000000901', isAnonymous: true,
    interests: [], experienceLevel: 'new', onboardingComplete: false,
    timezone: 'UTC', reducedMotion: false, createdAt: '2026-10-08T00:00:00Z',
  };
  it('serves unauthenticated health with a bounded success envelope', async () => {
    const response = await request(createApp()).get('/api/health').expect(200);
    expect(healthSchema.parse(response.body).status).toBe('ok');
    expect(response.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
  it('lists dated runs and returns one key-free run by ID only when enabled', async () => {
    const runId = '00000000-0000-4000-8000-000000000123';
    const privateOutput = { lesson: { title: 'Client <server>', steps: [
      { heading: 'Request', body: 'A browser requests a page.', citationChunkIds: ['chunk-1'] },
    ] }, questions: [{ id: 'q1', prompt: 'Who asks?', kind: 'recall' as const,
      objectiveId: 'client-server-roles', citationChunkIds: ['chunk-1'],
      options: [{ id: 'a', text: 'Client' }, { id: 'b', text: 'Server' }],
      correctOptionId: 'a', feedbackCriteria: 'private-rubric-sentinel' }] };
    const run = safeSmokeRun(runId, privateOutput, '2026-10-09T04:00:00.000Z', '2026-10-09T04:00:05.000Z',
      [{ id: 'chunk-1', heading: 'MDN', url: 'https://example.com' }]);
    const app = createApp({ getProfile: vi.fn() }, {
      list: async () => [{ id: runId, completedAt: run.completedAt, url: `/api/runs/${runId}` }],
      get: async id => id === runId ? run : null,
    });
    const listing = await request(app).get('/api/runs').expect(200);
    expect(listing.headers['content-type']).toMatch(/application\/json/);
    expect(listing.body.data).toEqual([{ id: runId, completedAt: {
      date: '091026', time: '12:00:05', timeZone: 'SGT',
    }, url: `/api/runs/${runId}` }]);
    expect(listing.text).not.toContain('lesson');
    expect(listing.headers['cache-control']).toBe('no-store');
    const response = await request(app).get(`/api/runs/${runId}`).expect(200);
    expect(response.body.data.id).toBe(runId);
    expect(response.body.data.startedAt).toEqual({ date: '091026', time: '12:00:00', timeZone: 'SGT' });
    expect(response.body.data.completedAt).toEqual({ date: '091026', time: '12:00:05', timeZone: 'SGT' });
    expect(response.body.data.lesson.title).toBe('Client <server>');
    expect(response.body.data.questions[0].prompt).toBe('Who asks?');
    expect(response.body.data.sources[0].url).toBe('https://example.com');
    expect(response.text).not.toContain('correctOptionId');
    expect(response.text).not.toContain('private-rubric-sentinel');
    expect(response.headers['cache-control']).toBe('no-store');
    await request(app).get('/api/runs/invalid').expect(404);
    await request(app).get('/api/runs/00000000-0000-4000-8000-000000000999').expect(404);
    await request(app).get('/').expect(404);
    await request(createApp({ getProfile: vi.fn() }, { list: async () => [], get: async () => null }))
      .get('/api/runs').expect(200, { data: [] });
    await request(createApp({ getProfile: vi.fn() })).get('/api/runs').expect(404);
    await request(createApp({ getProfile: vi.fn() })).get(`/api/runs/${runId}`).expect(404);
    expect(formatSgDateTime('2026-10-09T16:01:02.000Z')).toEqual({
      date: '101026', time: '00:01:02', timeZone: 'SGT',
    });
  });
  it('returns a standard missing-record error without echoing supplied identifiers', async () => {
    const response = await request(createApp()).get('/api/private-record').set('X-Request-Id', 'caller-controlled').expect(404);
    const result = errorEnvelopeSchema.parse(response.body);
    expect(result.error.code).toBe('NOT_FOUND');
    expect(result.error.requestId).toBe(response.headers['x-request-id']);
    expect(result.error.message).toBe('Resource not found.');
  });
  it('handles malformed JSON without echoing the body', async () => {
    const response = await request(createApp()).post('/api/missing').set('Content-Type', 'application/json').send('{"sensitive":').expect(400);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe('INVALID_INPUT');
    expect(JSON.stringify(response.body)).not.toContain('sensitive');
  });
  it('bounds request bodies and returns JSON errors for unsupported endpoints', async () => {
    const response = await request(createApp()).post('/api/missing').send({ text: 'x'.repeat(33000) }).expect(400);
    expect(errorEnvelopeSchema.parse(response.body).error.code).toBe('INVALID_INPUT');
    const unknown = await request(createApp()).post('/api/health').send({}).expect(404);
    expect(errorEnvelopeSchema.parse(unknown.body).error.code).toBe('NOT_FOUND');
  });
  it('requires a well-formed bearer session before asking the profile service', async () => {
    const getProfile = vi.fn().mockResolvedValue(profile);
    const app = createApp({ getProfile });
    for (const header of [undefined, 'Basic abc', 'Bearer ', 'Bearer invalid token']) {
      const call = request(app).get('/api/me');
      if (header) call.set('Authorization', header);
      const response = await call.expect(401);
      expect(errorEnvelopeSchema.parse(response.body).error.code).toBe('UNAUTHENTICATED');
    }
    expect(getProfile).not.toHaveBeenCalled();
  });
  it('passes the bearer token to identity verification and returns only the verified profile', async () => {
    const getProfile = vi.fn().mockResolvedValue(profile);
    const response = await request(createApp({ getProfile })).get('/api/me?userId=somebody-else')
      .set('Authorization', 'Bearer verified.token').expect(200);
    expect(getProfile).toHaveBeenCalledExactlyOnceWith('verified.token');
    expect(meEnvelopeSchema.parse(response.body).data).toEqual(profile);
  });
  it('saves a five-answer starting check without creating a learning status', async () => {
    const completeOnboarding = vi.fn().mockResolvedValue({ ...profile, onboardingComplete: true });
    const answers = [
      ['interest', 'cloud'], ['confidence', 'some'], ['practice', 'cloud_tools'],
      ['goal', 'project'], ['pace', 'balanced'],
    ].map(([questionId, answerId]) => ({ questionId, answerId }));
    const response = await request(createApp({ getProfile: vi.fn(), completeOnboarding }))
      .post('/api/onboarding/diagnostic').set('Authorization', 'Bearer verified.token')
      .send({ interests: ['cloud', 'cybersecurity'], experienceLevel: 'some', timezone: 'Asia/Singapore', skippedDiagnostic: false, answers }).expect(200);
    expect(response.body.data.onboardingComplete).toBe(true);
    expect(response.body.data).not.toHaveProperty('learningStatus');
    expect(completeOnboarding).toHaveBeenCalledWith('verified.token', expect.objectContaining({ answers }));
    await request(createApp({ getProfile: vi.fn(), completeOnboarding })).post('/api/onboarding/diagnostic')
      .set('Authorization', 'Bearer verified.token')
      .send({ interests: [], experienceLevel: 'new', timezone: 'UTC', skippedDiagnostic: false, answers: [] }).expect(400);
    expect(completeOnboarding).toHaveBeenCalledTimes(1);
  });
  it('requires authentication for private home data', async () => {
    const getHome = vi.fn().mockResolvedValue({ concepts: [], recommendations: { learn: null, review: [] }, activityCounts: [], recentSession: null, unfinishedSession: null });
    await request(createApp({ getProfile: vi.fn(), getHome })).get('/api/home').expect(401);
    const response = await request(createApp({ getProfile: vi.fn(), getHome })).get('/api/home')
      .set('Authorization', 'Bearer verified.token').expect(200);
    expect(response.body.data.concepts).toEqual([]);
    expect(getHome).toHaveBeenCalledExactlyOnceWith('verified.token');
  });
});
