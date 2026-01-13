/**
 * Tests for multi-provider AI abstraction
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { 
  validateApiKey,
  getProviderInfo,
  type AIProvider,
} from '../config.js';
import { 
  getProviderCapabilities, 
  isProviderAvailable,
} from '../providers.js';
import {
  getProvider,
  setProvider,
  listProviders,
} from '../tools/config.js';

describe('Provider System', () => {
  describe('validateApiKey', () => {
    it('validates Anthropic key format', () => {
      assert.strictEqual(validateApiKey('anthropic', 'sk-ant-abc123'), true);
      assert.strictEqual(validateApiKey('anthropic', 'sk-abc123'), false);
      assert.strictEqual(validateApiKey('anthropic', 'invalid'), false);
    });

    it('validates OpenAI key format', () => {
      assert.strictEqual(validateApiKey('openai', 'sk-abc123def456'), true);
      assert.strictEqual(validateApiKey('openai', 'sk-ant-abc'), false); // Anthropic format
      assert.strictEqual(validateApiKey('openai', 'invalid'), false);
    });

    it('validates Google key format', () => {
      assert.strictEqual(validateApiKey('google', 'AIzaSyAbc123'), true);
      assert.strictEqual(validateApiKey('google', 'sk-abc123'), false);
    });

    it('validates xAI key format', () => {
      assert.strictEqual(validateApiKey('xai', 'xai-abc123'), true);
      assert.strictEqual(validateApiKey('xai', 'sk-abc123'), false);
    });
  });

  describe('getProviderInfo', () => {
    it('returns Anthropic info', () => {
      const info = getProviderInfo('anthropic');
      assert.strictEqual(info.name, 'Anthropic');
      assert.ok(info.model.includes('claude'));
      assert.strictEqual(info.url, 'console.anthropic.com');
    });

    it('returns OpenAI info', () => {
      const info = getProviderInfo('openai');
      assert.strictEqual(info.name, 'OpenAI');
      assert.ok(info.model.includes('gpt'));
      assert.strictEqual(info.url, 'platform.openai.com');
    });

    it('returns Google info', () => {
      const info = getProviderInfo('google');
      assert.strictEqual(info.name, 'Google');
      assert.ok(info.model.includes('gemini'));
      assert.strictEqual(info.url, 'ai.google.dev');
    });

    it('returns xAI info', () => {
      const info = getProviderInfo('xai');
      assert.strictEqual(info.name, 'xAI');
      assert.ok(info.model.includes('grok'));
      assert.strictEqual(info.url, 'console.x.ai');
    });
  });

  describe('getProviderCapabilities', () => {
    it('Anthropic has thinking and caching', () => {
      const caps = getProviderCapabilities('anthropic');
      assert.strictEqual(caps.thinking, true);
      assert.strictEqual(caps.caching, true);
      assert.ok(caps.maxContext >= 100000);
    });

    it('OpenAI has no extended thinking', () => {
      const caps = getProviderCapabilities('openai');
      assert.strictEqual(caps.thinking, false);
      assert.ok(caps.maxContext >= 100000);
    });

    it('Google has large context', () => {
      const caps = getProviderCapabilities('google');
      assert.ok(caps.maxContext >= 1000000);
    });

    it('xAI has reasonable context', () => {
      const caps = getProviderCapabilities('xai');
      assert.ok(caps.maxContext >= 50000);
    });
  });

  describe('Provider tools', () => {
    it('getProvider returns current provider', () => {
      const result = getProvider();
      assert.ok(['anthropic', 'openai', 'google', 'xai'].includes(result.provider));
      assert.ok(typeof result.model === 'string');
      assert.ok(typeof result.hasApiKey === 'boolean');
      assert.ok(Array.isArray(result.configuredProviders));
    });

    it('setProvider switches provider', () => {
      const result = setProvider({ provider: 'openai' });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.provider, 'openai');
      
      // Switch back to anthropic
      setProvider({ provider: 'anthropic' });
    });

    it('listProviders returns all providers', () => {
      const result = listProviders();
      assert.strictEqual(result.providers.length, 4);
      assert.ok(result.providers.some(p => p.id === 'anthropic'));
      assert.ok(result.providers.some(p => p.id === 'openai'));
      assert.ok(result.providers.some(p => p.id === 'google'));
      assert.ok(result.providers.some(p => p.id === 'xai'));
    });

    it('provider details include capabilities', () => {
      const result = listProviders();
      const anthropic = result.providers.find(p => p.id === 'anthropic');
      assert.ok(anthropic);
      assert.strictEqual(anthropic.capabilities.thinking, true);
      assert.strictEqual(anthropic.capabilities.caching, true);
    });
  });

  describe('Provider detection', () => {
    it('isProviderAvailable checks for API key', () => {
      // Without env vars set, this should return false for most providers
      const hasAnthropic = isProviderAvailable('anthropic');
      // Just verify it returns a boolean
      assert.ok(typeof hasAnthropic === 'boolean');
    });
  });
});
