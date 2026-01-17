import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { suggestPrompt } from '../tools/analyze.js';
import { setPhase } from '../state/phase.js';

describe('Prompt Generation System', () => {
  const testDir = join(tmpdir(), 'midas-prompts-test-' + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('PLAN prompts', () => {
    it('IDEA step focuses on problem definition', () => {
      setPhase(testDir, { phase: 'PLAN', step: 'IDEA' });
      const result = suggestPrompt({ projectPath: testDir });
      
      assert.strictEqual(result.prompt.includes('problem'), true);
      assert.strictEqual(result.prompt.includes('Who'), true);
    });

    it('RESEARCH step focuses on competitive analysis', () => {
      setPhase(testDir, { phase: 'PLAN', step: 'RESEARCH' });
      const result = suggestPrompt({ projectPath: testDir });
      
      assert.strictEqual(result.prompt.includes('similar solutions'), true);
    });

    it('BRAINLIFT step captures unique insights', () => {
      setPhase(testDir, { phase: 'PLAN', step: 'BRAINLIFT' });
      const result = suggestPrompt({ projectPath: testDir });
      
      assert.strictEqual(result.prompt.includes('unique insights'), true);
      assert.strictEqual(result.prompt.includes('conventional wisdom'), true);
    });

    it('PRD step defines goals and non-goals', () => {
      setPhase(testDir, { phase: 'PLAN', step: 'PRD' });
      const result = suggestPrompt({ projectPath: testDir });
      
      assert.strictEqual(result.prompt.includes('PRD'), true);
      assert.strictEqual(result.prompt.includes('Goals'), true);
      assert.strictEqual(result.prompt.includes('Non-goals'), true);
    });

    it('GAMEPLAN step plans implementation', () => {
      setPhase(testDir, { phase: 'PLAN', step: 'GAMEPLAN' });
      const result = suggestPrompt({ projectPath: testDir });
      
      assert.strictEqual(result.prompt.includes('gameplan'), true);
      assert.strictEqual(result.prompt.includes('Tech stack'), true);
    });
  });

  describe('BUILD prompts', () => {
    it('RULES step loads constraints', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'RULES' });
      const result = suggestPrompt({ projectPath: testDir });
      
      assert.strictEqual(result.prompt.includes('rules'), true);
    });

    it('INDEX step understands architecture', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'INDEX' });
      const result = suggestPrompt({ projectPath: testDir });
      
      assert.strictEqual(result.prompt.includes('codebase structure'), true);
    });

    it('READ step loads specific files', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'READ' });
      const result = suggestPrompt({ projectPath: testDir });
      
      assert.strictEqual(result.prompt.includes('Read'), true);
      assert.strictEqual(result.prompt.includes('files'), true);
    });

    it('RESEARCH step gathers external knowledge', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'RESEARCH' });
      const result = suggestPrompt({ projectPath: testDir });
      
      assert.strictEqual(result.prompt.includes('documentation'), true);
    });

    it('IMPLEMENT step follows TDD', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'IMPLEMENT' });
      const result = suggestPrompt({ projectPath: testDir });
      
      assert.strictEqual(result.prompt.includes('test'), true);
      assert.strictEqual(result.prompt.includes('one thing'), true);
    });

    it('TEST step verifies implementation', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'TEST' });
      const result = suggestPrompt({ projectPath: testDir });
      
      assert.strictEqual(result.prompt.includes('Run the tests'), true);
      assert.strictEqual(result.prompt.includes('edge case'), true);
    });

    it('DEBUG step uses Tornado approach', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'DEBUG' });
      const result = suggestPrompt({ projectPath: testDir });
      
      assert.strictEqual(result.prompt.includes('Tornado'), true);
      assert.strictEqual(result.prompt.includes('Research'), true);
      assert.strictEqual(result.prompt.includes('logs'), true);
    });
  });

  describe('SHIP prompts', () => {
    it('REVIEW step audits security and performance', () => {
      setPhase(testDir, { phase: 'SHIP', step: 'REVIEW' });
      const result = suggestPrompt({ projectPath: testDir });
      
      assert.strictEqual(result.prompt.includes('security'), true);
      assert.strictEqual(result.prompt.includes('performance'), true);
    });

    it('DEPLOY step prepares deployment', () => {
      setPhase(testDir, { phase: 'SHIP', step: 'DEPLOY' });
      const result = suggestPrompt({ projectPath: testDir });
      
      assert.strictEqual(result.prompt.includes('deployment'), true);
      assert.strictEqual(result.prompt.includes('environment'), true);
    });

    it('MONITOR step sets up observability', () => {
      setPhase(testDir, { phase: 'SHIP', step: 'MONITOR' });
      const result = suggestPrompt({ projectPath: testDir });
      
      assert.strictEqual(result.prompt.includes('monitoring'), true);
      assert.strictEqual(result.prompt.includes('alerts'), true);
    });
  });

  describe('GROW prompts', () => {
    it('DONE step shows graduation checklist', () => {
      setPhase(testDir, { phase: 'GROW', step: 'DONE' });
      const result = suggestPrompt({ projectPath: testDir });
      
      // DONE step should mention the graduation checklist
      assert.strictEqual(result.prompt.toLowerCase().includes('shipped') || result.prompt.toLowerCase().includes('announce'), true);
    });
  });

  describe('Context substitution', () => {
    it('substitutes feature context in IMPLEMENT', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'IMPLEMENT' });
      const result = suggestPrompt({ 
        projectPath: testDir, 
        context: 'user authentication module' 
      });
      
      assert.strictEqual(result.prompt.includes('user authentication module'), true);
    });

    it('substitutes idea context in PLAN:IDEA', () => {
      setPhase(testDir, { phase: 'PLAN', step: 'IDEA' });
      const result = suggestPrompt({ 
        projectPath: testDir, 
        context: 'task management app' 
      });
      
      assert.strictEqual(result.prompt.includes('task management app'), true);
    });

    it('substitutes problem context in DEBUG', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'DEBUG' });
      const result = suggestPrompt({ 
        projectPath: testDir, 
        context: 'authentication fails on refresh' 
      });
      
      assert.strictEqual(result.prompt.includes('authentication fails on refresh'), true);
    });
  });
});
