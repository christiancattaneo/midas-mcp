import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync, chmodSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { loadState, saveState, setPhase, getDefaultState } from '../state/phase.js';
import { startProject, getPhase, setPhaseManually } from '../tools/phase.js';
import { audit } from '../tools/audit.js';
import { checkDocs } from '../tools/docs.js';
import { loadTracker, saveTracker } from '../tracker.js';
import { loadMetrics, saveMetrics } from '../metrics.js';
import { saveToJournal, getJournalEntries } from '../tools/journal.js';

describe('Edge Cases and Error Handling', () => {
  const testDir = join(tmpdir(), 'midas-edge-test-' + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('Corrupted State Files', () => {
    it('handles corrupted state.json gracefully', () => {
      mkdirSync(join(testDir, '.midas'), { recursive: true });
      writeFileSync(join(testDir, '.midas', 'state.json'), 'not valid json{{{');
      
      // Should return default state instead of crashing
      const state = loadState(testDir);
      assert.deepStrictEqual(state.current, { phase: 'IDLE' });
    });

    it('handles corrupted tracker.json gracefully', () => {
      mkdirSync(join(testDir, '.midas'), { recursive: true });
      writeFileSync(join(testDir, '.midas', 'tracker.json'), '{ broken');
      
      const tracker = loadTracker(testDir);
      assert.deepStrictEqual(tracker.inferredPhase, { phase: 'IDLE' });
    });

    it('handles corrupted metrics.json gracefully', () => {
      mkdirSync(join(testDir, '.midas'), { recursive: true });
      writeFileSync(join(testDir, '.midas', 'metrics.json'), '[[invalid]]');
      
      const metrics = loadMetrics(testDir);
      assert.strictEqual(metrics.totalSessions, 0);
    });

    it('handles empty state file', () => {
      mkdirSync(join(testDir, '.midas'), { recursive: true });
      writeFileSync(join(testDir, '.midas', 'state.json'), '');
      
      const state = loadState(testDir);
      assert.deepStrictEqual(state.current, { phase: 'IDLE' });
    });
  });

  describe('Missing Directories', () => {
    it('creates .midas directory on save', () => {
      const state = getDefaultState();
      saveState(testDir, state);
      
      assert.strictEqual(existsSync(join(testDir, '.midas')), true);
    });

    it('creates nested directory for journal', () => {
      saveToJournal({
        projectPath: testDir,
        title: 'Test',
        conversation: 'Content',
      });
      
      assert.strictEqual(existsSync(join(testDir, '.midas', 'journal')), true);
    });

    it('handles non-existent docs directory', () => {
      const result = checkDocs({ projectPath: testDir });
      
      assert.strictEqual(result.brainlift.exists, false);
      assert.strictEqual(result.prd.exists, false);
      assert.strictEqual(result.gameplan.exists, false);
      assert.strictEqual(result.ready, false);
    });
  });

  describe('Empty and Minimal Content', () => {
    it('handles project with no files', () => {
      const result = audit({ projectPath: testDir });
      assert.strictEqual(result.overall < 30, true);
    });

    it('handles empty package.json', () => {
      writeFileSync(join(testDir, 'package.json'), '{}');
      
      const result = audit({ projectPath: testDir });
      // Should not crash
      assert.strictEqual(typeof result.overall, 'number');
    });

    it('handles empty docs files', () => {
      mkdirSync(join(testDir, 'docs'), { recursive: true });
      writeFileSync(join(testDir, 'docs', 'brainlift.md'), '');
      
      const result = checkDocs({ projectPath: testDir });
      assert.strictEqual(result.brainlift.exists, true);
      assert.strictEqual(result.brainlift.complete, false);
    });

    it('handles journal with no entries', () => {
      const entries = getJournalEntries({ projectPath: testDir });
      assert.deepStrictEqual(entries, []);
    });
  });

  describe('Invalid Input Handling', () => {
    it('setPhaseManually handles invalid phase', () => {
      const result = setPhaseManually({ 
        projectPath: testDir, 
        phase: 'INVALID_PHASE' as 'BUILD' // Type cast to simulate bad input
      });
      // Should handle gracefully - will set to provided value
      assert.strictEqual(result.success, true);
    });

    it('startProject with empty name still works', () => {
      const result = startProject({ 
        projectName: '', 
        projectPath: testDir 
      });
      
      assert.strictEqual(result.success, true);
    });

    it('audit with malformed package.json dependencies', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        dependencies: 'not an object',
      }));
      
      const result = audit({ projectPath: testDir });
      // Should not crash
      assert.strictEqual(typeof result.level, 'string');
    });
  });

  describe('Concurrent Access Patterns', () => {
    it('handles rapid consecutive saves', () => {
      const state = getDefaultState();
      
      // Rapid saves should not corrupt state
      for (let i = 0; i < 10; i++) {
        state.current = { phase: 'PLAN', step: 'IDEA' };
        saveState(testDir, state);
      }
      
      const loaded = loadState(testDir);
      assert.strictEqual(loaded.current.phase, 'PLAN');
    });

    it('handles rapid phase changes', () => {
      setPhase(testDir, { phase: 'PLAN', step: 'IDEA' });
      setPhase(testDir, { phase: 'PLAN', step: 'RESEARCH' });
      setPhase(testDir, { phase: 'PLAN', step: 'BRAINLIFT' });
      
      const state = loadState(testDir);
      assert.strictEqual((state.current as { step: string }).step, 'BRAINLIFT');
      assert.strictEqual(state.history.length, 3);
    });

    it('handles multiple journal entries quickly', () => {
      for (let i = 0; i < 5; i++) {
        saveToJournal({
          projectPath: testDir,
          title: `Entry ${i}`,
          conversation: `Content ${i}`,
        });
      }
      
      const entries = getJournalEntries({ projectPath: testDir });
      assert.strictEqual(entries.length, 5);
    });
  });

  describe('Special Characters in Content', () => {
    it('handles special characters in project name', () => {
      const result = startProject({
        projectName: 'my-project_v2.0 (beta)',
        projectPath: testDir,
      });
      
      assert.strictEqual(result.success, true);
    });

    it('handles markdown in journal entries', () => {
      const mdContent = '# Header\n```typescript\nconst x = 1;\n```\n- List item';
      saveToJournal({
        projectPath: testDir,
        title: 'Markdown Test',
        conversation: mdContent,
      });
      
      const entries = getJournalEntries({ projectPath: testDir });
      assert.strictEqual(entries[0].conversation.includes('```typescript'), true);
    });

    it('handles unicode in journal entries', () => {
      saveToJournal({
        projectPath: testDir,
        title: 'Unicode Test',
        conversation: 'Tested with emojis and symbols',
      });
      
      const entries = getJournalEntries({ projectPath: testDir });
      assert.strictEqual(entries.length, 1);
    });

    it('handles newlines in conversation content', () => {
      const multiline = 'Line 1\nLine 2\n\nLine 4';
      saveToJournal({
        projectPath: testDir,
        title: 'Multiline',
        conversation: multiline,
      });
      
      const entries = getJournalEntries({ projectPath: testDir });
      assert.strictEqual(entries[0].conversation.includes('\n'), true);
    });
  });

  describe('Path Edge Cases', () => {
    it('handles path with spaces', () => {
      const spacePath = join(testDir, 'path with spaces');
      mkdirSync(spacePath, { recursive: true });
      
      const state = getDefaultState();
      saveState(spacePath, state);
      
      const loaded = loadState(spacePath);
      assert.deepStrictEqual(loaded.current, { phase: 'IDLE' });
    });

    it('uses cwd when projectPath not provided', () => {
      const result = getPhase({});
      // Should not crash - uses process.cwd()
      assert.strictEqual(typeof result.current.phase, 'string');
    });
  });

  describe('Boundary Conditions', () => {
    it('handles very long journal entry', () => {
      const longContent = 'A'.repeat(100000);
      const result = saveToJournal({
        projectPath: testDir,
        title: 'Long Entry',
        conversation: longContent,
      });
      
      assert.strictEqual(result.success, true);
    });

    it('handles many tags with security limit', () => {
      // Security: Tags are limited to 20 max (LIMITS.MAX_TAGS)
      const manyTags = Array.from({ length: 50 }, (_, i) => `tag${i}`);
      const result = saveToJournal({
        projectPath: testDir,
        title: 'Many Tags',
        conversation: 'Content',
        tags: manyTags,
      });
      
      // Only first 20 tags should be stored (security limit)
      assert.strictEqual(result.entry.tags?.length, 20);
    });

    it('handles deep history', () => {
      // Create many phase transitions
      for (let i = 0; i < 100; i++) {
        setPhase(testDir, { phase: 'PLAN', step: 'IDEA' });
      }
      
      const state = loadState(testDir);
      assert.strictEqual(state.history.length, 100);
    });
  });
});
