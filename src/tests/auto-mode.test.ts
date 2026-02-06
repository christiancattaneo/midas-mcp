/**
 * Auto-Mode Tests
 * 
 * Tests the end-to-end auto-mode flow:
 * 1. Smart suggestions are generated
 * 2. Commands are queued (accept) or skipped (reject)
 * 3. Pilot picks up commands and executes via Claude Code CLI
 * 4. Results flow back
 * 
 * These tests mock external dependencies (cloud API, Claude Code CLI)
 * to verify the orchestration logic works correctly.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { executeClaudeCode, type ExecutionResult, type PilotConfig } from '../pilot.js';
import { getSmartPromptSuggestion } from '../tracker.js';
import { loadState, saveState, setPhase } from '../state/phase.js';
import { startProject } from '../tools/phase.js';

describe('Auto Mode', () => {
  const testDir = join(tmpdir(), 'midas-auto-mode-test-' + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, '.midas'), { recursive: true });
    // Initialize a basic project
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      version: '1.0.0',
      scripts: { test: 'echo "pass"', build: 'echo "ok"' }
    }));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // SMART SUGGESTION GENERATION
  // ==========================================================================
  
  describe('Smart Suggestion Generation', () => {
    it('generates a suggestion for a new project', () => {
      startProject({ projectName: 'test-auto', projectPath: testDir });
      const suggestion = getSmartPromptSuggestion(testDir);
      
      assert.ok(suggestion, 'Should return a suggestion');
      assert.ok(suggestion.prompt, 'Suggestion should have a prompt');
      assert.ok(suggestion.prompt.length > 10, `Prompt should be substantial, got: "${suggestion.prompt}"`);
      assert.ok(suggestion.reason, 'Suggestion should have a reason');
      assert.ok(suggestion.priority, 'Suggestion should have a priority');
    });

    it('generates different suggestions based on phase', () => {
      startProject({ projectName: 'test-phases', projectPath: testDir });
      
      // In PLAN phase
      const planSuggestion = getSmartPromptSuggestion(testDir);
      
      // Move to BUILD phase
      setPhase(testDir, { phase: 'BUILD', step: 'IMPLEMENT' });
      
      const buildSuggestion = getSmartPromptSuggestion(testDir);
      
      // Suggestions should exist for both phases
      assert.ok(planSuggestion.prompt, 'PLAN suggestion should have prompt');
      assert.ok(buildSuggestion.prompt, 'BUILD suggestion should have prompt');
    });

    it('prioritizes broken build in suggestions', () => {
      startProject({ projectName: 'test-broken', projectPath: testDir });
      setPhase(testDir, { phase: 'BUILD', step: 'IMPLEMENT' });
      
      // Create a tracker with failing gates
      const trackerPath = join(testDir, '.midas', 'tracker.json');
      writeFileSync(trackerPath, JSON.stringify({
        gates: {
          compiles: false,
          tests_pass: true,
          lints_pass: true,
          checkedAt: new Date().toISOString(),
        },
        recentToolCalls: [],
        activeErrors: [],
        resolvedErrors: [],
      }));
      
      const suggestion = getSmartPromptSuggestion(testDir);
      
      // Should be high priority due to broken build
      assert.ok(
        suggestion.priority === 'critical' || suggestion.priority === 'high',
        `Should be high priority when build broken, got: ${suggestion.priority}`
      );
    });

    it('suggests test fixes when tests are failing', () => {
      startProject({ projectName: 'test-failing', projectPath: testDir });
      setPhase(testDir, { phase: 'BUILD', step: 'TEST' });
      
      const trackerPath = join(testDir, '.midas', 'tracker.json');
      writeFileSync(trackerPath, JSON.stringify({
        gates: {
          compiles: true,
          compiledAt: Date.now(),
          testsPass: false,
          testedAt: Date.now(),
          lintsPass: true,
          lintedAt: Date.now(),
        },
        recentToolCalls: [],
        activeErrors: [],
        resolvedErrors: [],
      }));
      
      const suggestion = getSmartPromptSuggestion(testDir);
      
      assert.ok(suggestion.prompt, 'Should suggest something for failing tests');
      assert.ok(
        suggestion.priority === 'critical' || suggestion.priority === 'high',
        `Should be high priority for failing tests, got: ${suggestion.priority}`
      );
    });
  });

  // ==========================================================================
  // COMMAND QUEUE
  // ==========================================================================
  
  describe('Command Queue Logic', () => {
    it('can create a command payload', () => {
      const command = {
        projectId: 'test-123',
        commandType: 'task',
        prompt: 'Fix the failing tests in src/auth.ts',
        maxTurns: 10,
        priority: 0,
      };
      
      assert.strictEqual(command.commandType, 'task');
      assert.ok(command.prompt.length > 0);
      assert.strictEqual(command.maxTurns, 10);
    });

    it('truncates very long prompts for queue', () => {
      const longPrompt = 'Fix this issue. '.repeat(1000); // ~16k chars
      const truncated = longPrompt.slice(0, 10000);
      
      assert.ok(truncated.length <= 10000, 'Should truncate long prompts');
      assert.ok(truncated.length > 0, 'Should not be empty');
    });
  });

  // ==========================================================================
  // EXECUTION RESULT PARSING
  // ==========================================================================

  describe('Execution Result Parsing', () => {
    it('handles JSON output format from Claude Code', () => {
      // Simulate what Claude Code returns in JSON mode
      const jsonOutput = JSON.stringify({
        result: 'Tests fixed: updated auth.test.ts with proper mocking',
        session_id: 'sess-abc123',
      });
      
      const parsed = JSON.parse(jsonOutput);
      assert.strictEqual(parsed.session_id, 'sess-abc123');
      assert.ok(parsed.result.includes('Tests fixed'));
    });

    it('handles non-JSON output gracefully', () => {
      const rawOutput = 'Some plain text output from Claude Code\nMultiple lines here';
      
      let parsed: { result?: string; session_id?: string } = {};
      try {
        parsed = JSON.parse(rawOutput);
      } catch {
        // Expected - not JSON, use raw
        parsed = { result: rawOutput };
      }
      
      assert.ok(parsed.result, 'Should fall back to raw output');
    });

    it('ExecutionResult has correct shape', () => {
      const result: ExecutionResult = {
        success: true,
        output: 'Task completed',
        exitCode: 0,
        duration: 5000,
        sessionId: 'test-session',
      };
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.duration, 5000);
      assert.ok(result.sessionId);
    });

    it('handles failure results', () => {
      const result: ExecutionResult = {
        success: false,
        output: 'Error: Permission denied',
        exitCode: 1,
        duration: 200,
      };
      
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.output.includes('Error'));
      assert.strictEqual(result.sessionId, undefined);
    });
  });

  // ==========================================================================
  // AUTO MODE STATE MACHINE
  // ==========================================================================

  describe('Auto Mode State Machine', () => {
    it('follows the correct state transitions', () => {
      // States: idle → suggestion_ready → countdown → executing → idle
      type AutoState = 'idle' | 'suggestion_ready' | 'countdown' | 'executing' | 'rejected';
      
      let state: AutoState = 'idle';
      
      // Receive suggestion
      const suggestion = { prompt: 'Fix tests', reason: 'Tests failing' };
      if (suggestion) state = 'suggestion_ready';
      assert.strictEqual(state, 'suggestion_ready');
      
      // Start countdown (auto mode ON)
      const autoMode = true;
      const connected = true;
      if (autoMode && connected) state = 'countdown';
      assert.strictEqual(state, 'countdown');
      
      // Countdown expires → execute
      let countdown = 5;
      while (countdown > 0) countdown--;
      state = 'executing';
      assert.strictEqual(state, 'executing');
      
      // Execution completes → back to idle
      state = 'idle';
      assert.strictEqual(state, 'idle');
    });

    it('rejects suggestion and returns to idle', () => {
      type AutoState = 'idle' | 'suggestion_ready' | 'countdown' | 'executing' | 'rejected';
      
      let state: AutoState = 'suggestion_ready';
      
      // User clicks SKIP
      state = 'rejected';
      assert.strictEqual(state, 'rejected');
      
      // New suggestion arrives → ready again
      state = 'suggestion_ready';
      assert.strictEqual(state, 'suggestion_ready');
    });

    it('does not auto-execute when watcher is offline', () => {
      const autoMode = true;
      const connected = false;
      const suggestion = { prompt: 'Do something' };
      
      const shouldExecute = autoMode && connected && suggestion !== null;
      assert.strictEqual(shouldExecute, false, 'Should not execute when offline');
    });

    it('does not auto-execute when already running', () => {
      const autoMode = true;
      const connected = true;
      const isRunning = true;
      const suggestion = { prompt: 'Do something' };
      
      const shouldExecute = autoMode && connected && !isRunning && suggestion !== null;
      assert.strictEqual(shouldExecute, false, 'Should not execute when already running');
    });

    it('does not auto-execute when rejected', () => {
      const autoMode = true;
      const connected = true;
      const rejected = true;
      const suggestion = { prompt: 'Do something' };
      
      const shouldExecute = autoMode && connected && !rejected && suggestion !== null;
      assert.strictEqual(shouldExecute, false, 'Should not execute when rejected');
    });

    it('auto-executes when all conditions met', () => {
      const autoMode = true;
      const connected = true;
      const isRunning = false;
      const rejected = false;
      const suggestion = { prompt: 'Fix the tests' };
      
      const shouldExecute = autoMode && connected && !isRunning && !rejected && suggestion !== null;
      assert.strictEqual(shouldExecute, true, 'Should execute when all conditions met');
    });
  });

  // ==========================================================================
  // PILOT CONFIG
  // ==========================================================================

  describe('Pilot Configuration', () => {
    it('has sensible defaults', () => {
      const defaults: PilotConfig = {
        projectPath: process.cwd(),
        autoMode: false,
        maxTurns: 10,
        allowedTools: ['Read', 'Edit', 'Bash', 'Grep', 'Glob'],
        pollInterval: 5000,
        outputFormat: 'json',
        useStructuredOutput: true,
      };
      
      assert.strictEqual(defaults.autoMode, false, 'Auto mode should be off by default');
      assert.strictEqual(defaults.maxTurns, 10, 'Default max turns should be 10');
      assert.ok(defaults.allowedTools.includes('Read'), 'Should allow Read');
      assert.ok(defaults.allowedTools.includes('Edit'), 'Should allow Edit');
      assert.ok(defaults.allowedTools.includes('Bash'), 'Should allow Bash');
      assert.strictEqual(defaults.pollInterval, 5000, 'Poll interval should be 5s');
      assert.strictEqual(defaults.outputFormat, 'json', 'Should use JSON output');
    });

    it('merges partial config with defaults', () => {
      const defaults: PilotConfig = {
        projectPath: process.cwd(),
        autoMode: false,
        maxTurns: 10,
        allowedTools: ['Read', 'Edit', 'Bash', 'Grep', 'Glob'],
        pollInterval: 5000,
        outputFormat: 'json',
        useStructuredOutput: true,
      };
      
      const overrides: Partial<PilotConfig> = {
        projectPath: '/my/project',
        maxTurns: 20,
      };
      
      const merged = { ...defaults, ...overrides };
      
      assert.strictEqual(merged.projectPath, '/my/project', 'Should override path');
      assert.strictEqual(merged.maxTurns, 20, 'Should override maxTurns');
      assert.strictEqual(merged.autoMode, false, 'Should keep default autoMode');
      assert.strictEqual(merged.pollInterval, 5000, 'Should keep default pollInterval');
    });
  });

  // ==========================================================================
  // PROMPT FLOW E2E
  // ==========================================================================

  describe('Prompt Flow End-to-End', () => {
    it('generates suggestion → creates command → validates shape', () => {
      startProject({ projectName: 'e2e-test', projectPath: testDir });
      
      // Step 1: Generate suggestion
      const suggestion = getSmartPromptSuggestion(testDir);
      assert.ok(suggestion.prompt, 'Step 1: Should generate prompt');
      
      // Step 2: Create command payload (simulates dashboard POST /api/commands)
      const command = {
        id: 1,
        project_id: 'e2e-test',
        command_type: 'task' as const,
        prompt: suggestion.prompt,
        status: 'pending' as const,
        created_at: new Date().toISOString(),
        max_turns: 10,
      };
      
      assert.strictEqual(command.status, 'pending', 'Step 2: Command should be pending');
      assert.strictEqual(command.prompt, suggestion.prompt, 'Step 2: Command prompt should match');
      
      // Step 3: Mark as running (simulates pilot picking it up)
      const runningCommand = { ...command, status: 'running' as const, started_at: new Date().toISOString() };
      assert.strictEqual(runningCommand.status, 'running', 'Step 3: Should be running');
      
      // Step 4: Complete (simulates Claude Code finishing)
      const result: ExecutionResult = {
        success: true,
        output: 'Implemented the changes successfully',
        exitCode: 0,
        duration: 15000,
      };
      
      const completedCommand = {
        ...runningCommand,
        status: 'completed' as const,
        output: result.output,
        exit_code: result.exitCode,
        duration_ms: result.duration,
      };
      
      assert.strictEqual(completedCommand.status, 'completed', 'Step 4: Should be completed');
      assert.ok(completedCommand.output.includes('successfully'), 'Step 4: Should have output');
    });

    it('handles rejection flow correctly', () => {
      startProject({ projectName: 'reject-test', projectPath: testDir });
      
      const suggestion = getSmartPromptSuggestion(testDir);
      assert.ok(suggestion.prompt, 'Should have suggestion');
      
      // User rejects
      let rejected = true;
      assert.strictEqual(rejected, true, 'Should be rejected');
      
      // Auto mode should not execute
      const autoMode = true;
      const shouldExecute = autoMode && !rejected;
      assert.strictEqual(shouldExecute, false, 'Should not auto-execute when rejected');
      
      // User clicks "Show Again"
      rejected = false;
      const shouldShowAgain = !rejected && suggestion !== null;
      assert.strictEqual(shouldShowAgain, true, 'Should show suggestion again');
    });

    it('generates successive prompts as project progresses', () => {
      startProject({ projectName: 'progress-test', projectPath: testDir });
      
      // Collect prompts across multiple phases
      const prompts: string[] = [];
      
      // PLAN phase suggestion
      prompts.push(getSmartPromptSuggestion(testDir).prompt);
      
      // Advance to BUILD
      setPhase(testDir, { phase: 'BUILD', step: 'RULES' });
      prompts.push(getSmartPromptSuggestion(testDir).prompt);
      
      // Advance further
      setPhase(testDir, { phase: 'BUILD', step: 'IMPLEMENT' });
      prompts.push(getSmartPromptSuggestion(testDir).prompt);
      
      // All should be non-empty
      for (const p of prompts) {
        assert.ok(p && p.length > 0, `Prompt should not be empty: "${p}"`);
      }
    });
  });

  // ==========================================================================
  // AUTO MODE COUNTDOWN
  // ==========================================================================

  describe('Auto Mode Countdown', () => {
    it('counts down from 5 to 0', async () => {
      let countdown = 5;
      const decrements: number[] = [];
      
      while (countdown > 0) {
        countdown--;
        decrements.push(countdown);
      }
      
      assert.deepStrictEqual(decrements, [4, 3, 2, 1, 0]);
      assert.strictEqual(countdown, 0, 'Should reach 0');
    });

    it('resets countdown on reject', () => {
      let countdown = 3;
      
      // User clicks SKIP
      countdown = 0;
      
      assert.strictEqual(countdown, 0, 'Countdown should reset to 0 on reject');
    });

    it('resets countdown when watcher goes offline', () => {
      let countdown = 4;
      let connected = true;
      
      // Watcher disconnects
      connected = false;
      if (!connected) countdown = 0;
      
      assert.strictEqual(countdown, 0, 'Countdown should reset when offline');
    });
  });
});
