import { AiOperationError } from './ai.js';

// All LLM traffic goes through OpenRouter's OpenAI-compatible chat completions API.
const baseUrl = () => ((process.env.API_BASE_URL || process.env.OPENROUTER_BASE_URL)?.trim() || 'https://api.apiyi.com/v1').replace(/\/+$/, '');
export const DEFAULT_MODEL = 'deepseek-v4-1-flash-260910';
// Source discovery calls the Gemini-native generateContent endpoint with google_search grounding, which only Gemini
// models serve, so it never falls back to MODEL_NAME.
export const DEFAULT_SEARCH_MODEL = 'gemini-3.5-flash-lite';

export type JsonSchema = Record<string, unknown>;
export type ChatResult = { text: string; finishReason?: string | undefined;
  usage: { promptTokens?: number | undefined; outputTokens?: number | undefined };
  citations: { url: string; title?: string | undefined }[] };

export function openRouterModel(name: 'OPENROUTER_MODEL' | 'OPENROUTER_SEARCH_MODEL' = 'OPENROUTER_MODEL'): string {
  if (name === 'OPENROUTER_SEARCH_MODEL')
    return (process.env.SEARCH_MODEL_NAME || process.env.OPENROUTER_SEARCH_MODEL)?.trim() || DEFAULT_SEARCH_MODEL;
  return (process.env.MODEL_NAME || process.env.OPENROUTER_MODEL)?.trim() || DEFAULT_MODEL;
}

export function openRouterConfigured() {
  return Boolean((process.env.API_KEY || process.env.OPENROUTER_API_KEY)?.trim());
}

type ChatOptions = {
  prompt: string;
  maxTokens: number;
  timeoutMs: number;
  model?: string;
  /** Reply shape: sent as JSON mode with this JSON Schema in the prompt; callers validate the result with zod. */
  schema?: { name: string; schema: JsonSchema };
  /**
   * Search the web (source discovery only). apiyi's chat completions ignore search tools, so this
   * goes to the gateway's Gemini-native endpoint with Google Search grounding instead.
   */
  webSearch?: { maxResults: number };
};

export async function chat(options: ChatOptions): Promise<ChatResult> {
  const apiKey = (process.env.API_KEY || process.env.OPENROUTER_API_KEY)?.trim();
  if (!apiKey) throw new AiOperationError('CONFIGURATION', 'OpenRouter is not configured.');
  if (options.webSearch) return searchWithGemini(options, apiKey);
  const model = options.model ?? openRouterModel();
  // JSON mode with the shape in the prompt (the club pattern): json_schema was not enforced by every model, and zod
  // stays the authority either way.
  const prompt = options.schema
    ? `${options.prompt}

Reply with ONE JSON object and nothing else. It must match this JSON Schema (every required field present, arrays within their limits):
${JSON.stringify(options.schema.schema)}`
    : options.prompt;
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: options.maxTokens,
  };
  if (options.schema) body.response_format = { type: 'json_object' };
  // Every call here runs under a timeout, so DeepSeek answers without its thinking pass (the flag is DeepSeek-only).
  if (model.includes('deepseek')) body.reasoning_effort = 'none';
  const response = await fetch(`${baseUrl()}/chat/completions`, {
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

/** Gemini-native generateContent with the google_search tool; sources come from groundingMetadata. */
async function searchWithGemini(options: ChatOptions, apiKey: string): Promise<ChatResult> {
  const model = options.model ?? openRouterModel('OPENROUTER_SEARCH_MODEL');
  const root = baseUrl().replace(/\/v1$/, '');
  const response = await fetch(`${root}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: options.prompt }] }],
      generationConfig: { maxOutputTokens: options.maxTokens }, tools: [{ google_search: {} }] }),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) {
    await response.text().catch(() => '');
    throw new AiOperationError('PROVIDER_FAILURE', `Web search request failed with HTTP ${response.status}.`);
  }
  const data = await response.json() as {
    candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] };
      groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map(part => part.text ?? '').join('');
  const citations = (candidate?.groundingMetadata?.groundingChunks ?? [])
    .filter(chunk => chunk.web?.uri)
    .slice(0, options.webSearch?.maxResults ?? 5)
    .map(chunk => ({ url: chunk.web!.uri!, title: chunk.web?.title }));
  return { text, finishReason: candidate?.finishReason, citations,
    usage: { promptTokens: data.usageMetadata?.promptTokenCount, outputTokens: data.usageMetadata?.candidatesTokenCount } };
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
