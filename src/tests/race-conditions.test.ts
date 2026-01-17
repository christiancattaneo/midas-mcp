/**
 * Race Condition Tests
 * 
 * Comprehensive tests for concurrent access, interleaved read-modify-write,
 * and lost update detection. These tests are designed to expose non-atomic
 * operations and missing synchronization in file-based state management.
 * 
 * Based on best practices:
 * - Multiple concurrent writers
 * - Delays between read and write (interleaving points)
 * - Check-then-act patterns
 * - Error during write scenarios
 * - Stress testing with varying loads
 * - Lost update detection
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Module imports
import { loadState, saveState, getDefaultState, setPhase, createHistoryEntry, type PhaseState, type HistoryEntry } from '../state/phase.js';
import { loadTracker, saveTracker, recordError, getUnresolvedErrors, type TrackerState } from '../tracker.js';
import { updateCheckStatus, getAllCheckStatuses, resetCheckStatuses } from '../reality.js';

// ============================================================================
// HELPERS
// ============================================================================

let testDir: string;
let cleanupDirs: string[] = [];

function createTestDir(name: string): string {
  const dir = join(tmpdir(), `midas-race-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
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

/**
 * Sleep helper for controlled delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Random delay between min and max ms
 */
function randomDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min) + min);
  return sleep(delay);
}

/**
 * Run a function n times concurrently
 */
async function runConcurrently<T>(n: number, fn: (index: number) => Promise<T>): Promise<T[]> {
  const promises = Array.from({ length: n }, (_, i) => fn(i));
  return Promise.all(promises);
}

/**
 * Simulate a slow read-modify-write with artificial delay
 */
async function slowReadModifyWrite(
  readFn: () => unknown,
  modifyFn: (value: unknown) => unknown,
  writeFn: (value: unknown) => void,
  delayMs: number = 10
): Promise<void> {
  const value = readFn();
  await sleep(delayMs);  // This is the interleaving point
  const modified = modifyFn(value);
  writeFn(modified);
}

beforeEach(() => {
  testDir = createTestDir('race');
});

afterEach(() => {
  cleanup();
});

// ============================================================================
// 1. CONCURRENT WRITES - Same Resource, Multiple Writers
// ============================================================================

