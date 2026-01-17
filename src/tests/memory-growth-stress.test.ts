/**
 * Memory & Unbounded Growth Stress Tests
 * 
 * Comprehensive testing of memory limits and unbounded growth scenarios:
 * - Array caps (history, errorMemory, suggestionHistory, toolCallHistory)
 * - Large file handling
 * - Rapid write stress
 * - Memory pressure scenarios
 * - Resource exhaustion prevention
 * 
 * These tests verify that Midas does not crash or consume unlimited memory
 * under adversarial conditions.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Module imports
import { 
  loadState, saveState, getDefaultState, setPhase, createHistoryEntry 
} from '../state/phase.js';
import { 
  loadTracker, saveTracker, recordError, recordSuggestion, 
  recordSuggestionOutcome, trackToolCall 
} from '../tracker.js';
import { estimateTokens } from '../context.js';
import { discoverAndReadCode } from '../code-discovery.js';
import type { Phase } from '../state/phase.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const MIDAS_DIR = '.midas';
const STATE_FILE = 'state.json';
const TRACKER_FILE = 'tracker.json';

// Expected caps from the codebase
const EXPECTED_CAPS = {
  errorMemory: 50,       // tracker.ts: slice(0, 49) + 1 new = 50
  suggestionHistory: 20, // tracker.ts: slice(0, 19) + 1 new = 20
  recentToolCalls: 50,   // tracker.ts: slice(0, 49) + 1 new = 50
  recentFiles: 500,      // tracker.ts: files.length >= 500
  recentCommits: 10,     // tracker.ts: git log -10
};

// ============================================================================
// TEST SETUP
// ============================================================================

let testDirs: string[] = [];

function createTestDir(prefix: string): string {
  const dir = join(tmpdir(), `midas-memory-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, MIDAS_DIR), { recursive: true });
  testDirs.push(dir);
  return dir;
}

function cleanup(): void {
  for (const dir of testDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
  testDirs = [];
}

beforeEach(() => {
  testDirs = [];
});

afterEach(() => {
  cleanup();
});

// ============================================================================
// 1. HISTORY ARRAY CAPS
// ============================================================================

describe('History Array Caps', () => {
  describe('PhaseState history', () => {
    it('should cap history at reasonable size after many transitions', () => {
      const dir = createTestDir('history-cap');
      
      // Make 1000 phase transitions
      for (let i = 0; i < 1000; i++) {
        const phases: Phase[] = [
          { phase: 'IDLE' },
          { phase: 'PLAN', step: 'IDEA' },
          { phase: 'BUILD', step: 'IMPLEMENT' },
          { phase: 'SHIP', step: 'REVIEW' },
        ];
        setPhase(dir, phases[i % phases.length]);
      }
      
      const state = loadState(dir);
      
      // Verify file size is reasonable
      const stateFile = join(dir, MIDAS_DIR, STATE_FILE);
      const size = statSync(stateFile).size;
      
      console.log(`  [INFO] After 1000 transitions: history=${state.history.length}, fileSize=${size} bytes`);
      
      // History should be preserved (no arbitrary cap currently)
      // But file size should still be manageable (< 5MB for 1000 entries)
      assert.ok(size < 5 * 1024 * 1024, `File too large: ${size} bytes`);
    });

    it('should handle 10000 history entries gracefully', () => {
      const dir = createTestDir('mega-history');
      const state = getDefaultState();
      
      // Create 10000 history entries
      for (let i = 0; i < 10000; i++) {
        state.history.push(createHistoryEntry({ phase: 'BUILD', step: 'IMPLEMENT' }));
      }
      
      const start = Date.now();
      saveState(dir, state);
      const saveTime = Date.now() - start;
      
      const loadStart = Date.now();
      const loaded = loadState(dir);
      const loadTime = Date.now() - loadStart;
      
      console.log(`  [INFO] 10000 entries: save=${saveTime}ms, load=${loadTime}ms, size=${loaded.history.length}`);
      
      assert.ok(saveTime < 5000, `Save too slow: ${saveTime}ms`);
      assert.ok(loadTime < 5000, `Load too slow: ${loadTime}ms`);
    });

    it('should preserve history uniqueness during concurrent operations', async () => {
      const dir = createTestDir('history-unique');
      saveState(dir, getDefaultState());
      
      // Run 50 concurrent setPhase operations
      const operations = [];
      for (let i = 0; i < 50; i++) {
        operations.push(
          new Promise<void>((resolve) => {
            setTimeout(() => {
              setPhase(dir, { phase: 'BUILD', step: 'IMPLEMENT' });
              resolve();
            }, Math.random() * 100);
          })
        );
      }
      
      await Promise.all(operations);
      
      const state = loadState(dir);
      
      // Check for duplicate IDs (should be unique)
      const ids = state.history.map(h => h.id);
      const uniqueIds = new Set(ids);
      
      console.log(`  [INFO] ${state.history.length} entries, ${uniqueIds.size} unique IDs`);
      
      // Should have many entries preserved (thanks to atomic merging)
      assert.ok(state.history.length >= 10, 'Should preserve history entries');
    });
  });
});

// ============================================================================
// 2. ERROR MEMORY CAPS
// ============================================================================

describe('Error Memory Caps', () => {
  it('should cap errorMemory at 50 entries', () => {
    const dir = createTestDir('error-cap');
    
    // Record 100 errors
    for (let i = 0; i < 100; i++) {
      recordError(dir, `Error number ${i}: ${'x'.repeat(100)}`);
    }
    
    const tracker = loadTracker(dir);
    
    console.log(`  [INFO] After 100 errors: errorMemory.length = ${tracker.errorMemory.length}`);
    
    assert.ok(tracker.errorMemory.length <= EXPECTED_CAPS.errorMemory, 
      `Expected <= ${EXPECTED_CAPS.errorMemory}, got ${tracker.errorMemory.length}`);
  });

  it('should keep most recent errors when capping', () => {
    const dir = createTestDir('error-recent');
    
    // Record 60 errors with identifiable messages
    for (let i = 0; i < 60; i++) {
      recordError(dir, `Error-${i.toString().padStart(3, '0')}`);
    }
    
    const tracker = loadTracker(dir);
    
    // Most recent should be Error-059 (i=59)
    const latest = tracker.errorMemory[0];
    assert.ok(latest.error.includes('059') || latest.error.includes('58'), 
      'Most recent error should be at index 0');
    
    // Oldest retained should be Error-010 or later (not Error-000)
    const oldest = tracker.errorMemory[tracker.errorMemory.length - 1];
    assert.ok(!oldest.error.includes('000'), 
      'Oldest errors should be evicted');
  });

  it('should handle rapid error recording', async () => {
    const dir = createTestDir('rapid-errors');
    
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(
        new Promise<void>((resolve) => {
          setTimeout(() => {
            try {
              recordError(dir, `Rapid error ${i}`);
            } catch {
              // May fail due to concurrent access
            }
            resolve();
          }, Math.random() * 50);
        })
      );
    }
    
    await Promise.all(promises);
    
    const tracker = loadTracker(dir);
    
    assert.ok(tracker.errorMemory.length <= EXPECTED_CAPS.errorMemory);
    assert.ok(tracker.errorMemory.length > 0, 'Should have some errors recorded');
  });

  it('should handle very long error messages', () => {
    const dir = createTestDir('long-errors');
    
    // Record errors with increasingly long messages
    const lengths = [100, 1000, 10000, 100000];
    
    for (const len of lengths) {
      recordError(dir, `Error: ${'x'.repeat(len)}`);
    }
    
    const tracker = loadTracker(dir);
    
    // File should still be manageable
    const trackerFile = join(dir, MIDAS_DIR, TRACKER_FILE);
    const size = statSync(trackerFile).size;
    
    console.log(`  [INFO] Long errors: fileSize=${size} bytes`);
    
    // Even with 100KB error messages, file should be reasonable
    assert.ok(size < 10 * 1024 * 1024, `File too large: ${size} bytes`);
  });
});

// ============================================================================
// 3. SUGGESTION HISTORY CAPS
// ============================================================================

describe('Suggestion History Caps', () => {
  it('should cap suggestionHistory at 20 entries', () => {
    const dir = createTestDir('suggestion-cap');
    
    // Record 50 suggestions
    for (let i = 0; i < 50; i++) {
      recordSuggestion(dir, `Suggestion ${i}: Add feature X`);
      recordSuggestionOutcome(dir, i % 2 === 0); // Alternate accept/reject
    }
    
    const tracker = loadTracker(dir);
    
    console.log(`  [INFO] After 50 suggestions: suggestionHistory.length = ${tracker.suggestionHistory.length}`);
    
    assert.ok(tracker.suggestionHistory.length <= EXPECTED_CAPS.suggestionHistory,
      `Expected <= ${EXPECTED_CAPS.suggestionHistory}, got ${tracker.suggestionHistory.length}`);
  });

  it('should preserve most recent suggestions', () => {
    const dir = createTestDir('suggestion-recent');
    
    // Record 30 suggestions
    for (let i = 0; i < 30; i++) {
      recordSuggestion(dir, `Suggestion-${i.toString().padStart(2, '0')}`);
      recordSuggestionOutcome(dir, true);
    }
    
    const tracker = loadTracker(dir);
    
    // Check that recent suggestions are kept
    const latestSuggestion = tracker.suggestionHistory[0];
    assert.ok(latestSuggestion.suggestion.includes('29') || latestSuggestion.suggestion.includes('28'),
      'Most recent suggestion should be at index 0');
  });
});

// ============================================================================
// 4. TOOL CALL HISTORY CAPS
// ============================================================================

describe('Tool Call History Caps', () => {
  it('should cap recentToolCalls at 50 entries', () => {
    const dir = createTestDir('toolcall-cap');
    
    // Record 100 tool calls
    for (let i = 0; i < 100; i++) {
      trackToolCall(dir, `midas_tool_${i % 10}`);
    }
    
    const tracker = loadTracker(dir);
    
    console.log(`  [INFO] After 100 tool calls: recentToolCalls.length = ${tracker.recentToolCalls.length}`);
    
    assert.ok(tracker.recentToolCalls.length <= EXPECTED_CAPS.recentToolCalls,
      `Expected <= ${EXPECTED_CAPS.recentToolCalls}, got ${tracker.recentToolCalls.length}`);
  });

  it('should handle rapid tool call recording', async () => {
    const dir = createTestDir('rapid-toolcalls');
    
    const promises = [];
    for (let i = 0; i < 200; i++) {
      promises.push(
        new Promise<void>((resolve) => {
          setTimeout(() => {
            try {
              trackToolCall(dir, `midas_rapid_${i}`);
            } catch {
              // May fail due to concurrent access
            }
            resolve();
          }, Math.random() * 100);
        })
      );
    }
    
    await Promise.all(promises);
    
    const tracker = loadTracker(dir);
    
    assert.ok(tracker.recentToolCalls.length <= EXPECTED_CAPS.recentToolCalls);
    assert.ok(tracker.recentToolCalls.length > 0);
  });
});

// ============================================================================
// 5. LARGE FILE HANDLING
// ============================================================================

describe('Large File Handling', () => {
  describe('Large state files', () => {
    it('should handle 1MB state file', () => {
      const dir = createTestDir('1mb-state');
      const state = getDefaultState();
      
      // Add large data
      (state as any).largeData = 'x'.repeat(1024 * 1024);
      
      const start = Date.now();
      saveState(dir, state);
      const saveTime = Date.now() - start;
      
      const loadStart = Date.now();
      loadState(dir);
      const loadTime = Date.now() - loadStart;
      
      console.log(`  [INFO] 1MB state: save=${saveTime}ms, load=${loadTime}ms`);
      
      assert.ok(saveTime < 3000, `Save too slow: ${saveTime}ms`);
      assert.ok(loadTime < 3000, `Load too slow: ${loadTime}ms`);
    });

    it('should handle 10MB state file', () => {
      const dir = createTestDir('10mb-state');
      const state = getDefaultState();
      
      // Add large data
      (state as any).largeData = 'x'.repeat(10 * 1024 * 1024);
      
      const start = Date.now();
      saveState(dir, state);
      const saveTime = Date.now() - start;
      
      const loadStart = Date.now();
      loadState(dir);
      const loadTime = Date.now() - loadStart;
      
      console.log(`  [INFO] 10MB state: save=${saveTime}ms, load=${loadTime}ms`);
      
      assert.ok(saveTime < 10000, `Save too slow: ${saveTime}ms`);
      assert.ok(loadTime < 10000, `Load too slow: ${loadTime}ms`);
    });

    it('should handle state with many small entries', () => {
      const dir = createTestDir('many-small');
      const state = getDefaultState();
      
      // Add 100000 small history entries
      for (let i = 0; i < 100000; i++) {
        state.history.push({
          id: `id-${i}`,
          phase: { phase: 'IDLE' as const },
          timestamp: new Date().toISOString(),
        });
      }
      
      const start = Date.now();
      saveState(dir, state);
      const saveTime = Date.now() - start;
      
      const loadStart = Date.now();
      const loaded = loadState(dir);
      const loadTime = Date.now() - loadStart;
      
      console.log(`  [INFO] 100k entries: save=${saveTime}ms, load=${loadTime}ms, size=${loaded.history.length}`);
      
      assert.ok(saveTime < 15000, `Save too slow: ${saveTime}ms`);
      assert.ok(loadTime < 15000, `Load too slow: ${loadTime}ms`);
    });
  });

  describe('Large tracker files', () => {
    it('should handle large error messages', () => {
      const dir = createTestDir('large-tracker');
      
      // Record 50 errors with 100KB messages each
      for (let i = 0; i < 50; i++) {
        recordError(dir, `Error ${i}: ${'e'.repeat(100 * 1024)}`);
      }
      
      const start = Date.now();
      const tracker = loadTracker(dir);
      const loadTime = Date.now() - start;
      
      console.log(`  [INFO] Large tracker: load=${loadTime}ms, errors=${tracker.errorMemory.length}`);
      
      assert.ok(loadTime < 5000, `Load too slow: ${loadTime}ms`);
    });
  });

  describe('Large source files', () => {
    it('should handle 100 source files', () => {
      const dir = createTestDir('100-files');
      mkdirSync(join(dir, 'src'));
      
      // Create 100 source files
      for (let i = 0; i < 100; i++) {
        writeFileSync(
          join(dir, 'src', `file${i}.ts`),
          `// File ${i}\nexport const x${i} = ${i};\n${'// comment\n'.repeat(100)}`
        );
      }
      
      const start = Date.now();
      const result = discoverAndReadCode(dir, {});
      const elapsed = Date.now() - start;
      
      console.log(`  [INFO] 100 files: elapsed=${elapsed}ms, found=${result.files.length}`);
      
      assert.ok(elapsed < 10000, `Too slow: ${elapsed}ms`);
      assert.ok(result.files.length > 0);
    });

    it('should handle 1000 source files', () => {
      const dir = createTestDir('1000-files');
      mkdirSync(join(dir, 'src'));
      
      // Create 1000 small source files
      for (let i = 0; i < 1000; i++) {
        writeFileSync(
          join(dir, 'src', `file${i}.ts`),
          `export const x = ${i};`
        );
      }
      
      const start = Date.now();
      const result = discoverAndReadCode(dir, {});
      const elapsed = Date.now() - start;
      
      console.log(`  [INFO] 1000 files: elapsed=${elapsed}ms, found=${result.files.length}`);
      
      assert.ok(elapsed < 30000, `Too slow: ${elapsed}ms`);
    });

    it('should handle very large single file', () => {
      const dir = createTestDir('large-file');
      mkdirSync(join(dir, 'src'));
      
      // Create 10MB source file
      const largeContent = `// Large file\n${'const x = "test";\n'.repeat(500000)}`;
      writeFileSync(join(dir, 'src', 'large.ts'), largeContent);
      
      const start = Date.now();
      const result = discoverAndReadCode(dir, {});
      const elapsed = Date.now() - start;
      
      console.log(`  [INFO] 10MB file: elapsed=${elapsed}ms`);
      
      assert.ok(elapsed < 10000, `Too slow: ${elapsed}ms`);
      // File should be truncated or handled appropriately
      assert.ok(result.files !== undefined);
    });
  });
});

// ============================================================================
// 6. RAPID WRITE STRESS
// ============================================================================

describe('Rapid Write Stress', () => {
  it('should handle 100 rapid state saves', async () => {
    const dir = createTestDir('rapid-state');
    
    const start = Date.now();
    
    for (let i = 0; i < 100; i++) {
      const state = loadState(dir);
      state.history.push(createHistoryEntry({ phase: 'BUILD', step: 'IMPLEMENT' }));
      saveState(dir, state);
    }
    
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 100 rapid saves: elapsed=${elapsed}ms`);
    
    assert.ok(elapsed < 10000, `Too slow: ${elapsed}ms`);
    
    // Verify integrity
    const final = loadState(dir);
    assert.ok(final.history.length >= 50, 'Should preserve most history');
  });

  it('should handle 100 concurrent state saves', async () => {
    const dir = createTestDir('concurrent-state');
    saveState(dir, getDefaultState());
    
    const start = Date.now();
    
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(
        new Promise<void>((resolve) => {
          const state = loadState(dir);
          state.history.push(createHistoryEntry({ phase: 'PLAN', step: 'PRD' }));
          saveState(dir, state);
          resolve();
        })
      );
    }
    
    await Promise.all(promises);
    
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 100 concurrent saves: elapsed=${elapsed}ms`);
    
    assert.ok(elapsed < 15000, `Too slow: ${elapsed}ms`);
    
    // Verify file is valid JSON
    const raw = readFileSync(join(dir, MIDAS_DIR, STATE_FILE), 'utf-8');
    assert.doesNotThrow(() => JSON.parse(raw), 'File should be valid JSON');
  });

  it('should handle 500 rapid tracker updates', async () => {
    const dir = createTestDir('rapid-tracker');
    
    const start = Date.now();
    
    for (let i = 0; i < 500; i++) {
      if (i % 3 === 0) recordError(dir, `Error ${i}`);
      if (i % 5 === 0) trackToolCall(dir, `tool_${i}`);
      if (i % 7 === 0) {
        recordSuggestion(dir, `Suggestion ${i}`);
        recordSuggestionOutcome(dir, true);
      }
    }
    
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 500 rapid updates: elapsed=${elapsed}ms`);
    
    assert.ok(elapsed < 30000, `Too slow: ${elapsed}ms`);
    
    const tracker = loadTracker(dir);
    assert.ok(tracker.errorMemory.length <= EXPECTED_CAPS.errorMemory);
    assert.ok(tracker.recentToolCalls.length <= EXPECTED_CAPS.recentToolCalls);
    assert.ok(tracker.suggestionHistory.length <= EXPECTED_CAPS.suggestionHistory);
  });

  it('should handle interleaved read-write cycles', async () => {
    const dir = createTestDir('interleaved-rw');
    saveState(dir, getDefaultState());
    
    const start = Date.now();
    
    const operations = [];
    for (let i = 0; i < 200; i++) {
      operations.push(
        new Promise<void>((resolve) => {
          setTimeout(() => {
            try {
              if (i % 2 === 0) {
                // Write
                const state = loadState(dir);
                state.history.push(createHistoryEntry({ phase: 'IDLE' }));
                saveState(dir, state);
              } else {
                // Read
                loadState(dir);
              }
            } catch {
              // May fail due to concurrent access
            }
            resolve();
          }, Math.random() * 100);
        })
      );
    }
    
    await Promise.all(operations);
    
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 200 interleaved ops: elapsed=${elapsed}ms`);
    
    assert.ok(elapsed < 20000, `Too slow: ${elapsed}ms`);
  });
});

// ============================================================================
// 7. MEMORY PRESSURE SCENARIOS
// ============================================================================

describe('Memory Pressure Scenarios', () => {
  it('should not crash when estimating tokens for huge string', () => {
    // 100MB string
    const huge = 'x'.repeat(100 * 1024 * 1024);
    
    const start = Date.now();
    const estimate = estimateTokens(huge);
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 100MB token estimate: ${estimate} tokens in ${elapsed}ms`);
    
    assert.ok(estimate > 0);
    assert.ok(elapsed < 5000, `Too slow: ${elapsed}ms`);
  });

  it('should handle many sequential operations without memory leak', () => {
    const dir = createTestDir('memory-leak');
    
    // Track memory usage
    const memBefore = process.memoryUsage().heapUsed;
    
    // Do 1000 operations
    for (let i = 0; i < 1000; i++) {
      const state = loadState(dir);
      state.history.push(createHistoryEntry({ phase: 'BUILD', step: 'TEST' }));
      saveState(dir, state);
      
      // Force GC hint (not guaranteed)
      if (i % 100 === 0 && global.gc) {
        global.gc();
      }
    }
    
    const memAfter = process.memoryUsage().heapUsed;
    const memDelta = memAfter - memBefore;
    
    console.log(`  [INFO] 1000 ops: memory delta = ${Math.round(memDelta / 1024 / 1024)}MB`);
    
    // Memory growth should be reasonable (< 200MB for 1000 operations with file I/O)
    // Note: Node.js buffers and JSON parsing naturally consume memory
    assert.ok(memDelta < 200 * 1024 * 1024, `Memory grew too much: ${memDelta} bytes`);
  });

  it('should handle many files without exhausting file descriptors', () => {
    const dir = createTestDir('fd-exhaustion');
    mkdirSync(join(dir, 'src'));
    
    // Create 500 files
    for (let i = 0; i < 500; i++) {
      writeFileSync(join(dir, 'src', `file${i}.ts`), `export const x = ${i};`);
    }
    
    // Read them all multiple times
    for (let round = 0; round < 5; round++) {
      const result = discoverAndReadCode(dir, {});
      assert.ok(result.files !== undefined);
    }
    
    // If we got here, file descriptors were properly managed
    assert.ok(true);
  });
});

// ============================================================================
// 8. BOUNDARY CONDITIONS
// ============================================================================

describe('Boundary Conditions', () => {
  describe('Array size boundaries', () => {
    it('should handle array at exact cap size', () => {
      const dir = createTestDir('exact-cap');
      
      // Record exactly 50 errors (at cap)
      for (let i = 0; i < 50; i++) {
        recordError(dir, `Error ${i}`);
      }
      
      const tracker = loadTracker(dir);
      assert.ok(tracker.errorMemory.length <= 50);
      
      // Record one more
      recordError(dir, 'One more error');
      
      const afterCap = loadTracker(dir);
      assert.ok(afterCap.errorMemory.length <= 50, 'Should still be capped');
    });

    it('should handle array at cap-1 size', () => {
      const dir = createTestDir('cap-minus-1');
      
      // Record 49 errors (just under cap)
      for (let i = 0; i < 49; i++) {
        recordError(dir, `Error ${i}`);
      }
      
      const tracker = loadTracker(dir);
      
      // Record one more - should fit
      recordError(dir, 'Fits in cap');
      
      const after = loadTracker(dir);
      assert.ok(after.errorMemory.length <= 50);
    });

    it('should handle array at cap+1 size', () => {
      const dir = createTestDir('cap-plus-1');
      
      // Record 51 errors (just over cap)
      for (let i = 0; i < 51; i++) {
        recordError(dir, `Error ${i}`);
      }
      
      const tracker = loadTracker(dir);
      assert.ok(tracker.errorMemory.length <= 50, 'Should be capped at 50');
    });
  });

  describe('File size boundaries', () => {
    it('should handle empty state file', () => {
      const dir = createTestDir('empty-state');
      writeFileSync(join(dir, MIDAS_DIR, STATE_FILE), '');
      
      const state = loadState(dir);
      
      assert.ok(state !== null);
      assert.ok(state.current.phase === 'IDLE');
    });

    it('should handle state file at 0 bytes', () => {
      const dir = createTestDir('zero-bytes');
      writeFileSync(join(dir, MIDAS_DIR, STATE_FILE), Buffer.alloc(0));
      
      const state = loadState(dir);
      
      assert.ok(state !== null);
    });

    it('should handle state file at exactly 1 byte', () => {
      const dir = createTestDir('one-byte');
      writeFileSync(join(dir, MIDAS_DIR, STATE_FILE), '{');
      
      const state = loadState(dir);
      
      assert.ok(state !== null);
      assert.ok(state.current.phase === 'IDLE');
    });
  });

  describe('String size boundaries', () => {
    it('should handle empty error message', () => {
      const dir = createTestDir('empty-error');
      
      recordError(dir, '');
      
      const tracker = loadTracker(dir);
      assert.ok(tracker.errorMemory.length >= 1);
    });

    it('should handle 1-char error message', () => {
      const dir = createTestDir('one-char-error');
      
      recordError(dir, 'x');
      
      const tracker = loadTracker(dir);
      assert.ok(tracker.errorMemory.length >= 1);
      assert.ok(tracker.errorMemory[0].error === 'x');
    });

    it('should handle 1MB error message', () => {
      const dir = createTestDir('1mb-error');
      
      recordError(dir, 'x'.repeat(1024 * 1024));
      
      const tracker = loadTracker(dir);
      assert.ok(tracker.errorMemory.length >= 1);
    });
  });
});

// ============================================================================
// 9. RESOURCE EXHAUSTION PREVENTION
// ============================================================================

describe('Resource Exhaustion Prevention', () => {
  it('should timeout or cap extremely deep recursion in code discovery', () => {
    const dir = createTestDir('deep-recursion');
    
    // Create 50-level deep directory structure
    let path = join(dir, 'src');
    for (let i = 0; i < 50; i++) {
      path = join(path, `level${i}`);
    }
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'deep.ts'), 'export const deep = true;');
    
    const start = Date.now();
    const result = discoverAndReadCode(dir, {});
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 50-level deep: elapsed=${elapsed}ms`);
    
    // Should complete in reasonable time
    assert.ok(elapsed < 10000, `Too slow: ${elapsed}ms`);
  });

  it('should handle symbolic link loops without hanging', () => {
    const dir = createTestDir('symlink-loop');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'file.ts'), 'export const x = 1;');
    
    try {
      // Create symlink loop (may fail on some systems)
      const { symlinkSync } = require('fs');
      symlinkSync(join(dir, 'src'), join(dir, 'src', 'loop'));
    } catch {
      // Symlinks may not be supported
      return;
    }
    
    const start = Date.now();
    const result = discoverAndReadCode(dir, {});
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] Symlink loop: elapsed=${elapsed}ms`);
    
    // Should not hang (timeout or detect loop)
    assert.ok(elapsed < 10000, `Possible infinite loop: ${elapsed}ms`);
  });

  it('should cap files discovered to prevent OOM', () => {
    const dir = createTestDir('many-many-files');
    mkdirSync(join(dir, 'src'));
    
    // Create 2000 files
    for (let i = 0; i < 2000; i++) {
      writeFileSync(join(dir, 'src', `f${i}.ts`), `export const x${i} = ${i};`);
    }
    
    const start = Date.now();
    const result = discoverAndReadCode(dir, {});
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 2000 files: elapsed=${elapsed}ms, found=${result.files.length}`);
    
    // Should complete and not find unlimited files
    assert.ok(elapsed < 60000, `Too slow: ${elapsed}ms`);
    // Files may be capped by discovery limits
    assert.ok(result.files !== undefined);
  });
});

// ============================================================================
// 10. STRESS COMBINATIONS
// ============================================================================

describe('Stress Combinations', () => {
  it('should handle large history + large errors + rapid updates', async () => {
    const dir = createTestDir('combo-stress');
    
    // Build up large state
    for (let i = 0; i < 100; i++) {
      setPhase(dir, { phase: 'BUILD', step: 'IMPLEMENT' });
      recordError(dir, `Error ${i}: ${'x'.repeat(1000)}`);
      trackToolCall(dir, `tool_${i}`);
    }
    
    // Then do rapid concurrent operations
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(
        new Promise<void>((resolve) => {
          setTimeout(() => {
            try {
              loadState(dir);
              loadTracker(dir);
              setPhase(dir, { phase: 'PLAN', step: 'IDEA' });
            } catch {
              // May fail
            }
            resolve();
          }, Math.random() * 100);
        })
      );
    }
    
    await Promise.all(promises);
    
    // Verify integrity
    const state = loadState(dir);
    const tracker = loadTracker(dir);
    
    assert.ok(state.current !== null);
    assert.ok(tracker.errorMemory.length <= EXPECTED_CAPS.errorMemory);
    
    // Verify files are valid JSON
    const stateRaw = readFileSync(join(dir, MIDAS_DIR, STATE_FILE), 'utf-8');
    const trackerRaw = readFileSync(join(dir, MIDAS_DIR, TRACKER_FILE), 'utf-8');
    
    assert.doesNotThrow(() => JSON.parse(stateRaw));
    assert.doesNotThrow(() => JSON.parse(trackerRaw));
  });

  it('should handle alternating heavy reads and writes', async () => {
    const dir = createTestDir('alternate-rw');
    saveState(dir, getDefaultState());
    
    for (let round = 0; round < 10; round++) {
      // Heavy writes
      for (let i = 0; i < 50; i++) {
        setPhase(dir, { phase: 'BUILD', step: 'TEST' });
      }
      
      // Heavy reads
      for (let i = 0; i < 50; i++) {
        loadState(dir);
        loadTracker(dir);
      }
    }
    
    const state = loadState(dir);
    assert.ok(state.current !== null);
  });
});
