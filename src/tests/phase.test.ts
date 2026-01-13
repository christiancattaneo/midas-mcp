import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadState,
  saveState,
  setPhase,
  getDefaultState,
  getNextPhase,
  getPrevPhase,
  getPhaseGuidance,
  type Phase,
} from '../state/phase.js';

describe('Phase State Machine', () => {
  const testDir = join(tmpdir(), 'midas-test-' + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('loadState', () => {
    it('returns default state for new project', () => {
      const state = loadState(testDir);
      assert.deepStrictEqual(state.current, { phase: 'IDLE' });
      assert.strictEqual(state.history.length, 0);
    });

    it('returns saved state if exists', () => {
      const customState = getDefaultState();
      customState.current = { phase: 'EAGLE_SIGHT', step: 'RESEARCH' };
      saveState(testDir, customState);

      const loaded = loadState(testDir);
      assert.deepStrictEqual(loaded.current, { phase: 'EAGLE_SIGHT', step: 'RESEARCH' });
    });
  });

  describe('saveState', () => {
    it('creates .midas directory', () => {
      const state = getDefaultState();
      saveState(testDir, state);
      assert.strictEqual(existsSync(join(testDir, '.midas')), true);
    });

    it('persists state to file', () => {
      const state = getDefaultState();
      state.current = { phase: 'BUILD', step: 'IMPLEMENT' };
      saveState(testDir, state);

      const loaded = loadState(testDir);
      assert.deepStrictEqual(loaded.current, { phase: 'BUILD', step: 'IMPLEMENT' });
    });
  });

  describe('setPhase', () => {
    it('updates current phase', () => {
      const newPhase: Phase = { phase: 'EAGLE_SIGHT', step: 'IDEA' };
      const state = setPhase(testDir, newPhase);
      assert.deepStrictEqual(state.current, newPhase);
    });

    it('adds previous phase to history', () => {
      setPhase(testDir, { phase: 'EAGLE_SIGHT', step: 'IDEA' });
      setPhase(testDir, { phase: 'EAGLE_SIGHT', step: 'RESEARCH' });

      const state = loadState(testDir);
      assert.strictEqual(state.history.length, 2);
      assert.deepStrictEqual(state.history[1], { phase: 'EAGLE_SIGHT', step: 'IDEA' });
    });
  });

  describe('getNextPhase', () => {
    it('returns first step from IDLE', () => {
      const next = getNextPhase({ phase: 'IDLE' });
      assert.deepStrictEqual(next, { phase: 'EAGLE_SIGHT', step: 'IDEA' });
    });

    it('advances within same phase', () => {
      const next = getNextPhase({ phase: 'EAGLE_SIGHT', step: 'IDEA' });
      assert.deepStrictEqual(next, { phase: 'EAGLE_SIGHT', step: 'RESEARCH' });
    });

    it('transitions between phases', () => {
      const next = getNextPhase({ phase: 'EAGLE_SIGHT', step: 'GAMEPLAN' });
      assert.deepStrictEqual(next, { phase: 'BUILD', step: 'RULES' });
    });

    it('transitions from BUILD to SHIP', () => {
      const next = getNextPhase({ phase: 'BUILD', step: 'DEBUG' });
      assert.deepStrictEqual(next, { phase: 'SHIP', step: 'REVIEW' });
    });

    it('transitions from SHIP to GROW', () => {
      const next = getNextPhase({ phase: 'SHIP', step: 'MONITOR' });
      assert.deepStrictEqual(next, { phase: 'GROW', step: 'MONITOR' });
    });

    it('loops back to EAGLE_SIGHT from GROW', () => {
      const next = getNextPhase({ phase: 'GROW', step: 'LOOP' });
      assert.deepStrictEqual(next, { phase: 'EAGLE_SIGHT', step: 'IDEA' });
    });
  });

  describe('getPrevPhase', () => {
    it('stays at IDLE if already IDLE', () => {
      const prev = getPrevPhase({ phase: 'IDLE' });
      assert.deepStrictEqual(prev, { phase: 'IDLE' });
    });

    it('goes back within same phase', () => {
      const prev = getPrevPhase({ phase: 'EAGLE_SIGHT', step: 'RESEARCH' });
      assert.deepStrictEqual(prev, { phase: 'EAGLE_SIGHT', step: 'IDEA' });
    });

    it('stays at first step if already there', () => {
      const prev = getPrevPhase({ phase: 'EAGLE_SIGHT', step: 'IDEA' });
      assert.deepStrictEqual(prev, { phase: 'EAGLE_SIGHT', step: 'IDEA' });
    });
  });

  describe('getPhaseGuidance', () => {
    it('provides guidance for IDLE', () => {
      const guidance = getPhaseGuidance({ phase: 'IDLE' });
      assert.strictEqual(guidance.nextSteps.length > 0, true);
      assert.strictEqual(typeof guidance.prompt, 'string');
    });

    it('provides guidance for valid phase', () => {
      const guidance = getPhaseGuidance({ phase: 'BUILD', step: 'RULES' });
      assert.strictEqual(guidance.nextSteps.length > 0, true);
      assert.strictEqual(guidance.prompt?.includes('rules') || guidance.prompt?.includes('Rules'), true);
    });
  });
});