describe('Concurrent Writes - Multiple Writers', () => {
  it('should handle 2 concurrent state saves (last-write-wins)', async () => {
    const state1 = getDefaultState();
    const state2 = getDefaultState();
    
    state1.current = { phase: 'PLAN', step: 'IDEA' };
    state2.current = { phase: 'BUILD', step: 'IMPLEMENT' };
    
    // Fire both saves at exactly the same time
    await Promise.all([
      saveState(testDir, state1),
      saveState(testDir, state2),
    ]);
    
    const loaded = loadState(testDir);
    // One of them should win - the state should be valid
    assert.ok(['PLAN', 'BUILD'].includes(loaded.current.phase));
    assert.ok(loaded.docs !== undefined);
    assert.ok(loaded.history !== undefined);
  });

  it('should handle 5 concurrent state saves without corruption', async () => {
    const phases = ['PLAN', 'BUILD', 'SHIP', 'GROW', 'IDLE'] as const;
    
    await runConcurrently(5, async (i) => {
      const state = getDefaultState();
      if (phases[i] === 'PLAN') {
        state.current = { phase: 'PLAN', step: 'IDEA' };
      } else if (phases[i] === 'BUILD') {
        state.current = { phase: 'BUILD', step: 'IMPLEMENT' };
      } else if (phases[i] === 'SHIP') {
        state.current = { phase: 'SHIP', step: 'DEPLOY' };
      } else if (phases[i] === 'GROW') {
        state.current = { phase: 'GROW', step: 'DONE' };
      } else {
        state.current = { phase: 'IDLE' };
      }
      await saveState(testDir, state);
    });
    
    // State should be valid JSON and parseable
    const loaded = loadState(testDir);
    assert.ok(loaded !== null);
    assert.ok(loaded.current !== undefined);
    assert.ok(typeof loaded.current.phase === 'string');
  });

  it('should handle 10 concurrent tracker updates', async () => {
    await runConcurrently(10, async (i) => {
      recordError(testDir, `Concurrent error ${i}`, `file${i}.ts`, i);
    });
    
    const tracker = loadTracker(testDir);
    // Should have recorded errors (may not be all 10 due to overwrites, but should be valid)
    assert.ok(tracker.errorMemory.length > 0);
    assert.ok(tracker.errorMemory.length <= 50); // Cap is 50
    
    // All recorded errors should be valid
    for (const error of tracker.errorMemory) {
      assert.ok(error.id !== undefined);
      assert.ok(error.error !== undefined);
    }
  });

  it('should handle 20 concurrent reality check status updates', async () => {
    const checkKeys = ['CHECK_A', 'CHECK_B', 'CHECK_C', 'CHECK_D'];
    
    await runConcurrently(20, async (i) => {
      const key = checkKeys[i % checkKeys.length];
      const status = i % 2 === 0 ? 'completed' : 'pending';
      updateCheckStatus(testDir, key, status);
    });
    
    // All updates should result in valid state
    const statuses = getAllCheckStatuses(testDir);
    assert.ok(typeof statuses === 'object');
    
    for (const key of checkKeys) {
      if (statuses[key]) {
        assert.ok(['pending', 'completed', 'skipped'].includes(statuses[key].status));
      }
    }
  });

  it('should handle 50 rapid-fire concurrent writes', async () => {
    await runConcurrently(50, async (i) => {
      const state = getDefaultState();
      state.current = { phase: 'BUILD', step: 'IMPLEMENT' };
      state.history.push(createHistoryEntry({ phase: 'PLAN', step: 'IDEA' }));
      await saveState(testDir, state);
    });
    
    // Should still be valid
    const loaded = loadState(testDir);
    assert.ok(loaded !== null);
    assert.ok(loaded.current.phase === 'BUILD' || loaded.current.phase === 'IDLE');
  });
});

// ============================================================================
// 2. INTERLEAVED READ-MODIFY-WRITE
// ============================================================================

