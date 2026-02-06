import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { startProject } from '../tools/phase.js';
import { audit } from '../tools/audit.js';
import { checkDocs } from '../tools/docs.js';
import { constructOneshot } from '../tools/oneshot.js';
import { triggerTornado } from '../tools/tornado.js';
import { expandHorizon } from '../tools/horizon.js';

describe('MCP Tools', () => {
  const testDir = join(tmpdir(), 'midas-tools-test-' + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('startProject', () => {
    it('creates docs directory with templates', () => {
      const result = startProject({ projectName: 'test-app', projectPath: testDir });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.message.includes('test-app'), true);
    });

    it('returns next steps', () => {
      const result = startProject({ projectName: 'test', projectPath: testDir });
      assert.strictEqual(result.nextSteps.length > 0, true);
    });
  });

  describe('audit', () => {
    it('returns scores for all 12 ingredients', () => {
      const result = audit({ projectPath: testDir });
      const keys = Object.keys(result.scores);
      assert.strictEqual(keys.length, 12);
    });

    it('detects missing components', () => {
      const result = audit({ projectPath: testDir });
      // Empty project should have low scores
      assert.strictEqual(result.overall < 30, true);
    });

    it('detects package.json dependencies', () => {
      // Create a package.json with react
      const pkg = { dependencies: { react: '18.0.0' } };
      writeFileSync(join(testDir, 'package.json'), JSON.stringify(pkg));
      
      const result = audit({ projectPath: testDir });
      assert.strictEqual(result.scores['1-frontend'].exists, true);
    });

    it('assigns appropriate level', () => {
      const result = audit({ projectPath: testDir });
      assert.strictEqual(['functional', 'integrated', 'protected', 'production'].includes(result.level), true);
    });
  });

  describe('checkDocs', () => {
    it('reports missing docs', () => {
      const result = checkDocs({ projectPath: testDir });
      assert.strictEqual(result.prd.exists, false);
      assert.strictEqual(result.gameplan.exists, false);
      assert.strictEqual(result.ready, false);
    });

    it('detects incomplete docs with placeholders', () => {
      // Create docs with unfilled placeholders
      mkdirSync(join(testDir, 'docs'), { recursive: true });
      writeFileSync(
        join(testDir, 'docs', 'prd.md'),
        '# PRD\n## Goals\n[Fill this in]\n## Requirements\nSome content'
      );
      
      const result = checkDocs({ projectPath: testDir });
      assert.strictEqual(result.prd.exists, true);
      assert.strictEqual(result.prd.complete, false);
      assert.strictEqual(result.prd.issues.length > 0, true);
    });
  });

  describe('constructOneshot', () => {
    it('constructs retry prompt with error', () => {
      const result = constructOneshot({
        originalPrompt: 'Create a button',
        error: 'TypeError: Cannot read property',
      });
      assert.strictEqual(result.prompt.includes('Create a button'), true);
      assert.strictEqual(result.prompt.includes('TypeError'), true);
    });

    it('includes learnings if provided', () => {
      const result = constructOneshot({
        originalPrompt: 'Create a button',
        error: 'Failed',
        learnings: ['Check null values', 'Validate input'],
      });
      assert.strictEqual(result.prompt.includes('Check null values'), true);
      assert.strictEqual(result.prompt.includes('Validate input'), true);
    });
  });

  describe('triggerTornado', () => {
    it('starts with research step', () => {
      const result = triggerTornado({ problem: 'Button not working' });
      assert.strictEqual(result.nextStep, 'research');
    });

    it('progresses through cycle', () => {
      const r1 = triggerTornado({ problem: 'Bug', currentStep: 'research' });
      assert.strictEqual(r1.nextStep, 'logs');
      
      const r2 = triggerTornado({ problem: 'Bug', currentStep: 'logs' });
      assert.strictEqual(r2.nextStep, 'tests');
      
      const r3 = triggerTornado({ problem: 'Bug', currentStep: 'tests' });
      assert.strictEqual(r3.nextStep, 'research'); // Cycles back
    });

    it('includes relevant guidance and prompt', () => {
      const result = triggerTornado({ problem: 'API error' });
      assert.strictEqual(typeof result.guidance, 'string');
      assert.strictEqual(typeof result.prompt, 'string');
      assert.strictEqual(result.prompt.includes('API error'), true);
    });
  });

  describe('expandHorizon', () => {
    it('returns checklist categories', () => {
      const result = expandHorizon({
        currentOutput: 'Generic component',
        expectedOutput: 'Component matching our design system',
      });
      assert.strictEqual(result.checklist.length, 6);
      assert.strictEqual(result.checklist.some(c => c.includes('INTEGRATIONS')), true);
    });

    it('generates expanded prompt', () => {
      const result = expandHorizon({
        currentOutput: 'Created new util',
        expectedOutput: 'Use existing pattern from utils/',
      });
      assert.strictEqual(result.expandedPrompt.includes('Created new util'), true);
      assert.strictEqual(result.expandedPrompt.includes('Patterns'), true);
    });

    it('identifies missing context', () => {
      const result = expandHorizon({
        currentOutput: 'generic solution',
        expectedOutput: 'specific implementation',
      });
      assert.strictEqual(result.missingContext.length > 0, true);
    });
  });
});
