import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { suggestPrompt, advancePhase } from '../tools/analyze.js';
import { setPhase, loadState } from '../state/phase.js';

describe('Analyze Tools', () => {
  const testDir = join(tmpdir(), 'midas-analyze-test-' + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('suggestPrompt', () => {
    it('returns IDLE prompt for new project', () => {
      const result = suggestPrompt({ projectPath: testDir });
      assert.strictEqual(result.phase, 'IDLE');
      assert.strictEqual(result.prompt.includes('start a new project'), true);
    });

    it('returns phase-specific prompt for EAGLE_SIGHT', () => {
      setPhase(testDir, { phase: 'EAGLE_SIGHT', step: 'IDEA' });
      const result = suggestPrompt({ projectPath: testDir });
      assert.strictEqual(result.phase, 'EAGLE_SIGHT');
      assert.strictEqual(result.step, 'IDEA');
      assert.strictEqual(result.prompt.includes('want to build'), true);
    });

    it('returns phase-specific prompt for BUILD', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'IMPLEMENT' });
      const result = suggestPrompt({ projectPath: testDir });
      assert.strictEqual(result.phase, 'BUILD');
      assert.strictEqual(result.step, 'IMPLEMENT');
      assert.strictEqual(result.prompt.includes('Implement'), true);
    });

    it('returns phase-specific prompt for SHIP', () => {
      setPhase(testDir, { phase: 'SHIP', step: 'REVIEW' });
      const result = suggestPrompt({ projectPath: testDir });
      assert.strictEqual(result.phase, 'SHIP');
      assert.strictEqual(result.step, 'REVIEW');
      assert.strictEqual(result.prompt.includes('security'), true);
    });

    it('returns phase-specific prompt for GROW', () => {
      setPhase(testDir, { phase: 'GROW', step: 'DONE' });
      const result = suggestPrompt({ projectPath: testDir });
      assert.strictEqual(result.phase, 'GROW');
      assert.strictEqual(result.step, 'DONE');
      assert.strictEqual(result.prompt.toLowerCase().includes('shipped') || result.prompt.toLowerCase().includes('announce'), true);
    });

    it('substitutes context into prompt placeholders', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'IMPLEMENT' });
      const result = suggestPrompt({ projectPath: testDir, context: 'user authentication' });
      assert.strictEqual(result.prompt.includes('user authentication'), true);
    });

    it('includes explanation with every prompt', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'TEST' });
      const result = suggestPrompt({ projectPath: testDir });
      assert.strictEqual(typeof result.explanation, 'string');
      assert.strictEqual(result.explanation.length > 0, true);
    });
  });

  describe('advancePhase', () => {
    it('advances from IDLE to EAGLE_SIGHT:IDEA', () => {
      const result = advancePhase({ projectPath: testDir });
      assert.strictEqual(result.current.phase, 'EAGLE_SIGHT');
      assert.strictEqual(result.current.step, 'IDEA');
      assert.strictEqual(result.previous.phase, 'IDLE');
    });

    it('advances within EAGLE_SIGHT phase', () => {
      setPhase(testDir, { phase: 'EAGLE_SIGHT', step: 'IDEA' });
      const result = advancePhase({ projectPath: testDir });
      assert.strictEqual(result.current.phase, 'EAGLE_SIGHT');
      assert.strictEqual(result.current.step, 'RESEARCH');
      assert.strictEqual(result.previous.step, 'IDEA');
    });

    it('transitions from EAGLE_SIGHT to BUILD (forced)', () => {
      setPhase(testDir, { phase: 'EAGLE_SIGHT', step: 'GAMEPLAN' });
      // Force advancement since test has no planning docs
      const result = advancePhase({ projectPath: testDir, force: true });
      assert.strictEqual(result.current.phase, 'BUILD');
      assert.strictEqual(result.current.step, 'RULES');
    });

    it('blocks EAGLE_SIGHT to BUILD without planning docs', () => {
      setPhase(testDir, { phase: 'EAGLE_SIGHT', step: 'GAMEPLAN' });
      const result = advancePhase({ projectPath: testDir });
      // Should be blocked since there are no planning docs
      assert.strictEqual(result.blocked, true);
      assert.strictEqual(result.current.phase, 'EAGLE_SIGHT');
      assert.ok(result.blockers && result.blockers.length > 0);
    });

    it('advances through BUILD steps', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'RULES' });
      const result = advancePhase({ projectPath: testDir });
      assert.strictEqual(result.current.step, 'INDEX');
    });

    it('transitions from BUILD to SHIP', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'DEBUG' });
      const result = advancePhase({ projectPath: testDir });
      assert.strictEqual(result.current.phase, 'SHIP');
      assert.strictEqual(result.current.step, 'REVIEW');
    });

    it('transitions from SHIP to GROW', () => {
      setPhase(testDir, { phase: 'SHIP', step: 'MONITOR' });
      const result = advancePhase({ projectPath: testDir });
      assert.strictEqual(result.current.phase, 'GROW');
      assert.strictEqual(result.current.step, 'DONE');
    });

    it('loops from GROW back to EAGLE_SIGHT', () => {
      setPhase(testDir, { phase: 'GROW', step: 'DONE' });
      const result = advancePhase({ projectPath: testDir });
      assert.strictEqual(result.current.phase, 'EAGLE_SIGHT');
      assert.strictEqual(result.current.step, 'IDEA');
    });

    it('persists the new phase to state', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'IMPLEMENT' });
      advancePhase({ projectPath: testDir });
      
      const state = loadState(testDir);
      assert.strictEqual(state.current.phase, 'BUILD');
      assert.strictEqual((state.current as { step: string }).step, 'TEST');
    });

    it('returns descriptive message', () => {
      const result = advancePhase({ projectPath: testDir });
      assert.strictEqual(result.message.includes('Advanced from'), true);
      assert.strictEqual(result.message.includes('IDLE'), true);
      assert.strictEqual(result.message.includes('EAGLE_SIGHT'), true);
    });
  });
});