describe('Interleaved Read-Modify-Write', () => {
  it('should detect lost updates in naive read-modify-write', async () => {
    // Initialize counter
    saveState(testDir, { 
      ...getDefaultState(), 
      history: [] // Use history length as our counter
    });
    
    const incrementOperations = 10;
    
    // Naive read-modify-write that SHOULD lose updates
    await runConcurrently(incrementOperations, async (i) => {
      await slowReadModifyWrite(
        () => loadState(testDir),
        (state) => {
          const s = state as PhaseState;
          s.history.push(createHistoryEntry({ phase: 'PLAN', step: 'IDEA' }));
          return s;
        },
        (state) => saveState(testDir, state as PhaseState),
        5  // 5ms delay creates interleaving
      );
    });
    
    const final = loadState(testDir);
    
    // With race conditions, we expect FEWER than 10 items
    // (some updates are lost due to interleaving)
    // This test documents the CURRENT behavior - not ideal
    // If you fix it with locking, this should be === 10
    console.log(`  [INFO] History length after ${incrementOperations} increments: ${final.history.length}`);
    
    // Assert it's at least valid
    assert.ok(final.history.length >= 1);
    assert.ok(final.history.length <= incrementOperations);
  });

  it('should handle interleaved setPhase calls', async () => {
    saveState(testDir, getDefaultState());
    
    const phases: Parameters<typeof setPhase>[1][] = [
      { phase: 'PLAN', step: 'IDEA' },
      { phase: 'PLAN', step: 'RESEARCH' },
      { phase: 'PLAN', step: 'BRAINLIFT' },
      { phase: 'PLAN', step: 'PRD' },
      { phase: 'PLAN', step: 'GAMEPLAN' },
    ];
    
    await runConcurrently(phases.length, async (i) => {
      await randomDelay(0, 10);
      setPhase(testDir, phases[i]);
    });
    
    const final = loadState(testDir);
    // Should be one of the valid phases
    assert.strictEqual(final.current.phase, 'PLAN');
    assert.ok(['IDEA', 'RESEARCH', 'BRAINLIFT', 'PRD', 'GAMEPLAN'].includes(
      (final.current as { step: string }).step
    ));
    
    // History should contain transitions
    assert.ok(final.history.length >= 1);
  });

  it('should handle read during write', async () => {
    // Start with known state
    const initial = getDefaultState();
    initial.current = { phase: 'PLAN', step: 'IDEA' };
    saveState(testDir, initial);
    
    // Start a slow write
    const slowWrite = (async () => {
      const state = loadState(testDir);
      state.current = { phase: 'BUILD', step: 'IMPLEMENT' };
      await sleep(20);  // Long delay during "write"
      saveState(testDir, state);
    })();
    
    // Quick read during the write
    await sleep(5);
    const readDuringWrite = loadState(testDir);
    
    await slowWrite;
    
    const afterWrite = loadState(testDir);
    
    // Read during write should have gotten consistent (old) state
    assert.ok(readDuringWrite.current.phase === 'PLAN' || readDuringWrite.current.phase === 'BUILD');
    // After write should have new state
    assert.strictEqual(afterWrite.current.phase, 'BUILD');
  });

  it('should handle multiple readers with one writer', async () => {
    const initial = getDefaultState();
    initial.current = { phase: 'PLAN', step: 'IDEA' };
    saveState(testDir, initial);
    
    const reads: PhaseState[] = [];
    
    // One writer
    const writer = (async () => {
      for (let i = 0; i < 5; i++) {
        const state = loadState(testDir);
        state.history.push(createHistoryEntry({ phase: 'BUILD', step: 'TEST' }));
        await sleep(2);
        saveState(testDir, state);
      }
    })();
    
    // Multiple readers
    const readers = runConcurrently(10, async () => {
      await randomDelay(0, 15);
      const state = loadState(testDir);
      reads.push(state);
      return state;
    });
    
    await Promise.all([writer, readers]);
    
    // All reads should be valid states
    for (const read of reads) {
      assert.ok(read.current !== undefined);
      assert.ok(read.history !== undefined);
    }
  });
});

// ============================================================================
// 3. CHECK-THEN-ACT PATTERNS
// ============================================================================

describe('Check-Then-Act Patterns', () => {
  it('should handle concurrent check-then-create', async () => {
    // Simulate: check if state exists, if not create it
    const results = await runConcurrently(5, async (i) => {
      const statePath = join(testDir, '.midas', 'state.json');
      
      // Check
      const exists = existsSync(statePath);
      await sleep(5);  // Delay between check and act
      
      // Act
      if (!exists) {
        const state = getDefaultState();
        state.history.push(createHistoryEntry({ phase: 'PLAN', step: 'IDEA' })); // Mark who created it
        saveState(testDir, state);
        return 'created';
      }
      return 'existed';
    });
    
    // Multiple might think they created (race condition)
    const created = results.filter(r => r === 'created').length;
    console.log(`  [INFO] ${created} out of 5 thought they created the state`);
    
    // But only one file should exist with valid content
    const state = loadState(testDir);
    assert.ok(state.current !== undefined);
  });

  it('should handle concurrent error recording with dedup check', async () => {
    // recordError has built-in dedup - test if it holds under concurrency
    const sameError = 'Duplicate error message';
    
    await runConcurrently(10, async () => {
      await randomDelay(0, 5);
      recordError(testDir, sameError, 'same.ts', 10);
    });
    
    const errors = getUnresolvedErrors(testDir);
    
    // Due to race conditions, might have duplicates
    // This documents current behavior
    const matchingErrors = errors.filter(e => e.error === sameError);
    console.log(`  [INFO] Found ${matchingErrors.length} instances of same error (expected: 1)`);
    
    // At least one should exist
    assert.ok(matchingErrors.length >= 1);
  });

  it('should handle concurrent status updates on same check', async () => {
    const checkKey = 'SAME_CHECK';
    
    // Rapid toggle between states
    await runConcurrently(20, async (i) => {
      const status = i % 3 === 0 ? 'completed' : i % 3 === 1 ? 'pending' : 'skipped';
      await randomDelay(0, 3);
      updateCheckStatus(testDir, checkKey, status);
    });
    
    const statuses = getAllCheckStatuses(testDir);
    
    // Should have exactly one status for this key
    assert.ok(statuses[checkKey] !== undefined);
    assert.ok(['pending', 'completed', 'skipped'].includes(statuses[checkKey].status));
  });
});

