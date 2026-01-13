/**
 * MCP tools for Midas configuration management
 */
import { z } from 'zod';
import { 
  getActiveProvider, 
  setActiveProvider, 
  getProviderApiKey, 
  setProviderApiKey,
  validateApiKey,
  getProviderInfo,
  listConfiguredProviders,
  type AIProvider,
} from '../config.js';
import { getProviderCapabilities, getCurrentModel } from '../providers.js';

// ============================================================================
// GET PROVIDER
// ============================================================================

export const getProviderSchema = z.object({});

export type GetProviderInput = z.infer<typeof getProviderSchema>;

export interface GetProviderResult {
  provider: AIProvider;
  model: string;
  hasApiKey: boolean;
  capabilities: {
    thinking: boolean;
    caching: boolean;
    maxContext: number;
  };
  configuredProviders: AIProvider[];
}

export function getProvider(): GetProviderResult {
  const provider = getActiveProvider();
  const info = getProviderInfo(provider);
  const capabilities = getProviderCapabilities(provider);
  const hasApiKey = !!getProviderApiKey(provider);
  const configuredProviders = listConfiguredProviders();
  
  return {
    provider,
    model: info.model,
    hasApiKey,
    capabilities,
    configuredProviders,
  };
}

// ============================================================================
// SET PROVIDER
// ============================================================================

export const setProviderSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google', 'xai'])
    .describe('AI provider to use: anthropic (Claude), openai (GPT-4o), google (Gemini), xai (Grok)'),
});

export type SetProviderInput = z.infer<typeof setProviderSchema>;

export interface SetProviderResult {
  success: boolean;
  provider: AIProvider;
  model: string;
  hasApiKey: boolean;
  message: string;
}

export function setProvider(input: SetProviderInput): SetProviderResult {
  const provider = input.provider;
  setActiveProvider(provider);
  
  const info = getProviderInfo(provider);
  const hasApiKey = !!getProviderApiKey(provider);
  
  return {
    success: true,
    provider,
    model: info.model,
    hasApiKey,
    message: hasApiKey 
      ? `Switched to ${info.name} (${info.model})`
      : `Switched to ${info.name} but no API key configured. Set ${provider.toUpperCase()}_API_KEY or add to ~/.midas/config.json`,
  };
}

// ============================================================================
// SET API KEY
// ============================================================================

export const setApiKeySchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google', 'xai'])
    .describe('Provider to set API key for'),
  apiKey: z.string().min(10).max(200)
    .describe('API key for the provider'),
});

export type SetApiKeyInput = z.infer<typeof setApiKeySchema>;

export interface SetApiKeyResult {
  success: boolean;
  provider: AIProvider;
  message: string;
}

export function setApiKey(input: SetApiKeyInput): SetApiKeyResult {
  const { provider, apiKey } = input;
  
  if (!validateApiKey(provider, apiKey)) {
    return {
      success: false,
      provider,
      message: `Invalid API key format for ${provider}`,
    };
  }
  
  setProviderApiKey(provider, apiKey);
  
  return {
    success: true,
    provider,
    message: `API key saved for ${provider}`,
  };
}

// ============================================================================
// LIST PROVIDERS
// ============================================================================

export const listProvidersSchema = z.object({});

export type ListProvidersInput = z.infer<typeof listProvidersSchema>;

export interface ProviderDetails {
  id: AIProvider;
  name: string;
  model: string;
  url: string;
  hasApiKey: boolean;
  isActive: boolean;
  capabilities: {
    thinking: boolean;
    caching: boolean;
    maxContext: number;
  };
}

export interface ListProvidersResult {
  active: AIProvider;
  providers: ProviderDetails[];
}

export function listProviders(): ListProvidersResult {
  const active = getActiveProvider();
  const allProviders: AIProvider[] = ['anthropic', 'openai', 'google', 'xai'];
  
  const providers: ProviderDetails[] = allProviders.map(id => {
    const info = getProviderInfo(id);
    const capabilities = getProviderCapabilities(id);
    return {
      id,
      name: info.name,
      model: info.model,
      url: info.url,
      hasApiKey: !!getProviderApiKey(id),
      isActive: id === active,
      capabilities,
    };
  });
  
  return { active, providers };
}
