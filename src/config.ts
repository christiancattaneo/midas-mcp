import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';

const CONFIG_DIR = join(homedir(), '.midas');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface MidasConfig {
  anthropicApiKey?: string;
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
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
    };
  }

  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {
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

export function getApiKey(): string | undefined {
  // Check env var first
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }
  
  // Then check config
  const config = loadConfig();
  return config.anthropicApiKey;
}

export function hasApiKey(): boolean {
  return !!getApiKey();
}

export async function promptForApiKey(): Promise<string | undefined> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log('\n');
    console.log('  ┌─────────────────────────────────────────────────┐');
    console.log('  │  MIDAS - First Time Setup                       │');
    console.log('  ├─────────────────────────────────────────────────┤');
    console.log('  │                                                 │');
    console.log('  │  For AI-powered features (smart prompts,        │');
    console.log('  │  codebase analysis, auto-detection), Midas      │');
    console.log('  │  needs an Anthropic API key.                    │');
    console.log('  │                                                 │');
    console.log('  │  Get one at: console.anthropic.com              │');
    console.log('  │                                                 │');
    console.log('  │  This is optional. Press Enter to skip.         │');
    console.log('  │                                                 │');
    console.log('  └─────────────────────────────────────────────────┘');
    console.log('');

    rl.question('  Anthropic API Key: ', (answer) => {
      rl.close();
      
      const key = answer.trim();
      
      if (key && key.startsWith('sk-ant-')) {
        const config = loadConfig();
        config.anthropicApiKey = key;
        saveConfig(config);
        console.log('\n  OK - API key saved to ~/.midas/config.json\n');
        resolve(key);
      } else if (key) {
        console.log('\n  ⚠ Invalid key format. Skipping.\n');
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
  if (!config.anthropicApiKey && !process.env.ANTHROPIC_API_KEY) {
    return promptForApiKey();
  }
  
  return undefined;
}