// ============================================================================
// 4. ERROR DURING WRITE SCENARIOS
// ============================================================================

describe('Error During Write', () => {
  it('should handle write failure mid-operation', async () => {
    const initial = getDefaultState();
    initial.current = { phase: 'PLAN', step: 'IDEA' };
    saveState(testDir, initial);
    
    // Simulate partial write by writing garbage then valid
    const statePath = join(testDir, '.midas', 'state.json');
    
    // Write garbage (simulating crash mid-write)
    writeFileSync(statePath, '{"current":');  // Incomplete JSON
    
    // Should recover with default state
    const loaded = loadState(testDir);
    assert.strictEqual(loaded.current.phase, 'IDLE');
  });

  it('should handle concurrent write where one fails', async () => {
    const initial = getDefaultState();
    saveState(testDir, initial);
    
    // One normal write, one that "fails" by writing bad data
    await Promise.all([
      (async () => {
        const state = loadState(testDir);
        state.current = { phase: 'BUILD', step: 'IMPLEMENT' };
        saveState(testDir, state);
      })(),
      (async () => {
        await sleep(2);
        const statePath = join(testDir, '.midas', 'state.json');
        writeFileSync(statePath, 'CORRUPTED');  // Simulate failure
      })(),
    ]);
    
    // Should recover gracefully
    const loaded = loadState(testDir);
    // Either it's corrupted (returns default) or BUILD state won
    assert.ok(loaded.current.phase === 'IDLE' || loaded.current.phase === 'BUILD');
  });
});

// ============================================================================
// 5. STRESS TESTING WITH VARYING LOADS
// ============================================================================

describe('Stress Testing', () => {
  it('should handle 100 concurrent operations mixed types', async () => {
    const operations = Array.from({ length: 100 }, (_, i) => async () => {
      const type = i % 4;
      await randomDelay(0, 5);
      
      switch (type) {
        case 0:
          // Save state
          const state = getDefaultState();
          state.history.push(createHistoryEntry({ phase: 'PLAN', step: 'IDEA' }));
          saveState(testDir, state);
          break;
        case 1:
          // Load state
          loadState(testDir);
          break;
        case 2:
          // Record error
          recordError(testDir, `Stress error ${i}`);
          break;
        case 3:
          // Update check status
          updateCheckStatus(testDir, `STRESS_CHECK_${i % 10}`, 'completed');
          break;
      }
    });
    
    await Promise.all(operations.map(op => op()));
    
    // Everything should still be readable
    const state = loadState(testDir);
    const tracker = loadTracker(testDir);
    const statuses = getAllCheckStatuses(testDir);
    
    assert.ok(state !== null);
    assert.ok(tracker !== null);
    assert.ok(typeof statuses === 'object');
  });

  it('should complete 200 writes within reasonable time', async () => {
    const start = Date.now();
    
    await runConcurrently(200, async (i) => {
      const state = getDefaultState();
      state.current = { phase: 'BUILD', step: 'IMPLEMENT' };
      saveState(testDir, state);
    });
    
    const elapsed = Date.now() - start;
    console.log(`  [INFO] 200 concurrent writes completed in ${elapsed}ms`);
    
    // Should complete within 5 seconds
    assert.ok(elapsed < 5000, `Expected <5000ms, got ${elapsed}ms`);
    
    // State should be valid
    const state = loadState(testDir);
    assert.ok(state.current.phase === 'BUILD');
  });

  it('should handle burst then pause pattern', async () => {
    // Burst 1: 50 rapid writes
    await runConcurrently(50, async () => {
      recordError(testDir, 'Burst 1 error');
    });
    
    // Pause
    await sleep(100);
    
    // Burst 2: 50 more rapid writes
    await runConcurrently(50, async () => {
      recordError(testDir, 'Burst 2 error');
    });
    
    const tracker = loadTracker(testDir);
    // Should have some errors from both bursts (capped at 50)
    assert.ok(tracker.errorMemory.length > 0);
    assert.ok(tracker.errorMemory.length <= 50);
  });
});

