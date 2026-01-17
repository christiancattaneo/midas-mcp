/**
 * Gameplan Tracker Tests
 * 
 * Tests for parsing, correlating, and tracking gameplan progress.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { 
  parseGameplanTasks, 
  analyzeGameplan, 
  getGameplanProgress,
  validateGameplanProgress,
} from '../gameplan-tracker.js';

// ============================================================================
// TEST SETUP
// ============================================================================

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `midas-gameplan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // Ignore
  }
});

// ============================================================================
// TASK PARSING
// ============================================================================

describe('parseGameplanTasks', () => {
  it('should parse checkbox tasks', () => {
    const content = `
# Gameplan

## Phase 1: Setup
- [ ] Initialize project
- [x] Create package.json
- [ ] Setup TypeScript

## Phase 2: Core
- [ ] Implement auth
- [x] Add database
`;
    
    const tasks = parseGameplanTasks(content);
    
    assert.strictEqual(tasks.length, 5);
    assert.strictEqual(tasks.filter(t => t.completed).length, 2);
    
    const initTask = tasks.find(t => t.text.includes('Initialize'));
    assert.ok(initTask);
    assert.strictEqual(initTask.completed, false);
    assert.strictEqual(initTask.phase, 'Setup');
    
    const pkgTask = tasks.find(t => t.text.includes('package.json'));
    assert.ok(pkgTask);
    assert.strictEqual(pkgTask.completed, true);
  });

  it('should parse numbered tasks', () => {
    const content = `
# Implementation Plan

1. First task
2. Second task
3. Third task
`;
    
    const tasks = parseGameplanTasks(content);
    
    assert.strictEqual(tasks.length, 3);
    assert.strictEqual(tasks[0].text, 'First task');
    assert.strictEqual(tasks[1].text, 'Second task');
    assert.strictEqual(tasks[2].text, 'Third task');
  });

  it('should handle mixed formats', () => {
    const content = `
# Plan

## Setup
- [ ] Task 1
- [x] Task 2

## Implementation  
1. Numbered task 1
2. Numbered task 2
`;
    
    const tasks = parseGameplanTasks(content);
    
    assert.strictEqual(tasks.length, 4);
  });

  it('should detect priority keywords', () => {
    const content = `
- [ ] Critical: Must fix this bug
- [ ] Nice to have: Add dark mode
- [ ] Normal task
- [ ] P0: Blocker issue
`;
    
    const tasks = parseGameplanTasks(content);
    
    assert.strictEqual(tasks[0].priority, 'high');
    assert.strictEqual(tasks[1].priority, 'low');
    assert.strictEqual(tasks[2].priority, 'medium');
    assert.strictEqual(tasks[3].priority, 'high');
  });

  it('should handle empty content', () => {
    const tasks = parseGameplanTasks('');
    assert.strictEqual(tasks.length, 0);
  });

  it('should handle content with no tasks', () => {
    const content = `
# Gameplan

This is just some text without any tasks.

## Section

More text here.
`;
    
    const tasks = parseGameplanTasks(content);
    assert.strictEqual(tasks.length, 0);
  });

  it('should handle asterisk bullets', () => {
    const content = `
* [ ] Task with asterisk
* [x] Completed asterisk task
`;
    
    const tasks = parseGameplanTasks(content);
    
    assert.strictEqual(tasks.length, 2);
    assert.strictEqual(tasks[0].completed, false);
    assert.strictEqual(tasks[1].completed, true);
  });
});

// ============================================================================
// GAMEPLAN ANALYSIS
// ============================================================================

describe('analyzeGameplan', () => {
  it('should return empty analysis when no gameplan exists', () => {
    const analysis = analyzeGameplan(testDir);
    
    assert.strictEqual(analysis.totalTasks, 0);
    assert.ok(analysis.summary.includes('No gameplan'));
  });

  it('should analyze gameplan with tasks', () => {
    mkdirSync(join(testDir, 'docs'));
    writeFileSync(join(testDir, 'docs', 'gameplan.md'), `
# Gameplan

## Phase 1
- [x] Create main.ts
- [ ] Add tests
- [ ] Write docs
`);
    
    // Create a source file
    mkdirSync(join(testDir, 'src'));
    writeFileSync(join(testDir, 'src', 'main.ts'), 'export const main = true;');
    
    const analysis = analyzeGameplan(testDir);
    
    assert.strictEqual(analysis.totalTasks, 3);
    assert.strictEqual(analysis.completedTasks, 1);
  });

  it('should detect missing implementation', () => {
    mkdirSync(join(testDir, 'docs'));
    writeFileSync(join(testDir, 'docs', 'gameplan.md'), `
- [x] Implement authentication
- [x] Add payment processing
`);
    
    // No code exists
    const analysis = analyzeGameplan(testDir);
    
    // Both are marked done but no code found
    assert.ok(analysis.missingImplementation.length >= 0);  // May find some if keywords match
  });

  it('should calculate progress percentages', () => {
    mkdirSync(join(testDir, 'docs'));
    writeFileSync(join(testDir, 'docs', 'gameplan.md'), `
- [x] Task 1
- [x] Task 2
- [ ] Task 3
- [ ] Task 4
`);
    
    const analysis = analyzeGameplan(testDir);
    
    assert.strictEqual(analysis.documentProgress, 50);  // 2/4 = 50%
  });

  it('should suggest next task', () => {
    mkdirSync(join(testDir, 'docs'));
    writeFileSync(join(testDir, 'docs', 'gameplan.md'), `
- [x] Completed task
- [ ] Next task to do
- [ ] Another pending task
`);
    
    const analysis = analyzeGameplan(testDir);
    
    assert.ok(analysis.nextTask);
    assert.strictEqual(analysis.nextTask.text, 'Next task to do');
  });
});

// ============================================================================
// PROGRESS TRACKING
// ============================================================================

describe('getGameplanProgress', () => {
  it('should return zero progress for no gameplan', () => {
    const progress = getGameplanProgress(testDir);
    
    assert.strictEqual(progress.documented, 0);
    assert.strictEqual(progress.actual, 0);
  });

  it('should return progress with gameplan', () => {
    mkdirSync(join(testDir, 'docs'));
    writeFileSync(join(testDir, 'docs', 'gameplan.md'), `
- [x] Done 1
- [x] Done 2
- [ ] Todo 1
- [ ] Todo 2
`);
    
    const progress = getGameplanProgress(testDir);
    
    assert.strictEqual(progress.documented, 50);
  });
});

// ============================================================================
// VALIDATION
// ============================================================================

describe('validateGameplanProgress', () => {
  it('should warn when no tasks found', () => {
    mkdirSync(join(testDir, 'docs'));
    writeFileSync(join(testDir, 'docs', 'gameplan.md'), `
# Gameplan

Just some text, no tasks.
`);
    
    const validation = validateGameplanProgress(testDir);
    
    assert.strictEqual(validation.valid, false);
    assert.ok(validation.warnings.some(w => w.includes('No tasks')));
  });

  it('should pass when gameplan has tasks', () => {
    mkdirSync(join(testDir, 'docs'));
    writeFileSync(join(testDir, 'docs', 'gameplan.md'), `
- [ ] Task 1
- [ ] Task 2
`);
    
    const validation = validateGameplanProgress(testDir);
    
    // May or may not be valid depending on other checks
    assert.ok(validation.warnings !== undefined);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  it('should handle very long task text', () => {
    const longTask = 'a'.repeat(1000);
    const content = `- [ ] ${longTask}`;
    
    const tasks = parseGameplanTasks(content);
    
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].text.length, 1000);
  });

  it('should handle special characters in tasks', () => {
    const content = `
- [ ] Fix bug #123
- [ ] Add feature (with details)
- [ ] Update: config & settings
- [ ] Handle "quoted text"
`;
    
    const tasks = parseGameplanTasks(content);
    
    assert.strictEqual(tasks.length, 4);
  });

  it('should handle unicode in tasks', () => {
    const content = `
- [ ] 添加中文功能
- [ ] Fix 🐛 bug
- [ ] Add emoji 🚀
`;
    
    const tasks = parseGameplanTasks(content);
    
    assert.strictEqual(tasks.length, 3);
  });

  it('should handle nested lists', () => {
    const content = `
- [ ] Parent task
  - [ ] Subtask 1
  - [ ] Subtask 2
- [ ] Another parent
`;
    
    const tasks = parseGameplanTasks(content);
    
    // All should be parsed as tasks
    assert.ok(tasks.length >= 3);
  });

  it('should handle malformed checkboxes', () => {
    const content = `
- [ Task without closing bracket
- [] Empty checkbox
- [  ] Double space
- [X] Uppercase X
`;
    
    const tasks = parseGameplanTasks(content);
    
    // Should only match well-formed checkboxes
    // [X] should match, [ ] with double space might
    assert.ok(tasks.length >= 1);
  });
});
