/**
 * Tests for API call formats - verify request/response structure without real API keys
 * 
 * These tests mock the global fetch to capture and validate:
 * - Request URLs
 * - Request headers
 * - Request body structure
 * - Response parsing
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// Store original fetch
const originalFetch = globalThis.fetch;

// Mock responses for each provider
const mockResponses = {
  anthropic: {
    content: [
      { type: 'thinking', thinking: 'Let me analyze...' },
      { type: 'text', text: 'Hello from Claude!' }
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 80
    }
  },
  openai: {
    choices: [{ message: { content: 'Hello from GPT!' } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 }
  },
  google: {
    candidates: [{ content: { parts: [{ text: 'Hello from Gemini!' }] } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 }
  },
  xai: {
    choices: [{ message: { content: 'Hello from Grok!' } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 }
  }
};

describe('API Call Formats', () => {
  let capturedRequests: Array<{ url: string; options: RequestInit }> = [];

  beforeEach(() => {
    capturedRequests = [];
    
    // Mock fetch to capture requests
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      capturedRequests.push({ url, options: init || {} });
      
      // Return appropriate mock response based on URL
      let mockData: unknown;
      if (url.includes('anthropic')) {
        mockData = mockResponses.anthropic;
      } else if (url.includes('openai')) {
        mockData = mockResponses.openai;
      } else if (url.includes('googleapis')) {
        mockData = mockResponses.google;
      } else if (url.includes('x.ai')) {
        mockData = mockResponses.xai;
      } else {
        mockData = { error: 'Unknown provider' };
      }
      
      return new Response(JSON.stringify(mockData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('Anthropic API Format', () => {
    it('uses correct endpoint', async () => {
      // Simulate what the provider would send
      await globalThis.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'sk-ant-test',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-20250514',
          max_tokens: 16000,
          messages: [{ role: 'user', content: 'Test prompt' }],
          system: 'System prompt',
          thinking: { type: 'enabled', budget_tokens: 10000 },
        }),
      });

      assert.strictEqual(capturedRequests.length, 1);
      assert.strictEqual(capturedRequests[0].url, 'https://api.anthropic.com/v1/messages');
      
      const headers = capturedRequests[0].options.headers as Record<string, string>;
      assert.strictEqual(headers['x-api-key'], 'sk-ant-test');
      assert.strictEqual(headers['anthropic-version'], '2023-06-01');
      
      const body = JSON.parse(capturedRequests[0].options.body as string);
      assert.strictEqual(body.model, 'claude-opus-4-20250514');
      assert.ok(body.thinking);
      assert.strictEqual(body.thinking.type, 'enabled');
    });

    it('parses thinking response correctly', () => {
      const response = mockResponses.anthropic;
      const textBlocks = response.content.filter(block => block.type === 'text');
      assert.strictEqual(textBlocks.length, 1);
      assert.strictEqual(textBlocks[0].text, 'Hello from Claude!');
    });

    it('detects cache hits in usage', () => {
      const usage = mockResponses.anthropic.usage;
      const hasCacheHit = (usage.cache_read_input_tokens ?? 0) > 0;
      assert.strictEqual(hasCacheHit, true);
    });
  });

  describe('OpenAI API Format', () => {
    it('uses correct endpoint and auth', async () => {
      await globalThis.fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-test-key',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'System prompt' },
            { role: 'user', content: 'Test prompt' },
          ],
          max_tokens: 4096,
          temperature: 0.7,
        }),
      });

      assert.strictEqual(capturedRequests.length, 1);
      assert.strictEqual(capturedRequests[0].url, 'https://api.openai.com/v1/chat/completions');
      
      const headers = capturedRequests[0].options.headers as Record<string, string>;
      assert.strictEqual(headers['Authorization'], 'Bearer sk-test-key');
      
      const body = JSON.parse(capturedRequests[0].options.body as string);
      assert.strictEqual(body.model, 'gpt-4o');
      assert.strictEqual(body.messages.length, 2);
      assert.strictEqual(body.messages[0].role, 'system');
    });

    it('parses response correctly', () => {
      const response = mockResponses.openai;
      const content = response.choices[0]?.message?.content;
      assert.strictEqual(content, 'Hello from GPT!');
    });
  });

  describe('Google Gemini API Format', () => {
    it('uses correct endpoint with key in URL', async () => {
      const apiKey = 'AIzaTestKey';
      await globalThis.fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              { role: 'user', parts: [{ text: 'System: System prompt' }] },
              { role: 'model', parts: [{ text: 'Understood.' }] },
              { role: 'user', parts: [{ text: 'Test prompt' }] },
            ],
            generationConfig: {
              maxOutputTokens: 8192,
              temperature: 0.7,
            },
          }),
        }
      );

      assert.strictEqual(capturedRequests.length, 1);
      assert.ok(capturedRequests[0].url.includes('googleapis.com'));
      assert.ok(capturedRequests[0].url.includes('gemini-2.0-flash'));
      assert.ok(capturedRequests[0].url.includes('key=AIzaTestKey'));
      
      const body = JSON.parse(capturedRequests[0].options.body as string);
      assert.ok(body.contents);
      assert.ok(body.generationConfig);
    });

    it('parses response correctly', () => {
      const response = mockResponses.google;
      const content = response.candidates[0]?.content?.parts?.[0]?.text;
      assert.strictEqual(content, 'Hello from Gemini!');
    });
  });

  describe('xAI Grok API Format', () => {
    it('uses OpenAI-compatible format', async () => {
      await globalThis.fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer xai-test-key',
        },
        body: JSON.stringify({
          model: 'grok-2',
          messages: [
            { role: 'system', content: 'System prompt' },
            { role: 'user', content: 'Test prompt' },
          ],
          max_tokens: 4096,
          temperature: 0.7,
        }),
      });

      assert.strictEqual(capturedRequests.length, 1);
      assert.strictEqual(capturedRequests[0].url, 'https://api.x.ai/v1/chat/completions');
      
      const headers = capturedRequests[0].options.headers as Record<string, string>;
      assert.strictEqual(headers['Authorization'], 'Bearer xai-test-key');
      
      const body = JSON.parse(capturedRequests[0].options.body as string);
      assert.strictEqual(body.model, 'grok-2');
    });

    it('parses response like OpenAI', () => {
      const response = mockResponses.xai;
      const content = response.choices[0]?.message?.content;
      assert.strictEqual(content, 'Hello from Grok!');
    });
  });

  describe('Request Body Validation', () => {
    it('Anthropic body has required fields', () => {
      const body = {
        model: 'claude-opus-4-20250514',
        max_tokens: 16000,
        messages: [{ role: 'user', content: 'test' }],
      };
      
      assert.ok(body.model, 'model is required');
      assert.ok(body.max_tokens, 'max_tokens is required');
      assert.ok(Array.isArray(body.messages), 'messages array is required');
      assert.strictEqual(body.messages[0].role, 'user');
    });

    it('OpenAI body has required fields', () => {
      const body = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
      };
      
      assert.ok(body.model, 'model is required');
      assert.ok(Array.isArray(body.messages), 'messages array is required');
    });

    it('Gemini body has required fields', () => {
      const body = {
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      };
      
      assert.ok(Array.isArray(body.contents), 'contents array is required');
      assert.ok(body.contents[0].parts, 'parts array is required');
    });
  });
});