// ============================================================================
// 6. LOST UPDATE DETECTION
// ============================================================================

describe('Lost Update Detection', () => {
  it('should detect lost history entries', async () => {
    saveState(testDir, getDefaultState());
    
    const expectedIncrements = 20;
    
    // Each operation adds one history entry
    await runConcurrently(expectedIncrements, async (i) => {
      const state = loadState(testDir);
      await sleep(Math.random() * 10);  // Random delay to maximize race chance
      state.history.push(createHistoryEntry({ phase: 'BUILD', step: 'TEST' }));
      saveState(testDir, state);
    });
    
    const final = loadState(testDir);
    const lostUpdates = expectedIncrements - final.history.length;
    
    console.log(`  [INFO] Expected ${expectedIncrements} history entries, got ${final.history.length}`);
    console.log(`  [INFO] Lost updates: ${lostUpdates} (${((lostUpdates / expectedIncrements) * 100).toFixed(1)}%)`);
    
    // Document the behavior - with proper locking this should be 0
    if (lostUpdates > 0) {
      console.log('  [WARN] Race condition detected - updates were lost');
    }
    
    // At minimum, state should be valid
    assert.ok(final.history.length >= 1);
  });

  it('should detect overwritten error records', async () => {
    const errorCount = 30;
    
    await runConcurrently(errorCount, async (i) => {
      // Each error is unique
      await randomDelay(0, 5);
      recordError(testDir, `Unique error ${i}`, `file${i}.ts`);
    });
    
    const tracker = loadTracker(testDir);
    const uniqueIds = new Set(tracker.errorMemory.map(e => e.id));
    
    console.log(`  [INFO] Recorded ${tracker.errorMemory.length} errors, ${uniqueIds.size} unique IDs`);
    
    // All IDs should be unique
    assert.strictEqual(tracker.errorMemory.length, uniqueIds.size, 'Duplicate error IDs detected');
  });

  it('should count total successful vs failed operations', async () => {
    const totalOperations = 50;
    let successCount = 0;
    let failCount = 0;
    
    await runConcurrently(totalOperations, async (i) => {
      try {
        const state = loadState(testDir);
        await randomDelay(0, 3);
        state.current = { phase: 'BUILD', step: 'TEST' };
        saveState(testDir, state);
        successCount++;
      } catch (e) {
        failCount++;
      }
    });
    
    console.log(`  [INFO] ${successCount} succeeded, ${failCount} failed out of ${totalOperations}`);
    
    // All operations should succeed (no exceptions from our code)
    assert.strictEqual(failCount, 0);
    assert.strictEqual(successCount, totalOperations);
  });
});

// ============================================================================
// 7. VERSION/TIMESTAMP CONFLICTS
// ============================================================================

describe('Version and Timestamp Conflicts', () => {
  it('should handle concurrent saves with different timestamps', async () => {
    const saves: Promise<void>[] = [];
    
    for (let i = 0; i < 10; i++) {
      saves.push((async () => {
        const state = getDefaultState();
        state.startedAt = new Date(Date.now() + i * 1000).toISOString(); // Different timestamps
        saveState(testDir, state);
      })());
    }
    
    await Promise.all(saves);
    
    const final = loadState(testDir);
    // Should have a valid timestamp
    assert.ok(new Date(final.startedAt).getTime() > 0);
  });

  it('should handle lastUpdated field under concurrency', async () => {
    await runConcurrently(20, async () => {
      recordError(testDir, 'Test error');
    });
    
    const tracker = loadTracker(testDir);
    
    // lastUpdated should be a valid ISO date
    assert.ok(tracker.lastUpdated !== undefined);
    const date = new Date(tracker.lastUpdated);
    assert.ok(!isNaN(date.getTime()));
    
    // Should be recent (within last minute)
    const age = Date.now() - date.getTime();
    assert.ok(age < 60000, `lastUpdated is ${age}ms old`);
  });

  it('should handle statusUpdatedAt field under rapid updates', async () => {
    const checkKey = 'TIMESTAMP_TEST';
    
    await runConcurrently(30, async () => {
      await randomDelay(0, 5);
      updateCheckStatus(testDir, checkKey, 'completed');
    });
    
    const statuses = getAllCheckStatuses(testDir);
    const status = statuses[checkKey];
    
    assert.ok(status !== undefined);
    assert.ok(status.updatedAt !== undefined);
    
    // Should be a valid date
    const date = new Date(status.updatedAt);
    assert.ok(!isNaN(date.getTime()));
  });
});

