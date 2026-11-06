import { assessmentRoundSchema, hintResponseSchema, lessonSchema, submitAnswerResponseSchema,
  tutorHistorySchema, tutorReplySchema, type SubmitAnswerResponse, type TutorRequest } from '@learning-companion/shared';
import { z } from 'zod';
import { apiRequest } from '@/lib/api';

const savedSessionSchema = z.strictObject({
  id: z.uuid(), conceptId: z.uuid(), generationState: z.literal('ready'),
  lesson: lessonSchema, round: assessmentRoundSchema,
  citations: z.array(z.strictObject({ id: z.uuid(), heading: z.string(), url: z.string() })),
  currentStep: z.number().int().nonnegative(),
  attempts: z.array(submitAnswerResponseSchema),
  assistedQuestionIds: z.array(z.string()),
});
export type SavedLessonSession = z.infer<typeof savedSessionSchema>;

const sessionRequest = (path: string, init?: RequestInit, timeout = 10_000): Promise<unknown> =>
  apiRequest(path, init, timeout, 'Could not load this lesson. Please try again.');

export const startLesson = async (conceptId: string, requestId: string): Promise<SavedLessonSession> =>
  savedSessionSchema.parse(await sessionRequest('/sessions', {
    method: 'POST', body: JSON.stringify({ conceptId, mode: 'learn', requestId }),
  }, 310_000)); // a new lesson can take a few minutes; the API allows up to 300 s
export const fetchLesson = async (id: string): Promise<SavedLessonSession> =>
  savedSessionSchema.parse(await sessionRequest(`/sessions/${id}`));
export const fetchTutorHistory = async (id: string, before?: number) =>
  tutorHistorySchema.parse(await sessionRequest(`/sessions/${id}/messages${before === undefined ? '' : `?before=${before}`}`));
export const sendTutorMessage = async (id: string, input: TutorRequest) =>
  tutorReplySchema.parse(await sessionRequest(`/sessions/${id}/tutor`, {
    method: 'POST', body: JSON.stringify(input),
  }, 65_000));
export const submitAnswer = async (roundId: string, questionId: string, answer: string, requestId: string): Promise<SubmitAnswerResponse> =>
  submitAnswerResponseSchema.parse(await sessionRequest(`/rounds/${roundId}/answers`, {
    method: 'POST', body: JSON.stringify({ questionId, answer, requestId }),
  }));
export const requestHint = async (roundId: string, questionId: string, requestId: string): Promise<string> =>
  hintResponseSchema.parse(await sessionRequest(`/rounds/${roundId}/hints`, {
    method: 'POST', body: JSON.stringify({ questionId, requestId }),
  })).hint;
export const saveLessonStep = async (id: string, step: number): Promise<number> => {
  const result = z.strictObject({ currentStep: z.number().int().nonnegative() }).parse(await sessionRequest(
    `/sessions/${id}/position`, { method: 'PATCH', body: JSON.stringify({ step }) }));
  return result.currentStep;
};
