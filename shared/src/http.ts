import { z } from 'zod';
import { entityIdSchema, shortTextSchema } from './common.js';

export const ERROR_CODES = ['INVALID_INPUT', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'QUOTA_EXCEEDED', 'PROVIDER_FAILURE', 'PROVIDER_TIMEOUT', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR'] as const;
export const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({ code: z.enum(ERROR_CODES), message: shortTextSchema, requestId: entityIdSchema }),
});
export const successEnvelopeSchema = <T extends z.ZodType>(dataSchema: T) => z.strictObject({ data: dataSchema });
// Cloud Run health check body: {"status":"ok"} (no envelope).
export const healthSchema = z.strictObject({ status: z.literal('ok') });
export type ApiErrorCode = typeof ERROR_CODES[number];
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type SuccessEnvelope<T> = { data: T };
export type Health = z.infer<typeof healthSchema>;
