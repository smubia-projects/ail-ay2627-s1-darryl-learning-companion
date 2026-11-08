import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Profile } from '@learning-companion/shared';
import { createApp } from './http-app.js';
import { generateValidated, validateGenerated, type GenerationInput, type GenerationService } from './generation.js';

const conceptId = '00000000-0000-4000-8000-000000000101';
const chunkId = '00000000-0000-4000-8000-000000000501';
const input: GenerationInput = { conceptId, title: 'Clients and servers',
  objectives: [{ id: 'client-server-roles', description: 'Explain client and server roles.' }],
  passages: [{ id: chunkId, heading: 'Clients and servers', body: 'A browser client requests a page from a server.',
    sourceUrl: 'https://example.com/reference', objectiveId: 'client-server-roles' }],
  interests: ['web_communication'], experienceLevel: 'new', diagnosticEvidence: [] };
const generated = {
  title: 'Clients and servers',
  runningExample: 'A student opens /courses in a browser and the course site returns the page.',
  diagrams: [{ id: 'main', title: 'Web exchange', type: 'flow',
    nodes: [{ id: 'client', label: 'Client', description: 'Requests a page.', example: 'Open /courses' },
      { id: 'server', label: 'Server', description: 'Responds.', example: 'Course site\nReturns the courses page' }],
    edges: [{ id: 'request', from: 'client', to: 'server', label: 'Requests' }] }],
  steps: Array.from({ length: 4 }, (_, i) => ({ id: `step${i}`, heading: `Step ${i}`,
    caption: 'A client requests a page from a server.',
    explanation: 'The client begins the exchange by asking the server for a page.\n\nThe server can then send the requested page back to the client for the browser to display.',
    workedExample: 'A browser asks a server for its home page. The server sends the page, and the browser displays it.',
    commonMistake: 'Mistake: the server starts this request. Correction: the client asks for the page first.',
    diagramId: 'main',
    highlightNodeIds: ['client'], highlightEdgeIds: ['request'], highlightRowIndexes: [], citationChunkIds: [chunkId] })),
  questions: Array.from({ length: 3 }, (_, i) => ({ id: `q${i}`, familyId: `family${i}`,
    prompt: `Question ${i}?`, kind: i === 2 ? 'application' : 'recall',
    objectiveIds: ['client-server-roles'], citationChunkIds: [chunkId],
    options: Array.from({ length: 4 }, (_, j) => ({ id: `o${j}`, text: `Option ${j}` })),
    correctOptionId: 'o0', feedbackCriteria: 'A client sends the request.' })),
};

