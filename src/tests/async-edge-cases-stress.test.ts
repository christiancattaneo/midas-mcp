/**
 * Async Edge Cases Stress Tests
 * 
 * Comprehensive testing of async/await edge cases:
 * - Sync throws in async context
 * - Error propagation with/without await
 * - Promise rejection vs throw
 * - Unhandled rejections
 * - Race conditions
 * - Timeout handling
 * - Concurrent operations
 * - Event loop edge cases
 * 
 * Based on JavaScript async/await specifications and common pitfalls.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Import async functions from the codebase
import { loadState, saveState, getDefaultState } from '../state/phase.js';
import { writeStateAtomic } from '../atomic-state.js';

// ============================================================================
// HELPERS
// ============================================================================

let testDirs: string[] = [];

function createTestDir(prefix: string): string {
  const dir = join(tmpdir(), `midas-async-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, '.midas'), { recursive: true });
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

// Helper to capture unhandled rejections temporarily
function captureUnhandledRejections(): { rejections: Error[]; restore: () => void } {
  const rejections: Error[] = [];
  const handler = (reason: Error) => {
    rejections.push(reason);
  };
  process.on('unhandledRejection', handler);
  return {
    rejections,
    restore: () => process.off('unhandledRejection', handler),
  };
}

// ============================================================================
// 1. SYNC THROW BEFORE AWAIT
// ============================================================================

describe('Sync Throw Before Await', () => {
  it('should convert sync throw to promise rejection in async function', async () => {
    async function syncThrowBeforeAwait(): Promise<void> {
      throw new Error('sync error before await');
      await Promise.resolve();
    }
    
    let caught = false;
    try {
      await syncThrowBeforeAwait();
    } catch (e) {
      caught = true;
      assert.ok((e as Error).message.includes('sync error'));
    }
    
    assert.ok(caught, 'Should catch sync throw as rejection');
  });

  it('should convert immediate throw to rejection', async () => {
    async function immediateThrow(): Promise<void> {
      throw new Error('immediate');
    }
    
    const promise = immediateThrow();
    
    assert.ok(promise instanceof Promise, 'Should return a promise');
    
    await assert.rejects(promise, { message: 'immediate' });
  });

  it('should handle throw in first line of async function', async () => {
    async function firstLineThrow(): Promise<string> {
      throw new Error('first line');
      return 'never reached';
    }
    
    await assert.rejects(firstLineThrow(), { message: 'first line' });
  });

  it('should handle conditional sync throw', async () => {
    async function conditionalThrow(shouldThrow: boolean): Promise<string> {
      if (shouldThrow) {
        throw new Error('conditional');
      }
      await Promise.resolve();
      return 'success';
    }
    
    // Should throw
    await assert.rejects(conditionalThrow(true), { message: 'conditional' });
    
    // Should succeed
    const result = await conditionalThrow(false);
    assert.strictEqual(result, 'success');
  });
});

// ============================================================================
// 2. SYNC THROW AFTER AWAIT
// ============================================================================

describe('Sync Throw After Await', () => {
  it('should handle throw after single await', async () => {
    async function throwAfterAwait(): Promise<void> {
      await Promise.resolve();
      throw new Error('after await');
    }
    
    await assert.rejects(throwAfterAwait(), { message: 'after await' });
  });

  it('should handle throw after multiple awaits', async () => {
    async function throwAfterMultiple(): Promise<void> {
      await Promise.resolve(1);
      await Promise.resolve(2);
      await Promise.resolve(3);
      throw new Error('after multiple');
    }
    
    await assert.rejects(throwAfterMultiple(), { message: 'after multiple' });
  });

  it('should handle throw after resolved promise', async () => {
    async function throwAfterResolved(): Promise<void> {
      const value = await Promise.resolve('value');
      assert.strictEqual(value, 'value');
      throw new Error('after resolved');
    }
    
    await assert.rejects(throwAfterResolved(), { message: 'after resolved' });
  });

  it('should handle throw after async operation', async () => {
    async function throwAfterDelay(): Promise<void> {
      await new Promise(resolve => setTimeout(resolve, 10));
      throw new Error('after delay');
    }
    
    await assert.rejects(throwAfterDelay(), { message: 'after delay' });
  });
});

// ============================================================================
// 3. AWAIT VS NO AWAIT
// ============================================================================

describe('Await vs No Await', () => {
  it('should catch error when awaiting inner async', async () => {
    async function inner(): Promise<void> {
      throw new Error('inner error');
    }
    
    async function outerWithAwait(): Promise<void> {
      await inner();
    }
    
    await assert.rejects(outerWithAwait(), { message: 'inner error' });
  });

  it('should NOT catch error in try/catch when NOT awaiting', async () => {
    let caughtInTryCatch = false;
    let innerPromise: Promise<void> | null = null;
    
    async function inner(): Promise<void> {
      throw new Error('unhandled inner');
    }
    
    async function outerWithoutAwait(): Promise<void> {
      try {
        // Store the promise so we can catch it later (preventing unhandled rejection)
        innerPromise = inner(); // No await - error escapes this try/catch
      } catch {
        // This will NOT catch the error
        caughtInTryCatch = true;
      }
    }
    
    // The outer function completes successfully (doesn't wait for inner)
    await outerWithoutAwait();
    
    // The try/catch should NOT have caught the inner error
    assert.ok(!caughtInTryCatch, 'Try/catch should not catch non-awaited async error');
    
    // Now properly handle the promise to prevent unhandled rejection
    if (innerPromise) {
      await assert.rejects(innerPromise, { message: 'unhandled inner' });
    }
  });

  it('should handle return without await', async () => {
    async function inner(): Promise<string> {
      return 'value';
    }
    
    async function outerReturn(): Promise<string> {
      return inner(); // No await, but returned
    }
    
    const result = await outerReturn();
    assert.strictEqual(result, 'value');
  });

  it('should propagate rejection when returning without await', async () => {
    async function inner(): Promise<string> {
      throw new Error('returned rejection');
    }
    
    async function outerReturn(): Promise<string> {
      return inner(); // No await, but returned
    }
    
    await assert.rejects(outerReturn(), { message: 'returned rejection' });
  });
});

// ============================================================================
// 4. PROMISE.REJECT VS THROW
// ============================================================================

describe('Promise.reject vs Throw', () => {
  it('should handle Promise.reject inside async', async () => {
    async function rejectInside(): Promise<void> {
      return Promise.reject(new Error('rejected'));
    }
    
    await assert.rejects(rejectInside(), { message: 'rejected' });
  });

  it('should handle conditional Promise.reject', async () => {
    async function conditionalReject(fail: boolean): Promise<string> {
      if (fail) {
        return Promise.reject(new Error('conditional reject'));
      }
      return 'success';
    }
    
    await assert.rejects(conditionalReject(true));
    const result = await conditionalReject(false);
    assert.strictEqual(result, 'success');
  });

  it('should handle awaited Promise.reject', async () => {
    async function awaitReject(): Promise<void> {
      await Promise.reject(new Error('awaited reject'));
    }
    
    await assert.rejects(awaitReject(), { message: 'awaited reject' });
  });

  it('throw and Promise.reject should behave similarly when awaited', async () => {
    async function withThrow(): Promise<void> {
      throw new Error('throw');
    }
    
    async function withReject(): Promise<void> {
      return Promise.reject(new Error('reject'));
    }
    
    let throwError: Error | null = null;
    let rejectError: Error | null = null;
    
    try {
      await withThrow();
    } catch (e) {
      throwError = e as Error;
    }
    
    try {
      await withReject();
    } catch (e) {
      rejectError = e as Error;
    }
    
    assert.ok(throwError !== null);
    assert.ok(rejectError !== null);
    // Both should be Error instances
    assert.ok(throwError instanceof Error);
    assert.ok(rejectError instanceof Error);
  });
});

// ============================================================================
// 5. NESTED ASYNC FUNCTIONS
// ============================================================================

describe('Nested Async Functions', () => {
  it('should propagate error through nested async calls', async () => {
    async function level3(): Promise<void> {
      throw new Error('level3 error');
    }
    
    async function level2(): Promise<void> {
      await level3();
    }
    
    async function level1(): Promise<void> {
      await level2();
    }
    
    await assert.rejects(level1(), { message: 'level3 error' });
  });

  it('should catch error at appropriate level', async () => {
    async function inner(): Promise<void> {
      throw new Error('inner');
    }
    
    async function middle(): Promise<string> {
      try {
        await inner();
        return 'not reached';
      } catch {
        return 'caught in middle';
      }
    }
    
    async function outer(): Promise<string> {
      return await middle();
    }
    
    const result = await outer();
    assert.strictEqual(result, 'caught in middle');
  });

  it('should handle deeply nested async (10 levels)', async () => {
    const createNested = (depth: number): (() => Promise<number>) => {
      if (depth === 0) {
        return async () => {
          throw new Error(`depth 0`);
        };
      }
      return async () => {
        return await createNested(depth - 1)();
      };
    };
    
    await assert.rejects(createNested(10)(), { message: 'depth 0' });
  });
});

// ============================================================================
// 6. TRY/CATCH PLACEMENT
// ============================================================================

describe('Try/Catch Placement', () => {
  it('should catch when try/catch wraps entire body', async () => {
    async function fullWrap(): Promise<string> {
      try {
        throw new Error('error');
      } catch {
        return 'caught';
      }
    }
    
    const result = await fullWrap();
    assert.strictEqual(result, 'caught');
  });

  it('should catch when try/catch wraps await', async () => {
    async function fails(): Promise<void> {
      throw new Error('fails');
    }
    
    async function catchAround(): Promise<string> {
      try {
        await fails();
        return 'success';
      } catch {
        return 'caught';
      }
    }
    
    const result = await catchAround();
    assert.strictEqual(result, 'caught');
  });

  it('should NOT catch when try/catch is before await', async () => {
    async function fails(): Promise<void> {
      throw new Error('fails');
    }
    
    async function catchBefore(): Promise<string> {
      try {
        // sync code only
      } catch {
        return 'caught in wrong place';
      }
      await fails(); // This is outside try/catch
      return 'success';
    }
    
    await assert.rejects(catchBefore());
  });

  it('should handle multiple try/catch blocks', async () => {
    async function multiTryCatch(): Promise<string[]> {
      const results: string[] = [];
      
      try {
        throw new Error('first');
      } catch {
        results.push('caught first');
      }
      
      try {
        throw new Error('second');
      } catch {
        results.push('caught second');
      }
      
      return results;
    }
    
    const result = await multiTryCatch();
    assert.deepStrictEqual(result, ['caught first', 'caught second']);
  });
});

// ============================================================================
// 7. FINALLY BLOCKS
// ============================================================================

describe('Finally Blocks', () => {
  it('should run finally after success', async () => {
    let finallyRan = false;
    
    async function withFinally(): Promise<string> {
      try {
        return 'success';
      } finally {
        finallyRan = true;
      }
    }
    
    const result = await withFinally();
    assert.strictEqual(result, 'success');
    assert.ok(finallyRan);
  });

  it('should run finally after error', async () => {
    let finallyRan = false;
    
    async function withFinally(): Promise<void> {
      try {
        throw new Error('error');
      } finally {
        finallyRan = true;
      }
    }
    
    await assert.rejects(withFinally());
    assert.ok(finallyRan);
  });

  it('should handle throw in finally', async () => {
    async function throwInFinally(): Promise<void> {
      try {
        throw new Error('try error');
      } finally {
        throw new Error('finally error');
      }
    }
    
    // Finally error takes precedence
    await assert.rejects(throwInFinally(), { message: 'finally error' });
  });

  it('should handle async operations in finally', async () => {
    const operations: string[] = [];
    
    async function asyncFinally(): Promise<void> {
      try {
        operations.push('try');
        throw new Error('error');
      } finally {
        await Promise.resolve();
        operations.push('finally');
      }
    }
    
    await assert.rejects(asyncFinally());
    assert.deepStrictEqual(operations, ['try', 'finally']);
  });
});

// ============================================================================
// 8. PROMISE.ALL EDGE CASES
// ============================================================================

describe('Promise.all Edge Cases', () => {
  it('should reject on first failure', async () => {
    const results: string[] = [];
    
    await assert.rejects(
      Promise.all([
        (async () => { results.push('1'); return 1; })(),
        (async () => { throw new Error('fail'); })(),
        (async () => { results.push('3'); return 3; })(),
      ])
    );
    
    // All promises start immediately, but rejection happens fast
    // Some results may or may not be captured
  });

  it('should collect all results on success', async () => {
    const results = await Promise.all([
      Promise.resolve(1),
      Promise.resolve(2),
      Promise.resolve(3),
    ]);
    
    assert.deepStrictEqual(results, [1, 2, 3]);
  });

  it('should handle empty array', async () => {
    const results = await Promise.all([]);
    
    assert.deepStrictEqual(results, []);
  });

  it('should handle mix of sync and async', async () => {
    const results = await Promise.all([
      1,  // Not a promise
      Promise.resolve(2),
      (async () => 3)(),
    ]);
    
    assert.deepStrictEqual(results, [1, 2, 3]);
  });
});

// ============================================================================
// 9. PROMISE.RACE EDGE CASES
// ============================================================================

describe('Promise.race Edge Cases', () => {
  it('should resolve with first resolved value', async () => {
    const result = await Promise.race([
      new Promise(resolve => setTimeout(() => resolve('slow'), 100)),
      Promise.resolve('fast'),
    ]);
    
    assert.strictEqual(result, 'fast');
  });

  it('should reject with first rejection', async () => {
    await assert.rejects(
      Promise.race([
        new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 100)),
        Promise.reject(new Error('fast rejection')),
      ]),
      { message: 'fast rejection' }
    );
  });

  it('should never settle for empty array', async () => {
    // Promise.race([]) never settles
    let settled = false;
    
    const racePromise = Promise.race([]).then(() => { settled = true; });
    
    await new Promise(resolve => setTimeout(resolve, 50));
    
    assert.ok(!settled, 'Empty race should never settle');
  });
});

// ============================================================================
// 10. PROMISE.ALLSETTLED EDGE CASES
// ============================================================================

describe('Promise.allSettled Edge Cases', () => {
  it('should collect both fulfilled and rejected', async () => {
    const results = await Promise.allSettled([
      Promise.resolve('success'),
      Promise.reject(new Error('failure')),
      Promise.resolve('another success'),
    ]);
    
    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].status, 'fulfilled');
    assert.strictEqual(results[1].status, 'rejected');
    assert.strictEqual(results[2].status, 'fulfilled');
    
    if (results[0].status === 'fulfilled') {
      assert.strictEqual(results[0].value, 'success');
    }
    if (results[1].status === 'rejected') {
      assert.strictEqual(results[1].reason.message, 'failure');
    }
  });

  it('should handle empty array', async () => {
    const results = await Promise.allSettled([]);
    
    assert.deepStrictEqual(results, []);
  });

  it('should handle all rejections', async () => {
    const results = await Promise.allSettled([
      Promise.reject(new Error('1')),
      Promise.reject(new Error('2')),
    ]);
    
    assert.ok(results.every(r => r.status === 'rejected'));
  });
});

// ============================================================================
// 11. TIMEOUT AND CANCELLATION
// ============================================================================

describe('Timeout and Cancellation', () => {
  it('should handle timeout pattern', async () => {
    function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) => 
          setTimeout(() => reject(new Error('timeout')), ms)
        ),
      ]);
    }
    
    // Should succeed before timeout
    const fast = await withTimeout(Promise.resolve('fast'), 100);
    assert.strictEqual(fast, 'fast');
    
    // Should timeout
    await assert.rejects(
      withTimeout(new Promise(() => {}), 50),  // Never resolves
      { message: 'timeout' }
    );
  });

  it('should handle AbortController pattern', async () => {
    async function abortable(signal: AbortSignal): Promise<string> {
      if (signal.aborted) {
        throw new Error('Already aborted');
      }
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, 100);
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new Error('Aborted'));
        });
      });
      
      return 'completed';
    }
    
    // Normal completion
    const controller1 = new AbortController();
    const result = await abortable(controller1.signal);
    assert.strictEqual(result, 'completed');
    
    // Aborted
    const controller2 = new AbortController();
    const promise = abortable(controller2.signal);
    controller2.abort();
    
    await assert.rejects(promise, { message: 'Aborted' });
  });
});

// ============================================================================
// 12. CONCURRENT ASYNC OPERATIONS
// ============================================================================

describe('Concurrent Async Operations', () => {
  it('should handle concurrent file operations', async () => {
    const dir = createTestDir('concurrent');
    
    const operations = [];
    for (let i = 0; i < 20; i++) {
      operations.push(
        (async () => {
          const state = loadState(dir);
          state._version = (state._version ?? 0) + 1;
          saveState(dir, state);
          return state._version;
        })()
      );
    }
    
    const results = await Promise.all(operations);
    
    // All operations should complete
    assert.strictEqual(results.length, 20);
    assert.ok(results.every(r => typeof r === 'number'));
  });

  it('should handle concurrent with some failures', async () => {
    let callCount = 0;
    
    async function mayFail(): Promise<string> {
      callCount++;
      if (callCount % 3 === 0) {
        throw new Error(`fail at ${callCount}`);
      }
      return `success ${callCount}`;
    }
    
    const results = await Promise.allSettled([
      mayFail(), mayFail(), mayFail(),
      mayFail(), mayFail(), mayFail(),
    ]);
    
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    
    assert.ok(fulfilled.length > 0);
    assert.ok(rejected.length > 0);
  });
});

// ============================================================================
// 13. ASYNC GENERATORS
// ============================================================================

describe('Async Generators', () => {
  it('should handle async iteration', async () => {
    async function* asyncGen(): AsyncGenerator<number> {
      yield 1;
      yield 2;
      yield 3;
    }
    
    const results: number[] = [];
    for await (const value of asyncGen()) {
      results.push(value);
    }
    
    assert.deepStrictEqual(results, [1, 2, 3]);
  });

  it('should handle error in async generator', async () => {
    async function* errorGen(): AsyncGenerator<number> {
      yield 1;
      throw new Error('generator error');
    }
    
    const results: number[] = [];
    
    await assert.rejects(async () => {
      for await (const value of errorGen()) {
        results.push(value);
      }
    }, { message: 'generator error' });
    
    assert.deepStrictEqual(results, [1]);
  });

  it('should handle return in async generator', async () => {
    async function* returnGen(): AsyncGenerator<number, string> {
      yield 1;
      yield 2;
      return 'done';
    }
    
    const gen = returnGen();
    
    assert.deepStrictEqual(await gen.next(), { value: 1, done: false });
    assert.deepStrictEqual(await gen.next(), { value: 2, done: false });
    assert.deepStrictEqual(await gen.next(), { value: 'done', done: true });
  });
});

// ============================================================================
// 14. EVENT LOOP EDGE CASES
// ============================================================================

describe('Event Loop Edge Cases', () => {
  it('should handle microtask vs macrotask order', async () => {
    const order: string[] = [];
    
    setTimeout(() => order.push('timeout'), 0);
    Promise.resolve().then(() => order.push('microtask'));
    order.push('sync');
    
    await new Promise(resolve => setTimeout(resolve, 10));
    
    assert.deepStrictEqual(order, ['sync', 'microtask', 'timeout']);
  });

  it('should handle setImmediate vs setTimeout', async () => {
    const order: string[] = [];
    
    await new Promise<void>(resolve => {
      setTimeout(() => {
        order.push('timeout');
        if (order.length >= 2) resolve();
      }, 0);
      setImmediate(() => {
        order.push('immediate');
        if (order.length >= 2) resolve();
      });
    });
    
    // Order may vary, but both should run
    assert.strictEqual(order.length, 2);
    assert.ok(order.includes('timeout'));
    assert.ok(order.includes('immediate'));
  });

  it('should handle process.nextTick', async () => {
    const order: string[] = [];
    
    await new Promise<void>(resolve => {
      process.nextTick(() => {
        Promise.resolve().then(() => order.push('microtask'));
        order.push('nextTick');
      });
      
      setTimeout(() => {
        resolve();
      }, 10);
    });
    
    // Both should have run, nextTick schedules before microtask within same tick
    assert.ok(order.includes('nextTick'), 'nextTick should run');
    assert.ok(order.includes('microtask'), 'microtask should run');
  });
});

// ============================================================================
// 15. ERROR TYPES AND MESSAGES
// ============================================================================

describe('Error Types and Messages', () => {
  it('should preserve Error type through async', async () => {
    class CustomError extends Error {
      code: string;
      constructor(message: string, code: string) {
        super(message);
        this.name = 'CustomError';
        this.code = code;
      }
    }
    
    async function throwCustom(): Promise<void> {
      throw new CustomError('custom', 'CUSTOM_CODE');
    }
    
    try {
      await throwCustom();
    } catch (e) {
      assert.ok(e instanceof CustomError);
      assert.strictEqual((e as CustomError).code, 'CUSTOM_CODE');
    }
  });

  it('should preserve stack trace through async', async () => {
    async function level1(): Promise<void> {
      await level2();
    }
    
    async function level2(): Promise<void> {
      throw new Error('deep error');
    }
    
    try {
      await level1();
    } catch (e) {
      const stack = (e as Error).stack || '';
      assert.ok(stack.includes('level2'), 'Stack should include level2');
    }
  });

  it('should handle non-Error throws', async () => {
    async function throwString(): Promise<void> {
      throw 'string error';
    }
    
    async function throwNumber(): Promise<void> {
      throw 42;
    }
    
    async function throwObject(): Promise<void> {
      throw { message: 'object error' };
    }
    
    try {
      await throwString();
    } catch (e) {
      assert.strictEqual(e, 'string error');
    }
    
    try {
      await throwNumber();
    } catch (e) {
      assert.strictEqual(e, 42);
    }
    
    try {
      await throwObject();
    } catch (e) {
      assert.deepStrictEqual(e, { message: 'object error' });
    }
  });
});

// ============================================================================
// 16. REAL CODEBASE ASYNC PATTERNS
// ============================================================================

describe('Real Codebase Async Patterns', () => {
  it('should handle writeStateAtomic success', async () => {
    const dir = createTestDir('atomic-success');
    const stateFile = join(dir, '.midas', 'state.json');
    
    const state = getDefaultState();
    const result = await writeStateAtomic(stateFile, state);
    
    assert.ok(result.success);
    assert.ok(typeof result.finalVersion === 'number');
  });

  it('should handle writeStateAtomic with conflict', async () => {
    const dir = createTestDir('atomic-conflict');
    const stateFile = join(dir, '.midas', 'state.json');
    
    // Write initial state
    const state1 = getDefaultState();
    await writeStateAtomic(stateFile, state1);
    
    // Write with old version (simulate conflict)
    const state2 = { ...state1, _version: 0 };
    const result = await writeStateAtomic(stateFile, state2, {
      expectedVersion: -1,  // Wrong version
    });
    
    // Should still succeed (handles conflict)
    assert.ok(result.success);
  });

  it('should handle concurrent writeStateAtomic', async () => {
    const dir = createTestDir('atomic-concurrent');
    const stateFile = join(dir, '.midas', 'state.json');
    
    const state = getDefaultState();
    await writeStateAtomic(stateFile, state);
    
    // Concurrent writes
    const writes = [];
    for (let i = 0; i < 10; i++) {
      writes.push(
        writeStateAtomic(stateFile, { ...state, _version: i })
      );
    }
    
    const results = await Promise.all(writes);
    
    // All should succeed
    assert.ok(results.every(r => r.success));
  });
});

// ============================================================================
// 17. PERFORMANCE
// ============================================================================

describe('Performance', () => {
  it('should handle 1000 sequential awaits', async () => {
    const start = Date.now();
    
    for (let i = 0; i < 1000; i++) {
      await Promise.resolve(i);
    }
    
    const elapsed = Date.now() - start;
    console.log(`  [INFO] 1000 sequential awaits: ${elapsed}ms`);
    
    assert.ok(elapsed < 1000, `Too slow: ${elapsed}ms`);
  });

  it('should handle 1000 parallel promises', async () => {
    const start = Date.now();
    
    const promises = [];
    for (let i = 0; i < 1000; i++) {
      promises.push(Promise.resolve(i));
    }
    
    await Promise.all(promises);
    
    const elapsed = Date.now() - start;
    console.log(`  [INFO] 1000 parallel promises: ${elapsed}ms`);
    
    assert.ok(elapsed < 1000, `Too slow: ${elapsed}ms`);
  });

  it('should handle rapid async function creation', async () => {
    const start = Date.now();
    
    const results = [];
    for (let i = 0; i < 1000; i++) {
      results.push(await (async () => i)());
    }
    
    const elapsed = Date.now() - start;
    console.log(`  [INFO] 1000 async function creations: ${elapsed}ms`);
    
    assert.strictEqual(results.length, 1000);
    assert.ok(elapsed < 2000, `Too slow: ${elapsed}ms`);
  });
});
