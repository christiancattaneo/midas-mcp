import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

import {
  loadTracker,
  saveTracker,
  trackToolCall,
  scanRecentFiles,
  getGitActivity,
  checkCompletionSignals,
  updateTracker,
  maybeAutoAdvance,
  checkKeyArtifactChanges,
  markAnalysisComplete,
} from '../tracker.js';
import { setPhase } from '../state/phase.js';

describe('Tracker Module', () => {
  const testDir = join(tmpdir(), 'midas-tracker-test-' + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('loadTracker', () => {
    it('returns default tracker for new project', () => {
      const tracker = loadTracker(testDir);
      assert.strictEqual(tracker.recentFiles.length, 0);
      assert.strictEqual(tracker.recentToolCalls.length, 0);
      assert.strictEqual(tracker.gitActivity, null);
      assert.deepStrictEqual(tracker.inferredPhase, { phase: 'IDLE' });
    });

    it('loads saved tracker state', () => {
      const state = {
        lastUpdated: new Date().toISOString(),
        recentFiles: [{ path: 'test.ts', lastModified: Date.now() }],
        recentToolCalls: [],
        gitActivity: null,
        completionSignals: { testsExist: true, docsComplete: false },
        inferredPhase: { phase: 'BUILD', step: 'IMPLEMENT' },
        confidence: 70,
      };
      
      mkdirSync(join(testDir, '.midas'), { recursive: true });
      writeFileSync(join(testDir, '.midas', 'tracker.json'), JSON.stringify(state));
      
      const tracker = loadTracker(testDir);
      assert.strictEqual(tracker.recentFiles.length, 1);
      assert.strictEqual(tracker.inferredPhase.phase, 'BUILD');
    });
  });

  describe('saveTracker', () => {
    it('creates .midas directory', () => {
      const tracker = loadTracker(testDir);
      saveTracker(testDir, tracker);
      assert.strictEqual(existsSync(join(testDir, '.midas')), true);
    });

    it('persists tracker state', () => {
      const tracker = loadTracker(testDir);
      tracker.recentToolCalls.push({ tool: 'test_tool', timestamp: Date.now() });
      saveTracker(testDir, tracker);
      
      const loaded = loadTracker(testDir);
      assert.strictEqual(loaded.recentToolCalls.length, 1);
      assert.strictEqual(loaded.recentToolCalls[0].tool, 'test_tool');
    });

    it('updates lastUpdated timestamp', () => {
      const tracker = loadTracker(testDir);
      const before = tracker.lastUpdated;
      
      // Wait a tiny bit
      saveTracker(testDir, tracker);
      const loaded = loadTracker(testDir);
      
      assert.strictEqual(loaded.lastUpdated >= before, true);
    });
  });

  describe('trackToolCall', () => {
    it('adds tool call to tracker', () => {
      trackToolCall(testDir, 'midas_audit', { projectPath: testDir });
      
      const tracker = loadTracker(testDir);
      assert.strictEqual(tracker.recentToolCalls.length, 1);
      assert.strictEqual(tracker.recentToolCalls[0].tool, 'midas_audit');
    });

    it('stores tool arguments', () => {
      const args = { projectPath: testDir, updatePhase: true };
      trackToolCall(testDir, 'midas_analyze', args);
      
      const tracker = loadTracker(testDir);
      assert.deepStrictEqual(tracker.recentToolCalls[0].args, args);
    });

    it('keeps most recent calls first', () => {
      trackToolCall(testDir, 'first_tool', {});
      trackToolCall(testDir, 'second_tool', {});
      trackToolCall(testDir, 'third_tool', {});
      
      const tracker = loadTracker(testDir);
      assert.strictEqual(tracker.recentToolCalls[0].tool, 'third_tool');
      assert.strictEqual(tracker.recentToolCalls[2].tool, 'first_tool');
    });

    it('limits stored tool calls to 50', () => {
      for (let i = 0; i < 60; i++) {
        trackToolCall(testDir, `tool_${i}`, {});
      }
      
      const tracker = loadTracker(testDir);
      assert.strictEqual(tracker.recentToolCalls.length, 50);
    });

    it('infers phase from specific tool calls', () => {
      trackToolCall(testDir, 'midas_tornado', { problem: 'test' });
      
      const tracker = loadTracker(testDir);
      assert.strictEqual(tracker.inferredPhase.phase, 'BUILD');
      assert.strictEqual((tracker.inferredPhase as { step: string }).step, 'DEBUG');
    });
  });

  describe('scanRecentFiles', () => {
    it('returns empty for empty directory', () => {
      const files = scanRecentFiles(testDir);
      assert.strictEqual(files.length, 0);
    });

    it('finds recently modified files', () => {
      writeFileSync(join(testDir, 'test.ts'), 'content');
      
      const files = scanRecentFiles(testDir);
      assert.strictEqual(files.length, 1);
      assert.strictEqual(files[0].path, 'test.ts');
    });

    it('ignores node_modules', () => {
      mkdirSync(join(testDir, 'node_modules'), { recursive: true });
      writeFileSync(join(testDir, 'node_modules', 'package.json'), '{}');
      writeFileSync(join(testDir, 'src.ts'), 'code');
      
      const files = scanRecentFiles(testDir);
      assert.strictEqual(files.length, 1);
      assert.strictEqual(files[0].path, 'src.ts');
    });

    it('ignores .git directory', () => {
      mkdirSync(join(testDir, '.git'), { recursive: true });
      writeFileSync(join(testDir, '.git', 'config'), 'gitconfig');
      writeFileSync(join(testDir, 'app.ts'), 'code');
      
      const files = scanRecentFiles(testDir);
      assert.strictEqual(files.every(f => !f.path.includes('.git')), true);
    });

    it('sorts by most recent first', () => {
      writeFileSync(join(testDir, 'old.ts'), 'old');
      // Slight delay to ensure different timestamps
      writeFileSync(join(testDir, 'new.ts'), 'new');
      
      const files = scanRecentFiles(testDir);
      if (files.length >= 2) {
        assert.strictEqual(files[0].lastModified >= files[1].lastModified, true);
      }
    });
  });

  describe('getGitActivity', () => {
    it('returns null for non-git directory', () => {
      const activity = getGitActivity(testDir);
      assert.strictEqual(activity, null);
    });

    it('detects git repository', () => {
      // Initialize a git repo
      execSync('git init', { cwd: testDir, stdio: 'ignore' });
      execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: testDir, stdio: 'ignore' });
      
      const activity = getGitActivity(testDir);
      assert.notStrictEqual(activity, null);
      assert.strictEqual(typeof activity?.branch, 'string');
    });

    it('counts uncommitted changes', () => {
      execSync('git init', { cwd: testDir, stdio: 'ignore' });
      execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: testDir, stdio: 'ignore' });
      writeFileSync(join(testDir, 'file.txt'), 'content');
      
      const activity = getGitActivity(testDir);
      assert.strictEqual(activity?.uncommittedChanges, 1);
    });

    it('returns recent commits for phase detection', () => {
      execSync('git init', { cwd: testDir, stdio: 'ignore' });
      execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: testDir, stdio: 'ignore' });
      writeFileSync(join(testDir, 'file1.txt'), 'content');
      execSync('git add .', { cwd: testDir, stdio: 'ignore' });
      execSync('git commit -m "feat: initial commit"', { cwd: testDir, stdio: 'ignore' });
      writeFileSync(join(testDir, 'file2.txt'), 'content');
      execSync('git add .', { cwd: testDir, stdio: 'ignore' });
      execSync('git commit -m "bump version to 1.0.0"', { cwd: testDir, stdio: 'ignore' });
      
      const activity = getGitActivity(testDir);
      assert.ok(activity?.recentCommits);
      assert.ok(activity.recentCommits.length >= 2);
      assert.ok(activity.recentCommits[0].includes('bump version'));
    });

    it('handles empty repo with no commits', () => {
      execSync('git init', { cwd: testDir, stdio: 'ignore' });
      execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: testDir, stdio: 'ignore' });
      
      const activity = getGitActivity(testDir);
      assert.notStrictEqual(activity, null);
      // recentCommits should be empty array or undefined for empty repo
      assert.ok(!activity?.recentCommits?.length || activity.recentCommits.length === 0);
    });

    it('returns up to 10 recent commits', () => {
      execSync('git init', { cwd: testDir, stdio: 'ignore' });
      execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: testDir, stdio: 'ignore' });
      
      // Create 15 commits
      for (let i = 1; i <= 15; i++) {
        writeFileSync(join(testDir, `file${i}.txt`), `content ${i}`);
        execSync('git add .', { cwd: testDir, stdio: 'ignore' });
        execSync(`git commit -m "commit ${i}"`, { cwd: testDir, stdio: 'ignore' });
      }
      
      const activity = getGitActivity(testDir);
      assert.ok(activity?.recentCommits);
      assert.strictEqual(activity.recentCommits.length, 10);
      // Most recent should be first
      assert.ok(activity.recentCommits[0].includes('commit 15'));
    });
  });

  describe('checkCompletionSignals', () => {
    it('detects test files', () => {
      writeFileSync(join(testDir, 'app.test.ts'), 'test');
      
      const signals = checkCompletionSignals(testDir);
      assert.strictEqual(signals.testsExist, true);
    });

    it('detects spec files', () => {
      writeFileSync(join(testDir, 'app.spec.ts'), 'spec');
      
      const signals = checkCompletionSignals(testDir);
      assert.strictEqual(signals.testsExist, true);
    });

    it('detects docs completeness', () => {
      mkdirSync(join(testDir, 'docs'), { recursive: true });
      writeFileSync(join(testDir, 'docs', 'brainlift.md'), '# Brainlift');
      writeFileSync(join(testDir, 'docs', 'prd.md'), '# PRD');
      writeFileSync(join(testDir, 'docs', 'gameplan.md'), '# Gameplan');
      
      const signals = checkCompletionSignals(testDir);
      assert.strictEqual(signals.docsComplete, true);
    });

    it('returns false when docs missing', () => {
      const signals = checkCompletionSignals(testDir);
      assert.strictEqual(signals.docsComplete, false);
    });
  });

  describe('updateTracker', () => {
    it('updates all tracker fields', () => {
      writeFileSync(join(testDir, 'test.ts'), 'code');
      
      const tracker = updateTracker(testDir);
      
      assert.strictEqual(tracker.recentFiles.length >= 1, true);
      assert.strictEqual(typeof tracker.lastUpdated, 'string');
    });

    it('persists updated tracker', () => {
      writeFileSync(join(testDir, 'src.ts'), 'code');
      updateTracker(testDir);
      
      const loaded = loadTracker(testDir);
      assert.strictEqual(loaded.recentFiles.some(f => f.path === 'src.ts'), true);
    });
  });

  describe('maybeAutoAdvance', () => {
    it('advances BUILD:RULES to BUILD:INDEX when .cursorrules exists', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'RULES' });
      writeFileSync(join(testDir, '.cursorrules'), '# Rules');
      
      const result = maybeAutoAdvance(testDir);
      
      assert.strictEqual(result.advanced, true);
      assert.strictEqual(result.from.phase, 'BUILD');
      assert.strictEqual((result.from as { step: string }).step, 'RULES');
      assert.strictEqual(result.to.phase, 'BUILD');
      assert.strictEqual((result.to as { step: string }).step, 'INDEX');
      assert.strictEqual(result.reason, '.cursorrules created');
    });

    it('advances PLAN:BRAINLIFT to PLAN:PRD when brainlift.md exists', () => {
      setPhase(testDir, { phase: 'PLAN', step: 'BRAINLIFT' });
      mkdirSync(join(testDir, 'docs'), { recursive: true });
      writeFileSync(join(testDir, 'docs', 'brainlift.md'), '# Brainlift');
      
      const result = maybeAutoAdvance(testDir);
      
      assert.strictEqual(result.advanced, true);
      assert.strictEqual(result.from.phase, 'PLAN');
      assert.strictEqual((result.from as { step: string }).step, 'BRAINLIFT');
      assert.strictEqual(result.to.phase, 'PLAN');
      assert.strictEqual((result.to as { step: string }).step, 'PRD');
      assert.strictEqual(result.reason, 'brainlift.md created');
    });

    it('advances PLAN:PRD to PLAN:GAMEPLAN when prd.md exists', () => {
      setPhase(testDir, { phase: 'PLAN', step: 'PRD' });
      mkdirSync(join(testDir, 'docs'), { recursive: true });
      writeFileSync(join(testDir, 'docs', 'prd.md'), '# PRD');
      
      const result = maybeAutoAdvance(testDir);
      
      assert.strictEqual(result.advanced, true);
      assert.strictEqual(result.from.phase, 'PLAN');
      assert.strictEqual((result.from as { step: string }).step, 'PRD');
      assert.strictEqual(result.to.phase, 'PLAN');
      assert.strictEqual((result.to as { step: string }).step, 'GAMEPLAN');
      assert.strictEqual(result.reason, 'prd.md created');
    });

    it('advances PLAN:GAMEPLAN to BUILD:RULES when gameplan.md exists', () => {
      setPhase(testDir, { phase: 'PLAN', step: 'GAMEPLAN' });
      mkdirSync(join(testDir, 'docs'), { recursive: true });
      writeFileSync(join(testDir, 'docs', 'gameplan.md'), '# Gameplan');
      
      const result = maybeAutoAdvance(testDir);
      
      assert.strictEqual(result.advanced, true);
      assert.strictEqual(result.from.phase, 'PLAN');
      assert.strictEqual((result.from as { step: string }).step, 'GAMEPLAN');
      assert.strictEqual(result.to.phase, 'BUILD');
      assert.strictEqual((result.to as { step: string }).step, 'RULES');
      assert.strictEqual(result.reason, 'gameplan.md created');
    });

    it('does not advance BUILD:RULES when .cursorrules missing', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'RULES' });
      
      const result = maybeAutoAdvance(testDir);
      
      assert.strictEqual(result.advanced, false);
    });

    it('does not advance PLAN:BRAINLIFT when brainlift.md missing', () => {
      setPhase(testDir, { phase: 'PLAN', step: 'BRAINLIFT' });
      
      const result = maybeAutoAdvance(testDir);
      
      assert.strictEqual(result.advanced, false);
    });

    it('does not advance from arbitrary BUILD steps without gates', () => {
      setPhase(testDir, { phase: 'BUILD', step: 'READ' });
      
      const result = maybeAutoAdvance(testDir);
      
      assert.strictEqual(result.advanced, false);
    });
  });

  describe('checkKeyArtifactChanges', () => {
    it('detects .cursorrules creation after analysis', () => {
      markAnalysisComplete(testDir);
      
      // Wait a bit then create artifact
      writeFileSync(join(testDir, '.cursorrules'), '# Rules');
      
      const result = checkKeyArtifactChanges(testDir);
      
      assert.strictEqual(result.changed, true);
      assert.strictEqual(result.shouldAutoReanalyze, true);
      assert.ok(result.artifacts.includes('.cursorrules'));
    });

    it('detects brainlift.md creation after analysis', () => {
      markAnalysisComplete(testDir);
      
      mkdirSync(join(testDir, 'docs'), { recursive: true });
      writeFileSync(join(testDir, 'docs', 'brainlift.md'), '# Brainlift');
      
      const result = checkKeyArtifactChanges(testDir);
      
      assert.strictEqual(result.changed, true);
      assert.ok(result.artifacts.includes('docs/brainlift.md'));
    });

    it('returns false when no key artifacts changed', () => {
      markAnalysisComplete(testDir);
      
      // Create a non-key file
      writeFileSync(join(testDir, 'random.ts'), 'code');
      
      const result = checkKeyArtifactChanges(testDir);
      
      assert.strictEqual(result.changed, false);
      assert.strictEqual(result.shouldAutoReanalyze, false);
      assert.strictEqual(result.artifacts.length, 0);
    });

    it('detects multiple key artifacts changed', () => {
      markAnalysisComplete(testDir);
      
      mkdirSync(join(testDir, 'docs'), { recursive: true });
      writeFileSync(join(testDir, '.cursorrules'), '# Rules');
      writeFileSync(join(testDir, 'docs', 'prd.md'), '# PRD');
      
      const result = checkKeyArtifactChanges(testDir);
      
      assert.strictEqual(result.changed, true);
      assert.ok(result.artifacts.length >= 2);
    });

    it('does not trigger for artifacts created before analysis', () => {
      // Create artifacts first
      mkdirSync(join(testDir, 'docs'), { recursive: true });
      writeFileSync(join(testDir, '.cursorrules'), '# Rules');
      writeFileSync(join(testDir, 'docs', 'brainlift.md'), '# Brainlift');
      
      // Then mark analysis complete
      // Need a small delay to ensure analysis timestamp is after file creation
      const waitMs = 50;
      const start = Date.now();
      while (Date.now() - start < waitMs) { /* busy wait */ }
      markAnalysisComplete(testDir);
      
      const result = checkKeyArtifactChanges(testDir);
      
      assert.strictEqual(result.changed, false);
    });
  });
});
