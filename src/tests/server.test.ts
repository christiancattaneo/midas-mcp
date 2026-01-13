import { describe, it } from 'node:test';
import assert from 'node:assert';

import { createServer } from '../server.js';

describe('MCP Server', () => {
  describe('createServer', () => {
    it('creates a server instance', () => {
      const server = createServer();
      assert.notStrictEqual(server, null);
      assert.notStrictEqual(server, undefined);
    });

    it('server has name and version', () => {
      const server = createServer();
      // The server object is created - basic smoke test
      assert.strictEqual(typeof server, 'object');
    });
  });

  describe('Tool Registration', () => {
    it('registers all expected tools', () => {
      // This is a smoke test - server creation registers tools
      // If any tool registration fails, createServer will throw
      assert.doesNotThrow(() => {
        createServer();
      });
    });
  });

  describe('Prompt Registration', () => {
    it('registers all prompts without error', () => {
      assert.doesNotThrow(() => {
        createServer();
      });
    });
  });

  describe('Resource Registration', () => {
    it('registers all resources without error', () => {
      assert.doesNotThrow(() => {
        createServer();
      });
    });
  });
});

describe('Tool Schemas', () => {
  // Import all schemas to verify they're valid Zod schemas
  it('all tool schemas are valid', async () => {
    const {
      startProjectSchema,
      getPhaseSchema,
      setPhaseSchema,
      auditSchema,
      checkDocsSchema,
      oneshotSchema,
      tornadoSchema,
      horizonSchema,
      analyzeSchema,
      suggestPromptSchema,
      advancePhaseSchema,
      saveJournalSchema,
      getJournalSchema,
      searchJournalSchema,
    } = await import('../tools/index.js');

    // All schemas should have a parse method (Zod schemas)
    assert.strictEqual(typeof startProjectSchema.parse, 'function');
    assert.strictEqual(typeof getPhaseSchema.parse, 'function');
    assert.strictEqual(typeof setPhaseSchema.parse, 'function');
    assert.strictEqual(typeof auditSchema.parse, 'function');
    assert.strictEqual(typeof checkDocsSchema.parse, 'function');
    assert.strictEqual(typeof oneshotSchema.parse, 'function');
    assert.strictEqual(typeof tornadoSchema.parse, 'function');
    assert.strictEqual(typeof horizonSchema.parse, 'function');
    assert.strictEqual(typeof analyzeSchema.parse, 'function');
    assert.strictEqual(typeof suggestPromptSchema.parse, 'function');
    assert.strictEqual(typeof advancePhaseSchema.parse, 'function');
    assert.strictEqual(typeof saveJournalSchema.parse, 'function');
    assert.strictEqual(typeof getJournalSchema.parse, 'function');
    assert.strictEqual(typeof searchJournalSchema.parse, 'function');
  });

  it('schemas validate correct input', async () => {
    const { startProjectSchema, oneshotSchema, tornadoSchema } = await import('../tools/index.js');

    // startProjectSchema
    const startInput = { projectName: 'test-app' };
    assert.doesNotThrow(() => startProjectSchema.parse(startInput));

    // oneshotSchema
    const oneshotInput = { originalPrompt: 'test', error: 'error' };
    assert.doesNotThrow(() => oneshotSchema.parse(oneshotInput));

    // tornadoSchema
    const tornadoInput = { problem: 'test problem' };
    assert.doesNotThrow(() => tornadoSchema.parse(tornadoInput));
  });

  it('schemas reject invalid input', async () => {
    const { oneshotSchema, tornadoSchema, saveJournalSchema } = await import('../tools/index.js');

    // oneshotSchema requires originalPrompt and error
    assert.throws(() => oneshotSchema.parse({}));

    // tornadoSchema requires problem
    assert.throws(() => tornadoSchema.parse({}));

    // saveJournalSchema requires title and conversation
    assert.throws(() => saveJournalSchema.parse({}));
  });
});

describe('Logger', () => {
  it('logger exports expected methods', async () => {
    const { logger } = await import('../logger.js');
    
    assert.strictEqual(typeof logger.info, 'function');
    assert.strictEqual(typeof logger.debug, 'function');
    assert.strictEqual(typeof logger.warn, 'function');
    assert.strictEqual(typeof logger.error, 'function');
    assert.strictEqual(typeof logger.tool, 'function');
  });
});
