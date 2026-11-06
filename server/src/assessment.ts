import { hintResponseSchema, submitAnswerResponseSchema, type SubmitAnswerRequest, type SubmitAnswerResponse } from '@learning-companion/shared';
import { sharedPool } from './db.js';
import { ApiError } from './errors.js';

export type AssessmentService = {
  submit(ownerId: string, roundId: string, input: SubmitAnswerRequest): Promise<SubmitAnswerResponse>;
  hint(ownerId: string, roundId: string, questionId: string, requestId: string): Promise<ReturnType<typeof hintResponseSchema.parse>>;
};

const pgCode = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';

// Grading runs in the database functions (server-only answer keys, one transaction). The
// owner is the anonymous visitor the API resolved, replacing Supabase's auth.uid().
export function createAssessmentService(databaseUrl = process.env.DATABASE_URL?.trim()): AssessmentService {
  return {
    async submit(ownerId, roundId, input) {
      if (!databaseUrl) throw new ApiError(500, 'SERVICE_UNAVAILABLE', 'Could not check your answer. Please try again.');
      try {
        const result = await sharedPool(databaseUrl).query<{ result: unknown }>(
          'select public.submit_mcq_answer($1,$2,$3,$4,$5) as result',
          [ownerId, roundId, input.questionId, input.answer, input.requestId]);
        return submitAnswerResponseSchema.parse(result.rows[0]?.result);
      } catch (error) {
        const code = pgCode(error);
        if (code === '02000') throw new ApiError(404, 'NOT_FOUND', 'Quiz not found.');
        if (code === '22023') throw new ApiError(400, 'INVALID_INPUT', 'Choose an answer from this question.');
        if (code === '23505' || code === '23514') throw new ApiError(409, 'CONFLICT', 'This answer was already recorded. Reload the quiz to see it.');
        throw new ApiError(500, 'SERVICE_UNAVAILABLE', 'Could not check your answer. Please try again.');
      }
    },
    async hint(ownerId, roundId, questionId, requestId) {
      if (!databaseUrl) throw new ApiError(500, 'SERVICE_UNAVAILABLE', 'Could not show a hint. Please try again.');
      try {
        const result = await sharedPool(databaseUrl).query<{ result: unknown }>(
          'select public.request_mcq_hint($1,$2,$3,$4) as result', [ownerId, roundId, questionId, requestId]);
        return hintResponseSchema.parse(result.rows[0]?.result);
      } catch (error) {
        const code = pgCode(error);
        if (code === '02000') throw new ApiError(404, 'NOT_FOUND', 'Quiz not found.');
        if (code === '22023') throw new ApiError(400, 'INVALID_INPUT', 'Question not found.');
        throw new ApiError(500, 'SERVICE_UNAVAILABLE', 'Could not show a hint. Please try again.');
      }
    },
  };
}
