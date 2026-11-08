import { homeEnvelopeSchema, type CompleteOnboarding, type HomeData, type LearningStatus, type Profile } from '@learning-companion/shared';
import { apiRequest } from '@/lib/api';

export type ConceptChoice = HomeData['concepts'][number];
export type { HomeData };
export type SavedTopicNode = { id: string; parentKey: string; title: string; objective: string;
  status: LearningStatus; sessionId: string | null; citations: { title: string; url: string }[] };

const authorized = <T>(path: string, init?: RequestInit, timeoutMs = 10_000) =>
  apiRequest<T>(path, init, timeoutMs, 'Could not save or load your learning choices. Please try again.');

export const saveOnboarding = (input: CompleteOnboarding) => authorized<Profile>('/onboarding/diagnostic', {
  method: 'POST', body: JSON.stringify(input),
});
export const fetchHome = async () => homeEnvelopeSchema.parse({ data: await authorized<unknown>('/home') }).data;
export const fetchTopics = () => authorized<SavedTopicNode[]>('/topics');
export const suggestTopics = (parentKey: string, requestId: string, prompt?: string) => authorized<SavedTopicNode[]>('/topics/suggestions', {
  method: 'POST', body: JSON.stringify({ parentKey, requestId, ...(prompt ? { prompt } : {}) }),
}, 310_000); // the server allows each suggestion call 3 minutes
export const discoverTopicSources = (nodeId: string) => authorized<{ urls: string[]; ready: boolean }>(`/topics/${nodeId}/discover`, {
  method: 'POST',
}, 310_000);
