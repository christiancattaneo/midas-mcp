import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';

const CONFIG_DIR = join(homedir(), '.midas');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// Supported AI providers
export type AIProvider = 'anthropic' | 'openai' | 'google' | 'xai';

export interface MidasConfig {
  // Active provider
  provider: AIProvider;
  
  // API keys for each provider
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;      // Gemini
  xaiApiKey?: string;         // Grok
  
  // Metadata
  createdAt: string;
  lastUsed: string;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): MidasConfig {
  ensureConfigDir();
  
  if (!existsSync(CONFIG_FILE)) {
    return {
      provider: 'anthropic',
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
    };
  }

  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    // Ensure provider field exists (migration)
    if (!parsed.provider) {
      parsed.provider = 'anthropic';
    }
    return parsed;
  } catch {
    return {
      provider: 'anthropic',
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
    };
  }
}

export function saveConfig(config: MidasConfig): void {
  ensureConfigDir();
  config.lastUsed = new Date().toISOString();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getActiveProvider(): AIProvider {
  const config = loadConfig();
  return config.provider;
}

export function setActiveProvider(provider: AIProvider): void {
  const config = loadConfig();
  config.provider = provider;
  saveConfig(config);
}

// Get API key for a specific provider
export function getProviderApiKey(provider: AIProvider): string | undefined {
  const envKeys: Record<AIProvider, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GOOGLE_API_KEY',
    xai: 'XAI_API_KEY',
  };
  
  // Check env var first
  const envKey = process.env[envKeys[provider]];
  if (envKey) return envKey;
  
  // Then check config
  const config = loadConfig();
  switch (provider) {
    case 'anthropic': return config.anthropicApiKey;
    case 'openai': return config.openaiApiKey;
    case 'google': return config.googleApiKey;
    case 'xai': return config.xaiApiKey;
    default: return undefined;
  }
}

// Get API key for active provider (backward compatible)
export function getApiKey(): string | undefined {
  const provider = getActiveProvider();
  return getProviderApiKey(provider);
}

export function hasApiKey(): boolean {
  return !!getApiKey();
}

// Set API key for a specific provider
export function setProviderApiKey(provider: AIProvider, apiKey: string): void {
  const config = loadConfig();
  switch (provider) {
    case 'anthropic': config.anthropicApiKey = apiKey; break;
    case 'openai': config.openaiApiKey = apiKey; break;
    case 'google': config.googleApiKey = apiKey; break;
    case 'xai': config.xaiApiKey = apiKey; break;
  }
  saveConfig(config);
}

// Validate API key format
export function validateApiKey(provider: AIProvider, key: string): boolean {
  switch (provider) {
    case 'anthropic':
      return key.startsWith('sk-ant-');
    case 'openai':
      return key.startsWith('sk-') && !key.startsWith('sk-ant-');
    case 'google':
      return key.startsWith('AIza');
    case 'xai':
      return key.startsWith('xai-');
    default:
      return key.length > 10;
  }
}

// Get provider display info
export function getProviderInfo(provider: AIProvider): { name: string; model: string; url: string } {
  switch (provider) {
    case 'anthropic':
      return { name: 'Anthropic', model: 'claude-opus-4-20250514', url: 'console.anthropic.com' };
    case 'openai':
      return { name: 'OpenAI', model: 'gpt-4o', url: 'platform.openai.com' };
    case 'google':
      return { name: 'Google', model: 'gemini-2.0-flash', url: 'ai.google.dev' };
    case 'xai':
      return { name: 'xAI', model: 'grok-2', url: 'console.x.ai' };
    default:
      return { name: 'Unknown', model: 'unknown', url: '' };
  }
}

export async function promptForApiKey(): Promise<string | undefined> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const config = loadConfig();
    const provider = config.provider;
    const info = getProviderInfo(provider);
    
    console.log('\n');
    console.log('  ┌─────────────────────────────────────────────────┐');
    console.log('  │  MIDAS - First Time Setup                       │');
    console.log('  ├─────────────────────────────────────────────────┤');
    console.log('  │                                                 │');
    console.log(`  │  Provider: ${info.name.padEnd(37)}│`);
    console.log(`  │  Model: ${info.model.padEnd(40)}│`);
    console.log('  │                                                 │');
    console.log('  │  For AI-powered features (smart prompts,        │');
    console.log('  │  codebase analysis, auto-detection), Midas      │');
    console.log('  │  needs an API key.                              │');
    console.log('  │                                                 │');
    console.log(`  │  Get one at: ${info.url.padEnd(35)}│`);
    console.log('  │                                                 │');
    console.log('  │  This is optional. Press Enter to skip.         │');
    console.log('  │                                                 │');
    console.log('  └─────────────────────────────────────────────────┘');
    console.log('');

    rl.question(`  ${info.name} API Key: `, (answer) => {
      rl.close();
      
      const key = answer.trim();
      
      if (key && validateApiKey(provider, key)) {
        setProviderApiKey(provider, key);
        console.log('\n  OK - API key saved to ~/.midas/config.json\n');
        resolve(key);
      } else if (key) {
        console.log('\n  Invalid key format. Skipping.\n');
        resolve(undefined);
      } else {
        console.log('\n  Skipped. You can add it later in ~/.midas/config.json\n');
        resolve(undefined);
      }
    });
  });
}

export async function ensureApiKey(): Promise<string | undefined> {
  const existing = getApiKey();
  if (existing) return existing;
  
  // Check if this is first run
  const config = loadConfig();
  const provider = config.provider;
  const hasKey = getProviderApiKey(provider);
  
  if (!hasKey) {
    return promptForApiKey();
  }
  
  return undefined;
}

// List configured providers (those with API keys)
export function listConfiguredProviders(): AIProvider[] {
  const providers: AIProvider[] = ['anthropic', 'openai', 'google', 'xai'];
  return providers.filter(p => !!getProviderApiKey(p));
}
