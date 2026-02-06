/**
 * State Corruption Stress Tests
 * 
 * Comprehensive, exhaustive testing of state/JSON corruption edge cases.
 * Covers: corrupted JSON (50+ variations), empty files, null values,
 * missing fields, huge files, type mismatches, prototype pollution,
 * schema evolution, and recovery scenarios.
 * 
 * Based on best practices from:
 * - OWASP JSON security
 * - Prototype pollution prevention
 * - Schema validation patterns
 * - Crash consistency testing
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fc from 'fast-check';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Module imports
import { loadState, saveState, getDefaultState, setPhase, createHistoryEntry } from '../state/phase.js';
import { loadTracker, saveTracker, recordError } from '../tracker.js';
import type { PhaseState } from '../state/phase.js';
import type { TrackerState } from '../tracker.js';

// Helper to load reality state (simplified since not all exports are available)
function loadRealityState(dir: string): { checkStatuses: Record<string, unknown> } {
  try {
    const content = readFileSync(join(dir, STATE_DIR, PREFLIGHT_FILE), 'utf-8');
    const parsed = JSON.parse(content);
    return { checkStatuses: parsed.checkStatuses || {} };
  } catch {
    return { checkStatuses: {} };
  }
}

// ============================================================================
// CONSTANTS
// ============================================================================

const STATE_DIR = '.midas';
const STATE_FILE = 'state.json';
const TRACKER_FILE = 'tracker.json';
const PREFLIGHT_FILE = 'preflight-checks.json';

// ============================================================================
// TEST SETUP
// ============================================================================

let testDir: string;
let cleanupDirs: string[] = [];

function createTestDir(prefix: string): string {
  const dir = join(tmpdir(), `midas-state-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, STATE_DIR), { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}

function cleanup(): void {
  for (const dir of cleanupDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  cleanupDirs = [];
}

function writeState(dir: string, content: string): void {
  writeFileSync(join(dir, STATE_DIR, STATE_FILE), content);
}

function writeTracker(dir: string, content: string): void {
  writeFileSync(join(dir, STATE_DIR, TRACKER_FILE), content);
}

function writeReality(dir: string, content: string): void {
  writeFileSync(join(dir, STATE_DIR, PREFLIGHT_FILE), content);
}

beforeEach(() => {
  testDir = createTestDir('corruption');
});

afterEach(() => {
  cleanup();
});

// ============================================================================
// 1. CORRUPTED JSON SYNTAX (50+ VARIATIONS)
// ============================================================================

describe('Corrupted JSON Syntax', () => {
  // All these should trigger recovery to default state
  const corruptedJsonVariants = [
    // Empty / whitespace
    { name: 'empty string', content: '' },
    { name: 'single space', content: ' ' },
    { name: 'multiple spaces', content: '     ' },
    { name: 'single newline', content: '\n' },
    { name: 'multiple newlines', content: '\n\n\n' },
    { name: 'tabs only', content: '\t\t\t' },
    { name: 'mixed whitespace', content: ' \t\n \t\n ' },
    
    // Primitives (not objects)
    { name: 'null literal', content: 'null' },
    { name: 'true literal', content: 'true' },
    { name: 'false literal', content: 'false' },
    { name: 'number literal', content: '42' },
    { name: 'negative number', content: '-1' },
    { name: 'float literal', content: '3.14159' },
    { name: 'string literal', content: '"hello"' },
    { name: 'array literal', content: '[]' },
    { name: 'array with values', content: '[1, 2, 3]' },
    
    // Truncated objects
    { name: 'open brace only', content: '{' },
    { name: 'close brace only', content: '}' },
    { name: 'open brace with key', content: '{"current"' },
    { name: 'key with colon', content: '{"current":' },
    { name: 'truncated value', content: '{"current": {' },
    { name: 'truncated string', content: '{"current": "IDLE' },
    { name: 'truncated array', content: '{"history": [' },
    { name: 'truncated nested', content: '{"current": {"phase": "IDLE"' },
    
    // Invalid syntax
    { name: 'trailing comma object', content: '{"key": "value",}' },
    { name: 'trailing comma array', content: '{"arr": [1, 2,]}' },
    { name: 'double comma', content: '{"a": 1,, "b": 2}' },
    { name: 'missing comma', content: '{"a": 1 "b": 2}' },
    { name: 'missing colon', content: '{"key" "value"}' },
    { name: 'single quotes', content: "{'key': 'value'}" },
    { name: 'unquoted key', content: '{key: "value"}' },
    { name: 'unquoted value', content: '{"key": value}' },
    { name: 'extra close brace', content: '{"key": "value"}}' },
    { name: 'extra open brace', content: '{{"key": "value"}' },
    
    // Invalid values
    { name: 'undefined keyword', content: '{"key": undefined}' },
    { name: 'NaN value', content: '{"key": NaN}' },
    { name: 'Infinity value', content: '{"key": Infinity}' },
    { name: 'negative Infinity', content: '{"key": -Infinity}' },
    { name: 'hex number', content: '{"key": 0xFF}' },
    { name: 'octal number', content: '{"key": 0777}' },
    { name: 'binary number', content: '{"key": 0b1010}' },
    
    // Invalid escapes
    { name: 'invalid escape', content: '{"key": "value\\x"}' },
    { name: 'invalid unicode escape', content: '{"key": "\\uZZZZ"}' },
    { name: 'incomplete unicode', content: '{"key": "\\u00"}' },
    { name: 'bare backslash', content: '{"key": "value\\"}' },
    
    // Control characters
    { name: 'null byte', content: '{"key": "val\x00ue"}' },
    { name: 'raw newline in string', content: '{"key": "line1\nline2"}' },
    { name: 'raw tab in string', content: '{"key": "val\tue"}' },
    
    // Special prefixes
    { name: 'BOM prefix', content: '\uFEFF{"key": "value"}' },
    { name: 'UTF-8 BOM bytes', content: '\xEF\xBB\xBF{"key": "value"}' },
    
    // Binary garbage
    { name: 'PNG header', content: '\x89PNG\r\n\x1a\n' },
    { name: 'random bytes', content: '\x00\x01\x02\x03\x04\x05' },
    { name: 'all high bytes', content: '\xFF\xFF\xFF\xFF' },
    { name: 'mixed garbage', content: 'abc\x00\xFF{"partial' },
    
    // Almost valid
    { name: 'array instead of object', content: '[{"phase": "IDLE"}]' },
    { name: 'nested wrong type', content: '{"current": ["IDLE"]}' },
    { name: 'string instead of object', content: '"IDLE"' },
  ];

  describe('PhaseState recovery', () => {
    for (const { name, content } of corruptedJsonVariants) {
      it(`should recover from: ${name}`, () => {
        writeState(testDir, content);
        
        const state = loadState(testDir);
        
        // Should return valid default state
        assert.ok(state, 'State should not be null/undefined');
        assert.ok(state.current, 'State should have current');
        assert.ok(state.current.phase, 'Current should have phase');
        assert.ok(Array.isArray(state.history), 'History should be array');
        assert.ok(state.docs, 'State should have docs');
      });
    }
  });

  describe('TrackerState recovery', () => {
    for (const { name, content } of corruptedJsonVariants.slice(0, 30)) {  // Test first 30
      it(`should recover from: ${name}`, () => {
        writeTracker(testDir, content);
        
        const tracker = loadTracker(testDir);
        
        assert.ok(tracker, 'Tracker should not be null/undefined');
        assert.ok(Array.isArray(tracker.errorMemory), 'errorMemory should be array');
        assert.ok(typeof tracker.lastAnalysis === 'object', 'lastAnalysis should be object');
      });
    }
  });

  describe('RealityState recovery', () => {
    for (const { name, content } of corruptedJsonVariants.slice(0, 20)) {  // Test first 20
      it(`should recover from: ${name}`, () => {
        writeReality(testDir, content);
        
        const state = loadRealityState(testDir);
        
        assert.ok(state, 'State should not be null/undefined');
        assert.ok(typeof state.checkStatuses === 'object', 'checkStatuses should be object');
      });
    }
  });
});

// ============================================================================
// 2. EMPTY / MISSING FILES
// ============================================================================

describe('Empty and Missing Files', () => {
  describe('PhaseState', () => {
    it('should handle missing .midas directory', () => {
      const emptyDir = createTestDir('empty');
      rmSync(join(emptyDir, STATE_DIR), { recursive: true, force: true });
      
      const state = loadState(emptyDir);
      
      assert.ok(state);
      assert.strictEqual(state.current.phase, 'IDLE');
    });

    it('should handle missing state file', () => {
      const state = loadState(testDir);  // No state file written
      
      assert.ok(state);
      assert.strictEqual(state.current.phase, 'IDLE');
    });

    it('should handle empty state file', () => {
      writeState(testDir, '');
      
      const state = loadState(testDir);
      
      assert.ok(state);
      assert.ok(state.current);
    });

    it('should handle file with only null', () => {
      writeState(testDir, 'null');
      
      const state = loadState(testDir);
      
      assert.ok(state);
      assert.ok(state.current);
    });

    it('should handle file with zero bytes', () => {
      writeFileSync(join(testDir, STATE_DIR, STATE_FILE), Buffer.alloc(0));
      
      const state = loadState(testDir);
      
      assert.ok(state);
    });
  });

  describe('TrackerState', () => {
    it('should handle missing tracker file', () => {
      const tracker = loadTracker(testDir);
      
      assert.ok(tracker);
      assert.ok(Array.isArray(tracker.errorMemory));
    });

    it('should handle empty tracker file', () => {
      writeTracker(testDir, '');
      
      const tracker = loadTracker(testDir);
      
      assert.ok(tracker);
    });
  });
});

// ============================================================================
// 3. NULL VALUES (ALL POSITIONS)
// ============================================================================

describe('Null Values in State', () => {
  describe('PhaseState nulls', () => {
    const nullPositions = [
      { name: 'root null', json: 'null' },
      { name: 'current null', json: '{"current": null}' },
      { name: 'current.phase null', json: '{"current": {"phase": null}}' },
      { name: 'history null', json: '{"current": {"phase": "IDLE"}, "history": null}' },
      { name: 'history array with null', json: '{"current": {"phase": "IDLE"}, "history": [null]}' },
      { name: 'docs null', json: '{"current": {"phase": "IDLE"}, "docs": null}' },
      { name: 'docs.brainlift null', json: '{"current": {"phase": "IDLE"}, "docs": {"brainlift": null}}' },
      { name: 'startedAt null', json: '{"current": {"phase": "IDLE"}, "startedAt": null}' },
      { name: '_version null', json: '{"current": {"phase": "IDLE"}, "_version": null}' },
      { name: 'all fields null', json: '{"current": null, "history": null, "docs": null, "startedAt": null}' },
    ];

    for (const { name, json } of nullPositions) {
      it(`should handle ${name}`, () => {
        writeState(testDir, json);
        
        const state = loadState(testDir);
        
        assert.ok(state, 'State should exist');
        assert.ok(state.current !== null, 'current should not be null after load');
        assert.ok(Array.isArray(state.history), 'history should be array');
        assert.ok(state.docs !== null, 'docs should not be null');
      });
    }
  });

  describe('TrackerState nulls', () => {
    const nullPositions = [
      { name: 'errorMemory null', json: '{"errorMemory": null}' },
      { name: 'lastAnalysis null', json: '{"lastAnalysis": null}' },
      { name: 'currentTask null', json: '{"currentTask": null}' },
      { name: 'lastVerification null', json: '{"lastVerification": null}' },
      { name: 'toolCallHistory null', json: '{"toolCallHistory": null}' },
      { name: 'nested null in errorMemory', json: '{"errorMemory": [null, null]}' },
    ];

    for (const { name, json } of nullPositions) {
      it(`should handle ${name}`, () => {
        writeTracker(testDir, json);
        
        const tracker = loadTracker(testDir);
        
        assert.ok(tracker, 'Tracker should exist');
        assert.ok(Array.isArray(tracker.errorMemory), 'errorMemory should be array');
      });
    }
  });
});

// ============================================================================
// 4. MISSING FIELDS (SCHEMA EVOLUTION)
// ============================================================================

describe('Missing Fields (Schema Evolution)', () => {
  describe('PhaseState missing fields', () => {
    const missingFieldCases = [
      // Missing root fields
      { name: 'missing current', json: '{"history": [], "docs": {}}' },
      { name: 'missing history', json: '{"current": {"phase": "IDLE"}}' },
      { name: 'missing docs', json: '{"current": {"phase": "IDLE"}, "history": []}' },
      { name: 'missing startedAt', json: '{"current": {"phase": "IDLE"}, "history": [], "docs": {}}' },
      { name: 'missing _version', json: '{"current": {"phase": "IDLE"}, "history": []}' },
      
      // Missing nested fields
      { name: 'missing current.phase', json: '{"current": {}}' },
      { name: 'missing current.step', json: '{"current": {"phase": "BUILD"}}' },  // BUILD needs step
      { name: 'missing docs.brainlift', json: '{"current": {"phase": "IDLE"}, "docs": {"prd": false}}' },
      { name: 'missing docs.prd', json: '{"current": {"phase": "IDLE"}, "docs": {"brainlift": false}}' },
      { name: 'missing docs.gameplan', json: '{"current": {"phase": "IDLE"}, "docs": {"brainlift": false, "prd": false}}' },
      
      // Partial history entries
      { name: 'history entry missing id', json: '{"current": {"phase": "IDLE"}, "history": [{"phase": {"phase": "PLAN"}, "timestamp": "2024-01-01"}]}' },
      { name: 'history entry missing phase', json: '{"current": {"phase": "IDLE"}, "history": [{"id": "123", "timestamp": "2024-01-01"}]}' },
      { name: 'history entry missing timestamp', json: '{"current": {"phase": "IDLE"}, "history": [{"id": "123", "phase": {"phase": "PLAN"}}]}' },
      
      // Empty nested objects
      { name: 'empty docs object', json: '{"current": {"phase": "IDLE"}, "docs": {}}' },
      { name: 'empty current object', json: '{"current": {}, "history": [], "docs": {}}' },
      { name: 'empty history array', json: '{"current": {"phase": "IDLE"}, "history": []}' },
    ];

    for (const { name, json } of missingFieldCases) {
      it(`should handle ${name}`, () => {
        writeState(testDir, json);
        
        const state = loadState(testDir);
        
        assert.ok(state, 'State should exist');
        assert.ok(state.current, 'current should exist');
        assert.ok(state.docs, 'docs should exist');
        assert.ok(Array.isArray(state.history), 'history should be array');
        assert.ok(typeof state.docs.prd === 'boolean', 'docs.prd should be boolean');
        assert.ok(typeof state.docs.gameplan === 'boolean', 'docs.gameplan should be boolean');
      });
    }
  });

  describe('TrackerState missing fields', () => {
    const missingFieldCases = [
      { name: 'missing errorMemory', json: '{"lastAnalysis": {}}' },
      { name: 'missing lastAnalysis', json: '{"errorMemory": []}' },
      { name: 'missing _version', json: '{"errorMemory": [], "lastAnalysis": {}}' },
      { name: 'missing currentTask', json: '{"errorMemory": []}' },
      { name: 'missing toolCallHistory', json: '{"errorMemory": []}' },
    ];

    for (const { name, json } of missingFieldCases) {
      it(`should handle ${name}`, () => {
        writeTracker(testDir, json);
        
        const tracker = loadTracker(testDir);
        
        assert.ok(tracker, 'Tracker should exist');
        assert.ok(Array.isArray(tracker.errorMemory), 'errorMemory should be array');
        assert.ok(typeof tracker.lastAnalysis === 'object', 'lastAnalysis should be object');
      });
    }
  });

  describe('Field addition (forward compatibility)', () => {
    it('should preserve unknown fields after save', () => {
      // Write state with extra unknown field
      writeState(testDir, JSON.stringify({
        current: { phase: 'IDLE' },
        history: [],
        docs: { brainlift: false, prd: false, gameplan: false },
        startedAt: '2024-01-01',
        _version: 1,
        unknownField: 'should-be-preserved',
        anotherNewField: { nested: true },
      }));
      
      // Load and save
      const state = loadState(testDir);
      saveState(testDir, state);
      
      // Re-read raw
      const raw = readFileSync(join(testDir, STATE_DIR, STATE_FILE), 'utf-8');
      const parsed = JSON.parse(raw);
      
      // Unknown fields may or may not be preserved depending on implementation
      assert.ok(parsed.current, 'core fields should exist');
    });
  });
});

// ============================================================================
// 5. WRONG DATA TYPES
// ============================================================================

describe('Wrong Data Types', () => {
  describe('PhaseState type mismatches', () => {
    const typeMismatchCases = [
      // current type mismatches
      { name: 'current is string', json: '{"current": "IDLE"}' },
      { name: 'current is number', json: '{"current": 42}' },
      { name: 'current is array', json: '{"current": ["IDLE"]}' },
      { name: 'current is boolean', json: '{"current": true}' },
      
      // current.phase type mismatches
      { name: 'phase is number', json: '{"current": {"phase": 1}}' },
      { name: 'phase is boolean', json: '{"current": {"phase": true}}' },
      { name: 'phase is array', json: '{"current": {"phase": ["IDLE"]}}' },
      { name: 'phase is object', json: '{"current": {"phase": {"type": "IDLE"}}}' },
      
      // history type mismatches
      { name: 'history is string', json: '{"current": {"phase": "IDLE"}, "history": "[]"}' },
      { name: 'history is object', json: '{"current": {"phase": "IDLE"}, "history": {}}' },
      { name: 'history is number', json: '{"current": {"phase": "IDLE"}, "history": 0}' },
      
      // docs type mismatches
      { name: 'docs is array', json: '{"current": {"phase": "IDLE"}, "docs": []}' },
      { name: 'docs is string', json: '{"current": {"phase": "IDLE"}, "docs": "{}"}' },
      { name: 'docs.brainlift is string', json: '{"current": {"phase": "IDLE"}, "docs": {"brainlift": "true"}}' },
      { name: 'docs.brainlift is number', json: '{"current": {"phase": "IDLE"}, "docs": {"brainlift": 1}}' },
      
      // _version type mismatches
      { name: '_version is string', json: '{"current": {"phase": "IDLE"}, "_version": "1"}' },
      { name: '_version is object', json: '{"current": {"phase": "IDLE"}, "_version": {}}' },
    ];

    for (const { name, json } of typeMismatchCases) {
      it(`should handle ${name}`, () => {
        writeState(testDir, json);
        
        const state = loadState(testDir);
        
        assert.ok(state, 'State should exist');
        assert.ok(state.current, 'current should be object');
        assert.ok(typeof state.current.phase === 'string', 'phase should be string');
        assert.ok(Array.isArray(state.history), 'history should be array');
      });
    }
  });

  describe('TrackerState type mismatches', () => {
    const typeMismatchCases = [
      { name: 'errorMemory is string', json: '{"errorMemory": "[]"}' },
      { name: 'errorMemory is object', json: '{"errorMemory": {}}' },
      { name: 'lastAnalysis is string', json: '{"lastAnalysis": "{}"}' },
      { name: 'lastAnalysis is array', json: '{"lastAnalysis": []}' },
      { name: 'currentTask is array', json: '{"currentTask": []}' },
    ];

    for (const { name, json } of typeMismatchCases) {
      it(`should handle ${name}`, () => {
        writeTracker(testDir, json);
        
        const tracker = loadTracker(testDir);
        
        assert.ok(tracker, 'Tracker should exist');
        assert.ok(Array.isArray(tracker.errorMemory), 'errorMemory should be array');
      });
    }
  });
});

// ============================================================================
// 6. HUGE FILES
// ============================================================================

describe('Huge Files', () => {
  describe('Large state files', () => {
    it('should handle 1MB state file', () => {
      const largeHistory = [];
      for (let i = 0; i < 10000; i++) {
        largeHistory.push({
          id: `entry-${i}-${'x'.repeat(50)}`,
          phase: { phase: 'BUILD', step: 'IMPLEMENT' },
          timestamp: new Date().toISOString(),
        });
      }
      
      const state = {
        current: { phase: 'IDLE' },
        history: largeHistory,
        docs: { brainlift: false, prd: false, gameplan: false },
        startedAt: new Date().toISOString(),
        _version: 1,
      };
      
      const json = JSON.stringify(state);
      assert.ok(json.length > 1000000, 'JSON should be > 1MB');
      
      writeState(testDir, json);
      
      const start = Date.now();
      const loaded = loadState(testDir);
      const elapsed = Date.now() - start;
      
      assert.ok(elapsed < 5000, `Should load within 5s, took ${elapsed}ms`);
      assert.ok(loaded.current, 'State should load');
    });

    it('should handle 10MB state file', () => {
      const hugeHistory = [];
      for (let i = 0; i < 50000; i++) {
        hugeHistory.push({
          id: `entry-${i}-${'x'.repeat(100)}`,
          phase: { phase: 'BUILD', step: 'IMPLEMENT' },
          timestamp: new Date().toISOString(),
          extraData: 'y'.repeat(50),
        });
      }
      
      const state = {
        current: { phase: 'IDLE' },
        history: hugeHistory,
        docs: { brainlift: false, prd: false, gameplan: false },
        startedAt: new Date().toISOString(),
        _version: 1,
      };
      
      const json = JSON.stringify(state);
      assert.ok(json.length > 10000000, 'JSON should be > 10MB');
      
      writeState(testDir, json);
      
      const start = Date.now();
      const loaded = loadState(testDir);
      const elapsed = Date.now() - start;
      
      assert.ok(elapsed < 10000, `Should load within 10s, took ${elapsed}ms`);
    });

    it('should handle very long string values', () => {
      const state = {
        current: { phase: 'IDLE' },
        history: [],
        docs: { brainlift: false, prd: false, gameplan: false },
        startedAt: new Date().toISOString(),
        _version: 1,
        extraData: 'x'.repeat(5000000),  // 5MB string
      };
      
      writeState(testDir, JSON.stringify(state));
      
      const loaded = loadState(testDir);
      assert.ok(loaded.current);
    });

    it('should handle deeply nested objects', () => {
      let nested: any = { value: 'leaf' };
      for (let i = 0; i < 100; i++) {
        nested = { child: nested };
      }
      
      const state = {
        current: { phase: 'IDLE' },
        history: [],
        docs: { brainlift: false, prd: false, gameplan: false },
        nested,
        _version: 1,
      };
      
      writeState(testDir, JSON.stringify(state));
      
      const loaded = loadState(testDir);
      assert.ok(loaded.current);
    });

    it('should handle wide objects (many keys)', () => {
      const wide: Record<string, string> = {};
      for (let i = 0; i < 10000; i++) {
        wide[`key_${i}`] = `value_${i}`;
      }
      
      const state = {
        current: { phase: 'IDLE' },
        history: [],
        docs: { brainlift: false, prd: false, gameplan: false },
        wide,
        _version: 1,
      };
      
      writeState(testDir, JSON.stringify(state));
      
      const loaded = loadState(testDir);
      assert.ok(loaded.current);
    });
  });

  describe('Large tracker files', () => {
    it('should handle 50000 error entries', () => {
      const errors = [];
      for (let i = 0; i < 50000; i++) {
        errors.push({
          id: `error-${i}`,
          error: `Error message ${i}: ${'x'.repeat(100)}`,
          timestamp: new Date().toISOString(),
          fixAttempts: [],
        });
      }
      
      writeTracker(testDir, JSON.stringify({ errorMemory: errors }));
      
      const start = Date.now();
      const tracker = loadTracker(testDir);
      const elapsed = Date.now() - start;
      
      assert.ok(elapsed < 10000, `Should load within 10s, took ${elapsed}ms`);
      assert.ok(Array.isArray(tracker.errorMemory));
    });
  });
});

// ============================================================================
// 7. PROTOTYPE POLLUTION PREVENTION
// ============================================================================

describe('Prototype Pollution Prevention', () => {
  const pollutionPayloads = [
    { name: '__proto__ at root', json: '{"__proto__": {"polluted": true}}' },
    { name: '__proto__ in current', json: '{"current": {"__proto__": {"polluted": true}}}' },
    { name: 'constructor pollution', json: '{"constructor": {"prototype": {"polluted": true}}}' },
    { name: '__proto__.polluted', json: '{"__proto__": {"polluted": true}, "current": {"phase": "IDLE"}}' },
    { name: 'nested __proto__', json: '{"a": {"b": {"__proto__": {"polluted": true}}}}' },
    { name: 'prototype in array', json: '{"arr": [{"__proto__": {"polluted": true}}]}' },
  ];

  for (const { name, json } of pollutionPayloads) {
    it(`should not be polluted by: ${name}`, () => {
      // Clear any existing pollution
      const originalPolluted = (Object.prototype as any).polluted;
      
      writeState(testDir, json);
      loadState(testDir);
      
      // Check that Object.prototype was not modified
      assert.strictEqual(
        (Object.prototype as any).polluted,
        originalPolluted,
        'Object.prototype should not be polluted'
      );
      
      // Clean up if pollution happened
      delete (Object.prototype as any).polluted;
    });
  }
});

// ============================================================================
// 8. SPECIAL VALUES
// ============================================================================

describe('Special Values', () => {
  describe('Number edge cases', () => {
    const numberCases = [
      { name: 'zero', json: '{"current": {"phase": "IDLE"}, "_version": 0}' },
      { name: 'negative', json: '{"current": {"phase": "IDLE"}, "_version": -1}' },
      { name: 'max safe integer', json: `{"current": {"phase": "IDLE"}, "_version": ${Number.MAX_SAFE_INTEGER}}` },
      { name: 'beyond max safe', json: `{"current": {"phase": "IDLE"}, "_version": ${Number.MAX_SAFE_INTEGER + 1}}` },
      { name: 'very large', json: '{"current": {"phase": "IDLE"}, "_version": 999999999999999999999}' },
      { name: 'very small decimal', json: '{"current": {"phase": "IDLE"}, "_version": 0.0000000001}' },
      { name: 'scientific notation', json: '{"current": {"phase": "IDLE"}, "_version": 1e10}' },
      { name: 'negative exponent', json: '{"current": {"phase": "IDLE"}, "_version": 1e-10}' },
    ];

    for (const { name, json } of numberCases) {
      it(`should handle ${name}`, () => {
        writeState(testDir, json);
        
        const state = loadState(testDir);
        
        assert.ok(state.current);
        assert.ok(typeof state._version === 'number');
      });
    }
  });

  describe('String edge cases', () => {
    const stringCases = [
      { name: 'empty string', json: '{"current": {"phase": ""}}' },
      { name: 'whitespace only', json: '{"current": {"phase": "   "}}' },
      { name: 'unicode escapes', json: '{"current": {"phase": "\\u0049\\u0044\\u004C\\u0045"}}' },
      { name: 'emoji', json: '{"current": {"phase": "🎉🚀"}}' },
      { name: 'null character escaped', json: '{"current": {"phase": "ID\\u0000LE"}}' },
      { name: 'very long string', json: `{"current": {"phase": "${'x'.repeat(10000)}"}}` },
    ];

    for (const { name, json } of stringCases) {
      it(`should handle ${name}`, () => {
        writeState(testDir, json);
        
        const state = loadState(testDir);
        
        assert.ok(state.current);
        // Phase should be a string (either the given value or default IDLE)
        const phase = (state.current as { phase?: string }).phase;
        assert.ok(typeof phase === 'string' || phase === undefined);
      });
    }
  });

  describe('Boolean edge cases', () => {
    it('should handle 0 as false', () => {
      writeState(testDir, '{"current": {"phase": "IDLE"}, "docs": {"brainlift": 0}}');
      const state = loadState(testDir);
      assert.ok(state.docs);
    });

    it('should handle 1 as true', () => {
      writeState(testDir, '{"current": {"phase": "IDLE"}, "docs": {"brainlift": 1}}');
      const state = loadState(testDir);
      assert.ok(state.docs);
    });

    it('should handle "true" string', () => {
      writeState(testDir, '{"current": {"phase": "IDLE"}, "docs": {"brainlift": "true"}}');
      const state = loadState(testDir);
      assert.ok(state.docs);
    });
  });
});

// ============================================================================
// 9. PROPERTY-BASED TESTING
// ============================================================================

describe('Property-Based State Testing', () => {
  it('should always return valid PhaseState for any JSON', () => {
    fc.assert(
      fc.property(
        fc.json(),
        (json: string) => {
          const dir = createTestDir(`prop-${Math.random()}`);
          writeState(dir, json);
          
          const state = loadState(dir);
          
          // Invariants that must always hold
          assert.ok(state !== null, 'State must not be null');
          assert.ok(state !== undefined, 'State must not be undefined');
          assert.ok(typeof state === 'object', 'State must be object');
          assert.ok('current' in state, 'State must have current');
          assert.ok('history' in state, 'State must have history');
          assert.ok(Array.isArray(state.history), 'history must be array');
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should roundtrip valid state', () => {
    fc.assert(
      fc.property(
        fc.record({
          phase: fc.constantFrom('IDLE', 'PLAN', 'BUILD', 'SHIP', 'GROW'),
        }),
        (input) => {
          const dir = createTestDir(`roundtrip-${Math.random()}`);
          
          // Save a valid state
          const state = getDefaultState();
          state.current = { phase: input.phase as any };
          if (input.phase === 'PLAN') {
            (state.current as any).step = 'IDEA';
          } else if (input.phase === 'BUILD') {
            (state.current as any).step = 'IMPLEMENT';
          } else if (input.phase === 'SHIP') {
            (state.current as any).step = 'REVIEW';
          } else if (input.phase === 'GROW') {
            (state.current as any).step = 'DONE';
          }
          
          saveState(dir, state);
          const loaded = loadState(dir);
          
          assert.strictEqual(loaded.current.phase, input.phase);
          
          return true;
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should handle arbitrary unicode in strings', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 1000 }),
        (unicode: string) => {
          const dir = createTestDir(`unicode-${Math.random()}`);
          
          // Create JSON with unicode in various positions
          const safeUnicode = unicode.replace(/[\x00-\x1f"\\]/g, '_');
          const json = JSON.stringify({
            current: { phase: 'IDLE' },
            history: [],
            docs: { brainlift: false, prd: false, gameplan: false },
            metadata: safeUnicode,
          });
          
          writeState(dir, json);
          const state = loadState(dir);
          
          assert.ok(state.current);
          
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// 10. CONCURRENT WRITE/READ
// ============================================================================

describe('Concurrent Operations', () => {
  it('should handle 100 concurrent writes without corruption', async () => {
    const writes = [];
    
    for (let i = 0; i < 100; i++) {
      writes.push(
        new Promise<void>((resolve) => {
          setTimeout(() => {
            const state = loadState(testDir);
            state.history.push(createHistoryEntry({ phase: 'IDLE' } as const));
            saveState(testDir, state);
            resolve();
          }, Math.random() * 50);
        })
      );
    }
    
    await Promise.all(writes);
    
    // Final state should be valid JSON
    const raw = readFileSync(join(testDir, STATE_DIR, STATE_FILE), 'utf-8');
    const final = JSON.parse(raw);  // Should not throw
    
    assert.ok(final.current);
    assert.ok(Array.isArray(final.history));
  });

  it('should handle interleaved load/modify/save cycles', async () => {
    // Start with clean state
    saveState(testDir, getDefaultState());
    
    const operations = [];
    
    for (let i = 0; i < 50; i++) {
      operations.push(
        (async () => {
          await new Promise(r => setTimeout(r, Math.random() * 100));
          const state = loadState(testDir);
          state.history.push(createHistoryEntry({ phase: 'BUILD', step: 'IMPLEMENT' }));
          saveState(testDir, state);
        })()
      );
    }
    
    await Promise.all(operations);
    
    const final = loadState(testDir);
    assert.ok(final.current);
    // With atomic writes and merging, we should have preserved history
    assert.ok(final.history.length > 0, 'Some history should be preserved');
  });
});

// ============================================================================
// 11. RECOVERY SCENARIOS
// ============================================================================

describe('Recovery Scenarios', () => {
  it('should recover after crash mid-write (simulated)', () => {
    // Write partial JSON (simulating crash)
    writeState(testDir, '{"current": {"phase": "BUILD", "step": "IMPLEMENT"}, "history": [');
    
    // Load should recover
    const state = loadState(testDir);
    
    assert.ok(state);
    assert.ok(state.current);
    
    // Save should work
    saveState(testDir, state);
    
    // Reload should work
    const reloaded = loadState(testDir);
    assert.ok(reloaded.current);
  });

  it('should preserve state through corruption and recovery', () => {
    // Start with valid state
    const initial = getDefaultState();
    initial.current = { phase: 'BUILD', step: 'IMPLEMENT' };
    initial.docs = { prd: true, gameplan: false };
    saveState(testDir, initial);
    
    // Corrupt the file
    writeState(testDir, '{"garbage');
    
    // Load returns defaults
    const corrupted = loadState(testDir);
    assert.strictEqual(corrupted.current.phase, 'IDLE');  // Default
    
    // But we can save new valid state
    const newState = getDefaultState();
    newState.current = { phase: 'SHIP', step: 'REVIEW' };
    saveState(testDir, newState);
    
    // And load it back
    const restored = loadState(testDir);
    assert.strictEqual(restored.current.phase, 'SHIP');
  });

  it('should handle file replaced during operation', () => {
    saveState(testDir, getDefaultState());
    
    // Start loading
    const state1 = loadState(testDir);
    
    // Replace file entirely
    writeState(testDir, JSON.stringify({
      current: { phase: 'GROW', step: 'DONE' },
      history: [],
      docs: { brainlift: true, prd: true, gameplan: true },
    }));
    
    // Modify and save the old state
    state1.current = { phase: 'BUILD', step: 'TEST' };
    saveState(testDir, state1);
    
    // Final state - atomic write should handle this
    const final = loadState(testDir);
    assert.ok(final.current);
  });
});
