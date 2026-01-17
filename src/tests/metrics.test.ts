import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, existsSync, writeFileSync as fsWriteFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  loadMetrics,
  saveMetrics,
  startSession,
  endSession,
  recordToolCall,
  recordPromptCopied,
  recordPhaseChange,
  getMetricsSummary,
} from '../metrics.js';

describe('Metrics Module', () => {
  const testDir = join(tmpdir(), 'midas-metrics-test-' + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('loadMetrics', () => {
    it('returns default metrics for new project', () => {
      const metrics = loadMetrics(testDir);
      assert.strictEqual(metrics.totalSessions, 0);
      assert.strictEqual(metrics.totalToolCalls, 0);
      assert.strictEqual(metrics.sessions.length, 0);
      assert.strictEqual(metrics.currentStreak, 0);
    });

    it('loads saved metrics', () => {
      const saved = {
        totalSessions: 5,
        totalToolCalls: 42,
        totalTornadoCycles: 3,
        totalJournalsSaved: 2,
        phaseHistory: [],
        sessions: [],
        averageSessionMinutes: 15,
        currentStreak: 3,
        lastSessionDate: '2026-01-12',
      };
      
      mkdirSync(join(testDir, '.midas'), { recursive: true });
      fsWriteFileSync(
        join(testDir, '.midas', 'metrics.json'),
        JSON.stringify(saved)
      );
      
      const metrics = loadMetrics(testDir);
      assert.strictEqual(metrics.totalSessions, 5);
      assert.strictEqual(metrics.currentStreak, 3);
    });
  });

  describe('saveMetrics', () => {
    it('creates .midas directory', () => {
      saveMetrics(testDir, loadMetrics(testDir));
      assert.strictEqual(existsSync(join(testDir, '.midas')), true);
    });

    it('persists metrics', () => {
      const metrics = loadMetrics(testDir);
      metrics.totalToolCalls = 10;
      saveMetrics(testDir, metrics);
      
      const loaded = loadMetrics(testDir);
      assert.strictEqual(loaded.totalToolCalls, 10);
    });
  });

  describe('startSession', () => {
    it('returns unique session ID', () => {
      const id1 = startSession(testDir, { phase: 'IDLE' });
      const id2 = startSession(testDir, { phase: 'IDLE' });
      assert.notStrictEqual(id1, id2);
    });

    it('increments total sessions', () => {
      startSession(testDir, { phase: 'IDLE' });
      startSession(testDir, { phase: 'IDLE' });
      
      const metrics = loadMetrics(testDir);
      assert.strictEqual(metrics.totalSessions, 2);
    });

    it('records start phase', () => {
      startSession(testDir, { phase: 'BUILD', step: 'IMPLEMENT' });
      
      const metrics = loadMetrics(testDir);
      assert.strictEqual(metrics.sessions[0].startPhase.phase, 'BUILD');
    });

    it('starts streak at 1 for first session', () => {
      startSession(testDir, { phase: 'IDLE' });
      
      const metrics = loadMetrics(testDir);
      assert.strictEqual(metrics.currentStreak, 1);
    });

    it('updates last session date', () => {
      startSession(testDir, { phase: 'IDLE' });
      
      const metrics = loadMetrics(testDir);
      const today = new Date().toISOString().slice(0, 10);
      assert.strictEqual(metrics.lastSessionDate, today);
    });
  });

  describe('endSession', () => {
    it('records end time', () => {
      const sessionId = startSession(testDir, { phase: 'IDLE' });
      endSession(testDir, sessionId, { phase: 'BUILD', step: 'IMPLEMENT' });
      
      const metrics = loadMetrics(testDir);
      assert.strictEqual(typeof metrics.sessions[0].endTime, 'string');
    });

    it('records end phase', () => {
      const sessionId = startSession(testDir, { phase: 'IDLE' });
      endSession(testDir, sessionId, { phase: 'BUILD', step: 'TEST' });
      
      const metrics = loadMetrics(testDir);
      assert.strictEqual(metrics.sessions[0].endPhase?.phase, 'BUILD');
    });

    it('calculates average session time', () => {
      const sessionId = startSession(testDir, { phase: 'IDLE' });
      // End immediately
      endSession(testDir, sessionId, { phase: 'IDLE' });
      
      const metrics = loadMetrics(testDir);
      assert.strictEqual(typeof metrics.averageSessionMinutes, 'number');
    });
  });

  describe('recordToolCall', () => {
    it('increments session tool calls', () => {
      const sessionId = startSession(testDir, { phase: 'IDLE' });
      recordToolCall(testDir, sessionId, 'midas_audit');
      recordToolCall(testDir, sessionId, 'midas_check_docs');
      
      const metrics = loadMetrics(testDir);
      assert.strictEqual(metrics.sessions[0].toolCalls, 2);
    });

    it('increments total tool calls', () => {
      const sessionId = startSession(testDir, { phase: 'IDLE' });
      recordToolCall(testDir, sessionId, 'midas_audit');
      
      const metrics = loadMetrics(testDir);
      assert.strictEqual(metrics.totalToolCalls, 1);
    });

    it('tracks tornado cycles specifically', () => {
      const sessionId = startSession(testDir, { phase: 'IDLE' });
      recordToolCall(testDir, sessionId, 'midas_tornado');
      recordToolCall(testDir, sessionId, 'midas_tornado');
      
      const metrics = loadMetrics(testDir);
      assert.strictEqual(metrics.sessions[0].tornadoCycles, 2);
      assert.strictEqual(metrics.totalTornadoCycles, 2);
    });

    it('tracks journal saves specifically', () => {
      const sessionId = startSession(testDir, { phase: 'IDLE' });
      recordToolCall(testDir, sessionId, 'midas_journal_save');
      
      const metrics = loadMetrics(testDir);
      assert.strictEqual(metrics.sessions[0].journalsSaved, 1);
      assert.strictEqual(metrics.totalJournalsSaved, 1);
    });
  });

  describe('recordPromptCopied', () => {
    it('increments prompt copy count', () => {
      const sessionId = startSession(testDir, { phase: 'IDLE' });
      recordPromptCopied(testDir, sessionId);
      recordPromptCopied(testDir, sessionId);
      
      const metrics = loadMetrics(testDir);
      assert.strictEqual(metrics.sessions[0].promptsCopied, 2);
    });
  });

  describe('recordPhaseChange', () => {
    it('adds phase to history', () => {
      recordPhaseChange(testDir, { phase: 'PLAN', step: 'IDEA' });
      
      const metrics = loadMetrics(testDir);
      assert.strictEqual(metrics.phaseHistory.length, 1);
      assert.strictEqual(metrics.phaseHistory[0].phase, 'PLAN:IDEA');
    });

    it('records entry time', () => {
      recordPhaseChange(testDir, { phase: 'BUILD', step: 'RULES' });
      
      const metrics = loadMetrics(testDir);
      assert.strictEqual(typeof metrics.phaseHistory[0].enteredAt, 'string');
    });

    it('calculates duration when changing phases', () => {
      recordPhaseChange(testDir, { phase: 'BUILD', step: 'RULES' });
      recordPhaseChange(testDir, { phase: 'BUILD', step: 'INDEX' });
      
      const metrics = loadMetrics(testDir);
      assert.strictEqual(typeof metrics.phaseHistory[0].duration, 'number');
    });
  });

  describe('getMetricsSummary', () => {
    it('returns message for no sessions', () => {
      const summary = getMetricsSummary(testDir);
      assert.strictEqual(summary, 'No sessions yet');
    });

    it('returns formatted summary', () => {
      startSession(testDir, { phase: 'IDLE' });
      const sessionId = startSession(testDir, { phase: 'BUILD', step: 'IMPLEMENT' });
      recordToolCall(testDir, sessionId, 'midas_audit');
      
      const summary = getMetricsSummary(testDir);
      assert.strictEqual(summary.includes('Sessions:'), true);
      assert.strictEqual(summary.includes('Tool calls:'), true);
    });
  });
});