describe('Stage 6 generated lessons', () => {
  it('validates source and diagram references and strips keys from public snapshots', () => {
    const result = validateGenerated(generated, input);
    expect(result.lesson.steps).toHaveLength(4);
    expect(result.lesson.steps[0]?.workedExample).toContain('browser');
    expect(result.round.questions).toHaveLength(3);
    expect(result.answerKeys.q0).toBe('o0');
    expect(JSON.stringify({ lesson: result.lesson, round: result.round })).not.toContain('correctOptionId');
    expect(JSON.stringify({ lesson: result.lesson, round: result.round })).not.toContain('feedbackCriteria');
    expect(() => validateGenerated({ ...generated, questions: [{ ...generated.questions[0],
      citationChunkIds: ['00000000-0000-4000-8000-000000000599'] }, ...generated.questions.slice(1)] }, input)).toThrow();
    expect(() => validateGenerated({ ...generated, questions: [{ ...generated.questions[0],
      correctOptionId: 'absent' }, ...generated.questions.slice(1)] }, input)).toThrow();
    // A highlight that names a part the diagram doesn't have is dropped (the step then highlights the first node).
    const clamped = validateGenerated({ ...generated, steps: [{ ...generated.steps[0]!,
      highlightNodeIds: ['absent'] }, ...generated.steps.slice(1)] }, input);
    expect(clamped.lesson.steps[0]?.highlightNodeIds).not.toContain('absent');
    expect(() => validateGenerated({ ...generated, steps: [{ ...generated.steps[0],
      caption: 'Servers securely store webpages.' }, ...generated.steps.slice(1)] }, input)).toThrow();
    expect(() => validateGenerated({ ...generated, steps: [{ ...generated.steps[0],
      workedExample: 'The browser asks for a page, and the server securely sends that page back for display.' }, ...generated.steps.slice(1)] }, input)).toThrow();
    expect(() => validateGenerated({ ...generated, steps: [{ ...generated.steps[0],
      workedExample: undefined }, ...generated.steps.slice(1)] }, input)).toThrow();
  });

  it('repairs malformed JSON once and includes learner context in the prompt', async () => {
    const provider = vi.fn().mockResolvedValueOnce('{oops').mockResolvedValueOnce(JSON.stringify(generated));
    const repair = vi.fn(async () => {});
    const result = await generateValidated(input, provider, repair);
    expect(result.round.questions).toHaveLength(3);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0]?.[0]).toContain('web_communication');
    expect(provider.mock.calls[0]?.[0]).toContain(chunkId);
    expect(provider.mock.calls[0]?.[0]).toContain('ONE concrete runningExample');
    expect(provider.mock.calls[0]?.[0]).toContain('each workedExample must walk through that same scenario');
  });

  it('does not retry a provider timeout or accept a second invalid response', async () => {
    const timeout = vi.fn(async () => { throw new DOMException('Timed out', 'TimeoutError'); });
    await expect(generateValidated(input, timeout, async () => {})).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(timeout).toHaveBeenCalledTimes(1);
    const repair = vi.fn(async () => {});
    await expect(generateValidated(input, async () => '{bad', repair)).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it('requires a verified learner and returns only the saved public session', async () => {
    const profile: Profile = { userId: '00000000-0000-4000-8000-000000000901', isAnonymous: true,
      interests: [], experienceLevel: 'new', onboardingComplete: true, timezone: 'Asia/Singapore',
      reducedMotion: false, createdAt: '2026-10-12T00:00:00Z' };
    const result = validateGenerated(generated, input);
    const saved = { id: result.lesson.id, conceptId, generationState: 'ready' as const,
      lesson: result.lesson, round: result.round, citations: result.citations, currentStep: 0, attempts: [], assistedQuestionIds: [] };
    const start = vi.fn(async () => saved);
    const get = vi.fn(async (owner: string, id: string) => owner === profile.userId && id === saved.id ? saved : null);
    const setPosition = vi.fn(async (_owner: string, _id: string, step: number) => step < 4 ? step : null);
    const service = { start, get, setPosition, close: async () => {} } satisfies GenerationService;
    const app = createApp({ getProfile: async () => profile }, undefined, service);
    await request(app).post('/api/sessions').send({ conceptId, mode: 'learn', requestId: crypto.randomUUID() }).expect(401);
    const response = await request(app).post('/api/sessions').set('Authorization', 'Bearer good-token')
      .send({ conceptId, mode: 'learn', requestId: crypto.randomUUID() }).expect(200);
    expect(response.body.data.round.questions).toHaveLength(3);
    expect(response.text).not.toContain('correctOptionId');
    expect(response.text).not.toContain('feedbackCriteria');
    await request(app).get(`/api/sessions/${saved.id}`).set('Authorization', 'Bearer good-token').expect(200);
    expect(get).toHaveBeenCalledWith(profile.userId, saved.id);
    await request(app).patch(`/api/sessions/${saved.id}/position`).set('Authorization', 'Bearer good-token')
      .send({ step: 2 }).expect(200);
    expect(setPosition).toHaveBeenCalledWith(profile.userId, saved.id, 2);
    await request(app).patch(`/api/sessions/${saved.id}/position`).set('Authorization', 'Bearer good-token')
      .send({ step: 4 }).expect(404);
  });
});
