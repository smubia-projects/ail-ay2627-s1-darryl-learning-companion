import { AiOperationError } from './ai.js';

// All LLM traffic goes through OpenRouter's OpenAI-compatible chat completions API.
const BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_MODEL = 'google/gemini-2.5-flash';

export type JsonSchema = Record<string, unknown>;
export type ChatResult = { text: string; finishReason?: string | undefined;
  usage: { promptTokens?: number | undefined; outputTokens?: number | undefined };
  citations: { url: string; title?: string | undefined }[] };

export function openRouterModel(name: 'OPENROUTER_MODEL' | 'OPENROUTER_SEARCH_MODEL' = 'OPENROUTER_MODEL'): string {
  return process.env[name]?.trim() || process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
}

export function openRouterConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

type ChatOptions = {
  prompt: string;
  maxTokens: number;
  timeoutMs: number;
  model?: string;
  /** JSON Schema for structured output (response_format json_schema). */
  schema?: { name: string; schema: JsonSchema };
  /** Enable OpenRouter's web search server tool (used for source discovery only). */
  webSearch?: { maxResults: number };
};

export async function chat(options: ChatOptions): Promise<ChatResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new AiOperationError('CONFIGURATION', 'OpenRouter is not configured.');
  const body: Record<string, unknown> = {
    model: options.model ?? openRouterModel(),
    messages: [{ role: 'user', content: options.prompt }],
    max_tokens: options.maxTokens,
  };
  if (options.schema) body.response_format = { type: 'json_schema',
    json_schema: { name: options.schema.name, strict: false, schema: options.schema.schema } };
  if (options.webSearch) body.tools = [{ type: 'openrouter:web_search',
    parameters: { engine: 'exa', max_results: options.webSearch.maxResults } }];
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
      'X-Title': 'LearningCompanion' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) {
    await response.text().catch(() => '');
    throw new AiOperationError('PROVIDER_FAILURE', `OpenRouter request failed with HTTP ${response.status}.`);
  }
  const data = await response.json() as {
    choices?: { finish_reason?: string; message?: { content?: string | null;
      annotations?: { type?: string; url_citation?: { url?: string; title?: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = data.choices?.[0];
  const text = choice?.message?.content ?? '';
  if (choice?.finish_reason === 'content_filter') throw new AiOperationError('REFUSAL', 'The model did not return usable content.');
  const citations = (choice?.message?.annotations ?? [])
    .filter(item => item.type === 'url_citation' && item.url_citation?.url)
    .map(item => ({ url: item.url_citation!.url!, title: item.url_citation?.title }));
  return { text: stripFence(text), finishReason: choice?.finish_reason, citations,
    usage: { promptTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens } };
}

/** JSON-returning helper: throws REFUSAL when the model returns nothing. */
export async function chatJson(options: ChatOptions & { schema: { name: string; schema: JsonSchema } }): Promise<string> {
  const result = await chat(options);
  if (!result.text.trim()) throw new AiOperationError('REFUSAL', 'The model did not return usable content.');
  return result.text;
}

// Some providers wrap JSON in a Markdown fence even with response_format set.
function stripFence(text: string) {
  const match = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return match ? match[1]! : text;
}
