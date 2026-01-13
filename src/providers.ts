/**
 * Multi-provider AI abstraction for Midas
 * 
 * Supports:
 * - Anthropic Claude (claude-opus-4-20250514)
 * - OpenAI GPT-4o
 * - Google Gemini 2.0 Flash
 * - xAI Grok 2
 */

import { getActiveProvider, getProviderApiKey, type AIProvider } from './config.js';
import { logger } from './logger.js';

export interface ChatOptions {
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  useThinking?: boolean;  // Anthropic extended thinking
  timeout?: number;       // Request timeout in ms
}

export interface ChatResponse {
  content: string;
  provider: AIProvider;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cached?: boolean;
}

// Provider-specific API configurations
const PROVIDER_CONFIGS = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-opus-4-20250514',
    authHeader: 'x-api-key',
    maxTokens: 16000,
    thinkingBudget: 10000,
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    maxTokens: 4096,
  },
  google: {
    // Gemini uses path-based API key
    urlTemplate: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    model: 'gemini-2.0-flash',
    maxTokens: 8192,
  },
  xai: {
    // xAI uses OpenAI-compatible format
    url: 'https://api.x.ai/v1/chat/completions',
    model: 'grok-2',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    maxTokens: 4096,
  },
} as const;

/**
 * Main chat function - routes to appropriate provider
 */
export async function chat(prompt: string, options: ChatOptions = {}): Promise<ChatResponse> {
  const provider = getActiveProvider();
  const apiKey = getProviderApiKey(provider);
  
  if (!apiKey) {
    throw new Error(`No API key configured for ${provider}. Run 'midas config' or set env var.`);
  }
  
  const timeout = options.timeout ?? 60000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    switch (provider) {
      case 'anthropic':
        return await chatAnthropic(apiKey, prompt, options, controller.signal);
      case 'openai':
        return await chatOpenAI(apiKey, prompt, options, controller.signal);
      case 'google':
        return await chatGoogle(apiKey, prompt, options, controller.signal);
      case 'xai':
        return await chatXAI(apiKey, prompt, options, controller.signal);
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Anthropic Claude API
 * - Extended thinking support
 * - Prompt caching via cache_control
 */
async function chatAnthropic(
  apiKey: string,
  prompt: string,
  options: ChatOptions,
  signal: AbortSignal
): Promise<ChatResponse> {
  const config = PROVIDER_CONFIGS.anthropic;
  const useThinking = options.useThinking ?? true;
  const maxTokens = options.maxTokens ?? config.maxTokens;
  
  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  
  // Add system prompt with caching
  if (options.systemPrompt) {
    body.system = [
      {
        type: 'text',
        text: options.systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ];
  }
  
  // Enable extended thinking for deep analysis
  if (useThinking) {
    body.thinking = {
      type: 'enabled',
      budget_tokens: config.thinkingBudget,
    };
  }
  
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [config.authHeader]: apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${error}`);
  }
  
  const data = await response.json() as {
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
  };
  
  // Extract text (skip thinking blocks)
  const textBlocks = data.content.filter(block => block.type === 'text');
  const content = textBlocks[0]?.text || '';
  
  // Log cache hits
  if (data.usage?.cache_read_input_tokens && data.usage.cache_read_input_tokens > 0) {
    logger.debug('Anthropic cache hit', { 
      cached: data.usage.cache_read_input_tokens,
      total: data.usage.input_tokens,
    });
  }
  
  return {
    content,
    provider: 'anthropic',
    model: config.model,
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
    cached: (data.usage?.cache_read_input_tokens ?? 0) > 0,
  };
}

/**
 * OpenAI GPT-4o API
 * - Standard chat completions format
 */
async function chatOpenAI(
  apiKey: string,
  prompt: string,
  options: ChatOptions,
  signal: AbortSignal
): Promise<ChatResponse> {
  const config = PROVIDER_CONFIGS.openai;
  const maxTokens = options.maxTokens ?? config.maxTokens;
  
  const messages: Array<{ role: string; content: string }> = [];
  
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });
  
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [config.authHeader]: `${config.authPrefix}${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: maxTokens,
      temperature: options.temperature ?? 0.7,
    }),
    signal,
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }
  
  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  
  return {
    content: data.choices[0]?.message?.content || '',
    provider: 'openai',
    model: config.model,
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
  };
}

/**
 * Google Gemini API
 * - Uses REST API with path-based key
 */
async function chatGoogle(
  apiKey: string,
  prompt: string,
  options: ChatOptions,
  signal: AbortSignal
): Promise<ChatResponse> {
  const config = PROVIDER_CONFIGS.google;
  const url = config.urlTemplate.replace('{model}', config.model) + `?key=${apiKey}`;
  
  // Gemini uses different format
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  
  // System prompt goes as first user turn with model response for Gemini
  if (options.systemPrompt) {
    contents.push({ role: 'user', parts: [{ text: `System: ${options.systemPrompt}` }] });
    contents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
  }
  contents.push({ role: 'user', parts: [{ text: prompt }] });
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? config.maxTokens,
        temperature: options.temperature ?? 0.7,
      },
    }),
    signal,
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }
  
  const data = await response.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  };
  
  const content = data.candidates[0]?.content?.parts?.[0]?.text || '';
  
  return {
    content,
    provider: 'google',
    model: config.model,
    inputTokens: data.usageMetadata?.promptTokenCount,
    outputTokens: data.usageMetadata?.candidatesTokenCount,
  };
}

/**
 * xAI Grok API
 * - OpenAI-compatible format
 */
async function chatXAI(
  apiKey: string,
  prompt: string,
  options: ChatOptions,
  signal: AbortSignal
): Promise<ChatResponse> {
  const config = PROVIDER_CONFIGS.xai;
  const maxTokens = options.maxTokens ?? config.maxTokens;
  
  const messages: Array<{ role: string; content: string }> = [];
  
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });
  
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [config.authHeader]: `${config.authPrefix}${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: maxTokens,
      temperature: options.temperature ?? 0.7,
    }),
    signal,
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`xAI API error: ${response.status} - ${error}`);
  }
  
  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  
  return {
    content: data.choices[0]?.message?.content || '',
    provider: 'xai',
    model: config.model,
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
  };
}

/**
 * Check if a specific provider is available (has API key)
 */
export function isProviderAvailable(provider: AIProvider): boolean {
  return !!getProviderApiKey(provider);
}

/**
 * Get model name for current provider
 */
export function getCurrentModel(): string {
  const provider = getActiveProvider();
  return PROVIDER_CONFIGS[provider]?.model || 'unknown';
}

/**
 * Get provider capabilities
 */
export function getProviderCapabilities(provider: AIProvider): {
  thinking: boolean;
  caching: boolean;
  maxContext: number;
} {
  switch (provider) {
    case 'anthropic':
      return { thinking: true, caching: true, maxContext: 200000 };
    case 'openai':
      return { thinking: false, caching: false, maxContext: 128000 };
    case 'google':
      return { thinking: false, caching: false, maxContext: 1000000 };
    case 'xai':
      return { thinking: false, caching: false, maxContext: 100000 };
    default:
      return { thinking: false, caching: false, maxContext: 8000 };
  }
}