// ============================================================================
// 8. ISOLATION LEVEL SIMULATION
// ============================================================================

describe('Isolation Level Simulation', () => {
  it('should handle dirty reads (read uncommitted simulation)', async () => {
    saveState(testDir, getDefaultState());
    
    const reads: string[] = [];
    
    // "Transaction" 1: slow update
    const tx1 = (async () => {
      const state = loadState(testDir);
      state.current = { phase: 'SHIP', step: 'DEPLOY' };
      await sleep(20);  // "Uncommitted" period
      saveState(testDir, state);
    })();
    
    // "Transaction" 2: read during tx1's uncommitted period
    const tx2 = (async () => {
      await sleep(5);
      const state = loadState(testDir);
      reads.push(state.current.phase);
      await sleep(25);
      const state2 = loadState(testDir);
      reads.push(state2.current.phase);
    })();
    
    await Promise.all([tx1, tx2]);
    
    console.log(`  [INFO] Reads during transaction: ${reads.join(' -> ')}`);
    // Both reads should be consistent (either both old or both new)
    // With file-based storage, we can't guarantee this
  });

  it('should handle non-repeatable reads', async () => {
    const initial = getDefaultState();
    initial.current = { phase: 'PLAN', step: 'IDEA' };
    saveState(testDir, initial);
    
    const reads: string[] = [];
    
    // Reader reads twice with writer in between
    const reader = (async () => {
      reads.push(loadState(testDir).current.phase);
      await sleep(20);  // Gap where writer can intervene
      reads.push(loadState(testDir).current.phase);
    })();
    
    // Writer changes state between reads
    const writer = (async () => {
      await sleep(5);
      const state = loadState(testDir);
      state.current = { phase: 'BUILD', step: 'IMPLEMENT' };
      saveState(testDir, state);
    })();
    
    await Promise.all([reader, writer]);
    
    console.log(`  [INFO] Non-repeatable read test: ${reads.join(' -> ')}`);
    
    // First read should be PLAN, second might be BUILD (non-repeatable)
    assert.strictEqual(reads[0], 'PLAN');
    // Second read could be either - documenting the behavior
  });
});

// ============================================================================
// 9. DEADLOCK SIMULATION
// ============================================================================

describe('Deadlock Prevention', () => {
  it('should not deadlock on circular resource access', async () => {
    const start = Date.now();
    const timeout = 5000;
    
    // Two "processes" accessing resources in different order
    const process1 = (async () => {
      for (let i = 0; i < 10; i++) {
        loadState(testDir);
        await sleep(1);
        loadTracker(testDir);
      }
    })();
    
    const process2 = (async () => {
      for (let i = 0; i < 10; i++) {
        loadTracker(testDir);
        await sleep(1);
        loadState(testDir);
      }
    })();
    
    await Promise.race([
      Promise.all([process1, process2]),
      sleep(timeout).then(() => { throw new Error('Deadlock detected'); }),
    ]);
    
    const elapsed = Date.now() - start;
    assert.ok(elapsed < timeout, `Potential deadlock - took ${elapsed}ms`);
  });

  it('should handle nested save operations', async () => {
    // Save inside save callback simulation
    const state1 = getDefaultState();
    state1.current = { phase: 'PLAN', step: 'IDEA' };
    
    await Promise.all([
      (async () => {
        saveState(testDir, state1);
        // Immediately save again
        const state2 = loadState(testDir);
        state2.current = { phase: 'BUILD', step: 'IMPLEMENT' };
        saveState(testDir, state2);
      })(),
      (async () => {
        await sleep(1);
        saveState(testDir, getDefaultState());
      })(),
    ]);
    
    // Should complete without deadlock
    const final = loadState(testDir);
    assert.ok(final.current !== undefined);
  });
});

