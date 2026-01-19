/**
 * Recursive Planning Session - Tests
 * 
 * TDD-first implementation of TRM-inspired recursive planning.
 * 
 * Core concepts from the TRM paper:
 * - x: input/requirements (stable across iterations)
 * - z: latent reasoning state (accumulated learning, like chain-of-thought)
 * - y: current answer/implementation state
 * 
 * Key behaviors:
 * 1. Deep supervision: multiple refinement iterations
 * 2. Recursive z refinement: reasoning improves with each cycle
 * 3. Answer refinement: y improves given z
 * 4. Adaptive halting: stop when correct, don't waste iterations
 * 5. State persistence: z carries forward, preventing "forgetting"
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  RecursiveSession,
  SessionState,
  RefinementResult,
  HaltDecision,
  createSession,
  refineReasoning,
  refineAnswer,
  checkHalt,
  runIteration,
  runSession,
  serializeState,
  deserializeState,
  calculateConfidence,
  mergeReasoning,
} from './recursive-session.js';

// ============================================================================
// TEST UTILITIES
// ============================================================================

let testDir: string;
let sessionCounter = 0;

function createTestDir(): string {
  const dir = join(tmpdir(), `recursive-planning-test-${Date.now()}-${++sessionCounter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  try {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // Ignore
  }
}

// Mock refiners for testing
function mockReasoningRefiner(x: string, y: string, z: string): string {
  // Simulates reasoning improvement
  const iteration = (z.match(/iteration:/g) || []).length + 1;
  return `${z}\niteration:${iteration} analyzed "${x}" with current "${y}"`;
}

function mockAnswerRefiner(y: string, z: string): string {
  // Simulates answer improvement based on reasoning
  const improvements = (z.match(/iteration:/g) || []).length;
  return `${y} [improved x${improvements}]`;
}

function mockHaltChecker(x: string, y: string, z: string): HaltDecision {
  // Halt when we have 3+ improvements
  const improvements = (y.match(/improved/g) || []).length;
  return {
    shouldHalt: improvements >= 3,
    confidence: Math.min(100, improvements * 30),
    reason: improvements >= 3 ? 'Sufficient improvements' : 'More iterations needed',
  };
}

// ============================================================================
// SESSION STATE TESTS
// ============================================================================

describe('RecursiveSession State Management', () => {
  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanup(testDir);
  });

  describe('createSession', () => {
    it('should create session with initial state', () => {
      const session = createSession({
        x: 'Build a todo app',
        projectPath: testDir,
      });

      assert.strictEqual(session.state.x, 'Build a todo app');
      assert.strictEqual(session.state.y, '');  // Empty initial answer
      assert.strictEqual(session.state.z, '');  // Empty initial reasoning
      assert.strictEqual(session.state.iteration, 0);
      assert.strictEqual(session.state.halted, false);
    });

    it('should accept initial y and z', () => {
      const session = createSession({
        x: 'Build a todo app',
        y: 'Initial implementation',
        z: 'Prior reasoning',
        projectPath: testDir,
      });

      assert.strictEqual(session.state.y, 'Initial implementation');
      assert.strictEqual(session.state.z, 'Prior reasoning');
    });

    it('should set max iterations', () => {
      const session = createSession({
        x: 'Build a todo app',
        projectPath: testDir,
        maxIterations: 8,
      });

      assert.strictEqual(session.config.maxIterations, 8);
    });

    it('should default to 16 max iterations (per TRM paper)', () => {
      const session = createSession({
        x: 'Build a todo app',
        projectPath: testDir,
      });

      assert.strictEqual(session.config.maxIterations, 16);
    });

    it('should generate unique session ID', () => {
      const s1 = createSession({ x: 'A', projectPath: testDir });
      const s2 = createSession({ x: 'B', projectPath: testDir });

      assert.notStrictEqual(s1.id, s2.id);
    });

    it('should record creation timestamp', () => {
      const before = Date.now();
      const session = createSession({ x: 'A', projectPath: testDir });
      const after = Date.now();

      assert.ok(session.createdAt >= before);
      assert.ok(session.createdAt <= after);
    });
  });

  describe('State Serialization', () => {
    it('should serialize state to JSON', () => {
      const state: SessionState = {
        x: 'Build a todo app',
        y: 'Current code',
        z: 'Reasoning so far',
        iteration: 5,
        halted: false,
        haltReason: null,
        history: [],
      };

      const json = serializeState(state);
      const parsed = JSON.parse(json);

      assert.strictEqual(parsed.x, 'Build a todo app');
      assert.strictEqual(parsed.iteration, 5);
    });

    it('should deserialize state from JSON', () => {
      const json = JSON.stringify({
        x: 'Build a todo app',
        y: 'Current code',
        z: 'Reasoning',
        iteration: 3,
        halted: false,
        haltReason: null,
        history: [],
      });

      const state = deserializeState(json);

      assert.strictEqual(state.x, 'Build a todo app');
      assert.strictEqual(state.iteration, 3);
    });

    it('should handle corrupted JSON gracefully', () => {
      const state = deserializeState('{ invalid json }}}');

      assert.strictEqual(state.x, '');
      assert.strictEqual(state.iteration, 0);
    });

    it('should preserve history across serialization', () => {
      const state: SessionState = {
        x: 'Test',
        y: 'Answer',
        z: 'Reasoning',
        iteration: 2,
        halted: false,
        haltReason: null,
        history: [
          { iteration: 1, z: 'First reasoning', y: 'First answer', confidence: 30 },
          { iteration: 2, z: 'Second reasoning', y: 'Second answer', confidence: 60 },
        ],
      };

      const json = serializeState(state);
      const restored = deserializeState(json);

      assert.strictEqual(restored.history.length, 2);
      assert.strictEqual(restored.history[0].confidence, 30);
    });
  });
});

// ============================================================================
// REFINEMENT TESTS
// ============================================================================

describe('Recursive Refinement', () => {
  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanup(testDir);
  });

  describe('refineReasoning (z refinement)', () => {
    it('should improve z given x, y, and current z', () => {
      const result = refineReasoning({
        x: 'Build a todo app',
        y: 'Empty project',
        z: 'Initial thoughts',
        refiner: mockReasoningRefiner,
      });

      assert.ok(result.z.includes('iteration:1'));
      assert.ok(result.z.includes('Initial thoughts'));  // Carries forward
    });

    it('should accumulate reasoning across multiple calls', () => {
      let z = '';
      
      z = refineReasoning({ x: 'Task', y: 'Code v1', z, refiner: mockReasoningRefiner }).z;
      z = refineReasoning({ x: 'Task', y: 'Code v2', z, refiner: mockReasoningRefiner }).z;
      z = refineReasoning({ x: 'Task', y: 'Code v3', z, refiner: mockReasoningRefiner }).z;

      assert.ok(z.includes('iteration:1'));
      assert.ok(z.includes('iteration:2'));
      assert.ok(z.includes('iteration:3'));
    });

    it('should record refinement duration', () => {
      const result = refineReasoning({
        x: 'Task',
        y: 'Code',
        z: '',
        refiner: mockReasoningRefiner,
      });

      assert.ok(result.duration >= 0);
    });
  });

  describe('refineAnswer (y refinement)', () => {
    it('should improve y given current y and z', () => {
      const z = 'iteration:1 analyzed\niteration:2 analyzed';
      const result = refineAnswer({
        y: 'Initial code',
        z,
        refiner: mockAnswerRefiner,
      });

      assert.ok(result.y.includes('improved'));
      assert.ok(result.y.includes('Initial code'));
    });

    it('should not modify y if z is empty', () => {
      const result = refineAnswer({
        y: 'Code',
        z: '',
        refiner: (y, z) => z ? `${y} improved` : y,
      });

      assert.strictEqual(result.y, 'Code');
    });
  });

  describe('mergeReasoning', () => {
    it('should combine old and new reasoning', () => {
      const merged = mergeReasoning(
        'Old insight: use React',
        'New insight: add TypeScript'
      );

      assert.ok(merged.includes('Old insight'));
      assert.ok(merged.includes('New insight'));
    });

    it('should handle empty old reasoning', () => {
      const merged = mergeReasoning('', 'First insight');
      assert.strictEqual(merged, 'First insight');
    });

    it('should handle empty new reasoning', () => {
      const merged = mergeReasoning('Old insight', '');
      assert.strictEqual(merged, 'Old insight');
    });

    it('should cap reasoning length to prevent unbounded growth', () => {
      const longOld = 'x'.repeat(10000);
      const longNew = 'y'.repeat(10000);
      
      const merged = mergeReasoning(longOld, longNew);
      
      // Should be capped (e.g., 8000 chars max)
      assert.ok(merged.length <= 8000);
    });
  });
});

// ============================================================================
// HALTING TESTS
// ============================================================================

describe('Adaptive Halting', () => {
  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanup(testDir);
  });

  describe('checkHalt', () => {
    it('should return shouldHalt=true when criteria met', () => {
      const decision = checkHalt({
        x: 'Task',
        y: 'Final answer [improved x1] [improved x2] [improved x3]',
        z: 'Reasoning',
        checker: mockHaltChecker,
      });

      assert.strictEqual(decision.shouldHalt, true);
      assert.ok(decision.confidence >= 90);
    });

    it('should return shouldHalt=false when more work needed', () => {
      const decision = checkHalt({
        x: 'Task',
        y: 'Initial answer',
        z: 'Reasoning',
        checker: mockHaltChecker,
      });

      assert.strictEqual(decision.shouldHalt, false);
    });

    it('should provide halt reason', () => {
      const decision = checkHalt({
        x: 'Task',
        y: 'Final answer [improved x1] [improved x2] [improved x3]',
        z: 'Reasoning',
        checker: mockHaltChecker,
      });

      assert.ok(decision.reason.length > 0);
    });

    it('should halt at max iterations even if not confident', () => {
      const decision = checkHalt({
        x: 'Task',
        y: 'Partial answer',
        z: 'Reasoning',
        iteration: 16,
        maxIterations: 16,
        checker: mockHaltChecker,
      });

      assert.strictEqual(decision.shouldHalt, true);
      assert.ok(decision.reason.includes('max'));
    });
  });

  describe('calculateConfidence', () => {
    it('should return 0 for empty answer', () => {
      const conf = calculateConfidence('Task', '', 'Reasoning');
      assert.strictEqual(conf, 0);
    });

    it('should increase with more reasoning iterations', () => {
      const z1 = 'iteration:1';
      const z2 = 'iteration:1\niteration:2\niteration:3';

      const conf1 = calculateConfidence('Task', 'Answer', z1);
      const conf2 = calculateConfidence('Task', 'Answer', z2);

      assert.ok(conf2 > conf1);
    });

    it('should be bounded 0-100', () => {
      const z = Array(100).fill('iteration').join('\n');
      const conf = calculateConfidence('Task', 'Answer', z);

      assert.ok(conf >= 0);
      assert.ok(conf <= 100);
    });
  });
});

// ============================================================================
// ITERATION TESTS
// ============================================================================

describe('Single Iteration', () => {
  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanup(testDir);
  });

  describe('runIteration', () => {
    it('should perform one complete cycle: z refinement → y refinement', () => {
      const state: SessionState = {
        x: 'Build todo app',
        y: 'Empty',
        z: '',
        iteration: 0,
        halted: false,
        haltReason: null,
        history: [],
      };

      const result = runIteration(state, {
        reasoningRefiner: mockReasoningRefiner,
        answerRefiner: mockAnswerRefiner,
        haltChecker: mockHaltChecker,
      });

      assert.strictEqual(result.state.iteration, 1);
      assert.ok(result.state.z.includes('iteration:1'));
      assert.ok(result.state.y.includes('improved'));
    });

    it('should record iteration in history', () => {
      const state: SessionState = {
        x: 'Task',
        y: 'Code',
        z: '',
        iteration: 0,
        halted: false,
        haltReason: null,
        history: [],
      };

      const result = runIteration(state, {
        reasoningRefiner: mockReasoningRefiner,
        answerRefiner: mockAnswerRefiner,
        haltChecker: mockHaltChecker,
      });

      assert.strictEqual(result.state.history.length, 1);
      assert.strictEqual(result.state.history[0].iteration, 1);
    });

    it('should check halt after refinement', () => {
      const state: SessionState = {
        x: 'Task',
        y: 'Answer [improved x1] [improved x2] [improved x3]',
        z: '',
        iteration: 0,
        halted: false,
        haltReason: null,
        history: [],
      };

      const result = runIteration(state, {
        reasoningRefiner: mockReasoningRefiner,
        answerRefiner: mockAnswerRefiner,
        haltChecker: mockHaltChecker,
      });

      // After one more improvement, should have 4 and halt
      assert.strictEqual(result.state.halted, true);
    });

    it('should not mutate original state', () => {
      const state: SessionState = {
        x: 'Task',
        y: 'Code',
        z: 'Reasoning',
        iteration: 5,
        halted: false,
        haltReason: null,
        history: [],
      };

      const originalZ = state.z;
      runIteration(state, {
        reasoningRefiner: mockReasoningRefiner,
        answerRefiner: mockAnswerRefiner,
        haltChecker: mockHaltChecker,
      });

      assert.strictEqual(state.z, originalZ);
      assert.strictEqual(state.iteration, 5);
    });
  });
});

// ============================================================================
// FULL SESSION TESTS
// ============================================================================

describe('Full Session Run', () => {
  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanup(testDir);
  });

  describe('runSession', () => {
    it('should run until halt condition met', () => {
      const session = createSession({
        x: 'Build todo app',
        projectPath: testDir,
        maxIterations: 16,
      });

      const result = runSession(session, {
        reasoningRefiner: mockReasoningRefiner,
        answerRefiner: mockAnswerRefiner,
        haltChecker: mockHaltChecker,
      });

      assert.strictEqual(result.state.halted, true);
      assert.ok(result.state.iteration >= 3);  // Needs 3+ improvements to halt
      assert.ok(result.state.iteration <= 16); // Should halt before max
    });

    it('should stop at maxIterations if no halt', () => {
      const neverHaltChecker = () => ({
        shouldHalt: false,
        confidence: 0,
        reason: 'Never halt',
      });

      const session = createSession({
        x: 'Impossible task',
        projectPath: testDir,
        maxIterations: 5,
      });

      const result = runSession(session, {
        reasoningRefiner: mockReasoningRefiner,
        answerRefiner: mockAnswerRefiner,
        haltChecker: neverHaltChecker,
      });

      assert.strictEqual(result.state.iteration, 5);
      assert.strictEqual(result.state.halted, true);
      assert.ok(result.state.haltReason?.includes('max'));
    });

    it('should accumulate z across all iterations', () => {
      const session = createSession({
        x: 'Task',
        projectPath: testDir,
        maxIterations: 5,
      });

      const result = runSession(session, {
        reasoningRefiner: mockReasoningRefiner,
        answerRefiner: mockAnswerRefiner,
        haltChecker: () => ({ shouldHalt: false, confidence: 0, reason: '' }),
      });

      // Should have 5 iterations recorded in z
      const iterations = (result.state.z.match(/iteration:/g) || []).length;
      assert.strictEqual(iterations, 5);
    });

    it('should preserve full history', () => {
      const session = createSession({
        x: 'Task',
        projectPath: testDir,
        maxIterations: 4,
      });

      const result = runSession(session, {
        reasoningRefiner: mockReasoningRefiner,
        answerRefiner: mockAnswerRefiner,
        haltChecker: () => ({ shouldHalt: false, confidence: 0, reason: '' }),
      });

      assert.strictEqual(result.state.history.length, 4);
    });

    it('should report total duration', () => {
      const session = createSession({
        x: 'Task',
        projectPath: testDir,
        maxIterations: 3,
      });

      const result = runSession(session, {
        reasoningRefiner: mockReasoningRefiner,
        answerRefiner: mockAnswerRefiner,
        haltChecker: () => ({ shouldHalt: false, confidence: 0, reason: '' }),
      });

      assert.ok(result.totalDuration >= 0);
    });

    it('should handle early halt efficiently', () => {
      const immediateHalt = () => ({
        shouldHalt: true,
        confidence: 100,
        reason: 'Already perfect',
      });

      const session = createSession({
        x: 'Easy task',
        y: 'Perfect answer',
        projectPath: testDir,
        maxIterations: 16,
      });

      const result = runSession(session, {
        reasoningRefiner: mockReasoningRefiner,
        answerRefiner: mockAnswerRefiner,
        haltChecker: immediateHalt,
      });

      assert.strictEqual(result.state.iteration, 1);  // Only one iteration
    });
  });
});

// ============================================================================
// DEEP SUPERVISION TESTS (TRM-specific)
// ============================================================================

describe('Deep Supervision (TRM Pattern)', () => {
  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanup(testDir);
  });

  it('should detach reasoning between supervision steps (no gradient explosion analog)', () => {
    // In TRM, z.detach() prevents gradient explosion
    // Our analog: reasoning from previous iteration is "frozen" - we don't re-analyze it
    const session = createSession({
      x: 'Complex task',
      projectPath: testDir,
      maxIterations: 3,
    });

    let lastZ = '';
    const trackingRefiner = (x: string, y: string, z: string) => {
      // The incoming z should equal the last z we produced (frozen, not re-processed)
      if (lastZ !== '') {
        assert.ok(z.includes(lastZ.slice(-50)));  // Check tail preserved
      }
      const newZ = mockReasoningRefiner(x, y, z);
      lastZ = newZ;
      return newZ;
    };

    runSession(session, {
      reasoningRefiner: trackingRefiner,
      answerRefiner: mockAnswerRefiner,
      haltChecker: () => ({ shouldHalt: false, confidence: 0, reason: '' }),
    });
  });

  it('should support T recursions per supervision step (like TRM n param)', () => {
    // TRM does T=3 latent recursions before updating answer
    // We simulate by doing multiple z refinements per y update
    const session = createSession({
      x: 'Task',
      projectPath: testDir,
      maxIterations: 2,
    });

    let zRefinements = 0;
    let yRefinements = 0;

    const countingZRefiner = (x: string, y: string, z: string) => {
      zRefinements++;
      return mockReasoningRefiner(x, y, z);
    };

    const countingYRefiner = (y: string, z: string) => {
      yRefinements++;
      return mockAnswerRefiner(y, z);
    };

    runSession(session, {
      reasoningRefiner: countingZRefiner,
      answerRefiner: countingYRefiner,
      haltChecker: () => ({ shouldHalt: false, confidence: 0, reason: '' }),
      latentRecursions: 3,  // T=3 like TRM
    });

    // With 2 iterations and T=3, should have 6 z refinements and 2 y refinements
    assert.strictEqual(zRefinements, 6);
    assert.strictEqual(yRefinements, 2);
  });
});

// ============================================================================
// PERSISTENCE TESTS
// ============================================================================

describe('Session Persistence', () => {
  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanup(testDir);
  });

  it('should save session state to disk', () => {
    const session = createSession({
      x: 'Build todo app',
      projectPath: testDir,
    });

    const result = runSession(session, {
      reasoningRefiner: mockReasoningRefiner,
      answerRefiner: mockAnswerRefiner,
      haltChecker: () => ({ shouldHalt: false, confidence: 0, reason: '' }),
    });

    // State should be persisted
    const statePath = join(testDir, '.midas', 'recursive-session.json');
    assert.ok(existsSync(statePath));

    const saved = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert.strictEqual(saved.x, 'Build todo app');
    assert.ok(saved.iteration > 0);
  });

  it('should resume session from disk', () => {
    // First run
    const session1 = createSession({
      x: 'Build todo app',
      projectPath: testDir,
      maxIterations: 3,
    });

    runSession(session1, {
      reasoningRefiner: mockReasoningRefiner,
      answerRefiner: mockAnswerRefiner,
      haltChecker: () => ({ shouldHalt: false, confidence: 0, reason: '' }),
    });

    // Resume - should load previous state
    const session2 = createSession({
      x: 'Build todo app',
      projectPath: testDir,
      maxIterations: 6,
      resume: true,
    });

    assert.strictEqual(session2.state.iteration, 3);  // Resumed from 3
  });

  it('should handle missing session file gracefully', () => {
    const session = createSession({
      x: 'New task',
      projectPath: testDir,
      resume: true,  // Try to resume but no file exists
    });

    assert.strictEqual(session.state.iteration, 0);  // Fresh start
  });
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

describe('Edge Cases', () => {
  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanup(testDir);
  });

  it('should handle empty x (requirements)', () => {
    const session = createSession({
      x: '',
      projectPath: testDir,
    });

    // Should still work, just with empty context
    const result = runSession(session, {
      reasoningRefiner: mockReasoningRefiner,
      answerRefiner: mockAnswerRefiner,
      haltChecker: () => ({ shouldHalt: true, confidence: 100, reason: 'Done' }),
    });

    assert.strictEqual(result.state.halted, true);
  });

  it('should handle refiner throwing error', () => {
    const throwingRefiner = () => {
      throw new Error('Refiner crashed');
    };

    const session = createSession({
      x: 'Task',
      projectPath: testDir,
    });

    // Should not crash, should handle gracefully
    const result = runSession(session, {
      reasoningRefiner: throwingRefiner,
      answerRefiner: mockAnswerRefiner,
      haltChecker: () => ({ shouldHalt: false, confidence: 0, reason: '' }),
    });

    assert.ok(result.state.halted);
    assert.ok(result.state.haltReason?.includes('error'));
  });

  it('should handle very long x (requirements)', () => {
    const longX = 'x'.repeat(100000);

    const session = createSession({
      x: longX,
      projectPath: testDir,
      maxIterations: 1,
    });

    const result = runSession(session, {
      reasoningRefiner: mockReasoningRefiner,
      answerRefiner: mockAnswerRefiner,
      haltChecker: () => ({ shouldHalt: true, confidence: 100, reason: 'Done' }),
    });

    assert.strictEqual(result.state.halted, true);
  });

  it('should handle concurrent session access', async () => {
    const session1 = createSession({ x: 'Task 1', projectPath: testDir });
    const session2 = createSession({ x: 'Task 2', projectPath: testDir });

    // Different sessions should not interfere
    const result1 = runSession(session1, {
      reasoningRefiner: mockReasoningRefiner,
      answerRefiner: mockAnswerRefiner,
      haltChecker: () => ({ shouldHalt: true, confidence: 100, reason: 'Done' }),
    });

    const result2 = runSession(session2, {
      reasoningRefiner: mockReasoningRefiner,
      answerRefiner: mockAnswerRefiner,
      haltChecker: () => ({ shouldHalt: true, confidence: 100, reason: 'Done' }),
    });

    assert.strictEqual(result1.state.x, 'Task 1');
    assert.strictEqual(result2.state.x, 'Task 2');
  });

  it('should handle zero maxIterations', () => {
    const session = createSession({
      x: 'Task',
      projectPath: testDir,
      maxIterations: 0,
    });

    const result = runSession(session, {
      reasoningRefiner: mockReasoningRefiner,
      answerRefiner: mockAnswerRefiner,
      haltChecker: mockHaltChecker,
    });

    assert.strictEqual(result.state.iteration, 0);
    assert.strictEqual(result.state.halted, true);
  });
});

// ============================================================================
// PROPERTY-BASED TESTS
// ============================================================================

describe('Property-Based Invariants', () => {
  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanup(testDir);
  });

  it('iteration count should equal history length', () => {
    for (let max = 1; max <= 10; max++) {
      const session = createSession({
        x: 'Task',
        projectPath: testDir,
        maxIterations: max,
      });

      const result = runSession(session, {
        reasoningRefiner: mockReasoningRefiner,
        answerRefiner: mockAnswerRefiner,
        haltChecker: () => ({ shouldHalt: false, confidence: 0, reason: '' }),
      });

      assert.strictEqual(result.state.iteration, result.state.history.length);
    }
  });

  it('z should only grow (accumulate), never shrink', () => {
    const session = createSession({
      x: 'Task',
      projectPath: testDir,
      maxIterations: 5,
    });

    let prevZLength = 0;
    const growthCheckRefiner = (x: string, y: string, z: string) => {
      if (prevZLength > 0) {
        assert.ok(z.length >= prevZLength - 100);  // Allow small variance from truncation
      }
      const newZ = mockReasoningRefiner(x, y, z);
      prevZLength = newZ.length;
      return newZ;
    };

    runSession(session, {
      reasoningRefiner: growthCheckRefiner,
      answerRefiner: mockAnswerRefiner,
      haltChecker: () => ({ shouldHalt: false, confidence: 0, reason: '' }),
    });
  });

  it('confidence should generally increase over iterations', () => {
    const session = createSession({
      x: 'Task',
      projectPath: testDir,
      maxIterations: 5,
    });

    const result = runSession(session, {
      reasoningRefiner: mockReasoningRefiner,
      answerRefiner: mockAnswerRefiner,
      haltChecker: () => ({ shouldHalt: false, confidence: 0, reason: '' }),
    });

    // Check that confidence generally trends up
    const confidences = result.state.history.map(h => h.confidence);
    const isGenerallyIncreasing = confidences.every((c, i) => 
      i === 0 || c >= confidences[i - 1] - 10  // Allow small dips
    );

    assert.ok(isGenerallyIncreasing, `Confidences should trend up: ${confidences}`);
  });
});
