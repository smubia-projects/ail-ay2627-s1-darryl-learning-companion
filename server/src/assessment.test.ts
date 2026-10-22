import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from './http-app.js';

describe('answer route', () => {
  it('requires a learner and passes only the selected option to grading', async () => {
    const submit = vi.fn(async () => ({ evidence: {
      id: '00000000-0000-4000-8000-000000000501', roundId: '00000000-0000-4000-8000-000000000301',
      questionId: 'q-1', requestId: '00000000-0000-4000-8000-000000000401', attemptIndex: 1,
      answer: 'a', correct: true, assisted: false, independent: true, objectiveIds: ['roles'],
    }, feedback: 'Correct.', completed: false }));
    const hint = vi.fn(async () => ({ hint: 'Review the lesson example.', assisted: true as const }));
    const app = createApp({ getProfile: async () => ({ userId: 'learner' }) as never }, undefined, undefined, { submit, hint });
    const roundId = '00000000-0000-4000-8000-000000000301';
    const body = { questionId: 'q-1', answer: 'a', requestId: '00000000-0000-4000-8000-000000000401' };
    await request(app).post(`/api/rounds/${roundId}/answers`).send(body).expect(401);
    const response = await request(app).post(`/api/rounds/${roundId}/answers`)
      .set('Authorization', 'Bearer student-token').send(body).expect(200);
    expect(submit).toHaveBeenCalledWith('learner', roundId, body);
    expect(response.body.data.feedback).toBe('Correct.');
    await request(app).post(`/api/rounds/${roundId}/answers`)
      .set('Authorization', 'Bearer student-token').send({ ...body, answer: 'not valid!' }).expect(400);
    expect(submit).toHaveBeenCalledTimes(1);
    await request(app).post(`/api/rounds/${roundId}/hints`).set('Authorization', 'Bearer student-token')
      .send({ questionId: 'q-1', requestId: body.requestId }).expect(200);
    expect(hint).toHaveBeenCalledWith('learner', roundId, 'q-1', body.requestId);
  });
});