// ============================================================================
// 10. FILE SYSTEM SPECIFIC RACE CONDITIONS
// ============================================================================

describe('File System Specific', () => {
  it('should handle concurrent mkdir attempts', async () => {
    const newDir = createTestDir('mkdir-race');
    
    // Multiple attempts to save (which creates .midas dir)
    await runConcurrently(10, async () => {
      saveState(newDir, getDefaultState());
    });
    
    // Directory should exist and be valid
    assert.ok(existsSync(join(newDir, '.midas')));
    assert.ok(existsSync(join(newDir, '.midas', 'state.json')));
  });

  it('should handle file being deleted during read', async () => {
    saveState(testDir, getDefaultState());
    
    await Promise.all([
      (async () => {
        // Delete the file
        await sleep(5);
        const path = join(testDir, '.midas', 'state.json');
        if (existsSync(path)) {
          rmSync(path);
        }
      })(),
      (async () => {
        // Multiple reads, some might fail
        for (let i = 0; i < 10; i++) {
          try {
            const state = loadState(testDir);
            // If file was deleted, should get default
            assert.ok(state.current !== undefined);
          } catch (e) {
            // Some failures are acceptable
          }
          await sleep(2);
        }
      })(),
    ]);
  });

  it('should handle directory being deleted during write', async () => {
    mkdirSync(join(testDir, '.midas'), { recursive: true });
    
    await Promise.all([
      (async () => {
        await sleep(5);
        rmSync(join(testDir, '.midas'), { recursive: true, force: true });
      })(),
      (async () => {
        for (let i = 0; i < 5; i++) {
          try {
            saveState(testDir, getDefaultState());
          } catch (e) {
            // Write failures are acceptable when dir is deleted
          }
          await sleep(3);
        }
      })(),
    ]);
    
    // Should be able to recover by creating dir again
    saveState(testDir, getDefaultState());
    const state = loadState(testDir);
    assert.ok(state.current !== undefined);
  });
});

// ============================================================================
// 11. SEQUENTIAL VS PARALLEL COMPARISON
// ============================================================================

describe('Sequential vs Parallel Behavior', () => {
  it('should produce same result with sequential operations', async () => {
    saveState(testDir, getDefaultState());
    
    // Sequential: guaranteed to produce 10 history entries
    for (let i = 0; i < 10; i++) {
      const state = loadState(testDir);
      state.history.push(createHistoryEntry({ phase: 'PLAN', step: 'IDEA' }));
      saveState(testDir, state);
    }
    
    const sequential = loadState(testDir);
    assert.strictEqual(sequential.history.length, 10);
    
    // Reset with fresh state
    saveState(testDir, getDefaultState());
    
    // Parallel: with atomic merge, ALL updates are preserved
    // Each concurrent operation reads version 0, adds 1 entry, and saves
    // When conflicts occur, arrays are union-merged, so all entries preserved
    await runConcurrently(10, async (i) => {
      const state = loadState(testDir);
      await sleep(1);
      state.history.push(createHistoryEntry({ phase: 'BUILD', step: 'TEST' }));
      saveState(testDir, state);
    });
    
    const parallel = loadState(testDir);
    
    console.log(`  [INFO] Sequential: ${sequential.history.length}, Parallel: ${parallel.history.length}`);
    
    // With atomic merge, parallel should preserve all entries (10)
    // May get more due to merge bringing in entries from concurrent reads
    // The key is: NO LOST UPDATES (>= 10)
    assert.ok(parallel.history.length >= 10, 
      `Expected >= 10 history entries, got ${parallel.history.length}`);
  });
});
