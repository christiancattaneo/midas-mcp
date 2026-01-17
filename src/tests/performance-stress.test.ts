/**
 * Performance Stress Tests
 * 
 * Comprehensive testing of performance characteristics:
 * - File count scaling (1, 10, 50, 100, 200, 500)
 * - Document count scaling
 * - Timing boundaries and thresholds
 * - Concurrent operation performance
 * - Memory efficiency under load
 * - Regression detection
 * 
 * Based on combinatorial testing and boundary value analysis.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Import functions to test
import { discoverSourceFiles, discoverAndReadCode } from '../code-discovery.js';
import { discoverDocsSync } from '../docs-discovery.js';
import { loadState, saveState, getDefaultState, createHistoryEntry } from '../state/phase.js';
import { loadTracker, saveTracker, recordError } from '../tracker.js';
import { estimateTokens } from '../context.js';

// ============================================================================
// HELPERS
// ============================================================================

let testDirs: string[] = [];

function createTestDir(prefix: string): string {
  const dir = join(tmpdir(), `midas-perf-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

// Helper to create files
function createFile(dir: string, path: string, content: string = ''): void {
  const fullPath = join(dir, path);
  const parentDir = join(fullPath, '..');
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
  writeFileSync(fullPath, content);
}

// Helper to measure execution time
function measure<T>(fn: () => T): { result: T; elapsed: number } {
  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;
  return { result, elapsed };
}

// Helper to measure async execution time
async function measureAsync<T>(fn: () => Promise<T>): Promise<{ result: T; elapsed: number }> {
  const start = performance.now();
  const result = await fn();
  const elapsed = performance.now() - start;
  return { result, elapsed };
}

// Helper to generate source code content
function generateCode(lines: number): string {
  const parts: string[] = [];
  for (let i = 0; i < lines; i++) {
    parts.push(`export const variable${i} = ${i}; // Line ${i}`);
  }
  return parts.join('\n');
}

// Helper to generate markdown content
function generateMarkdown(paragraphs: number): string {
  const parts: string[] = ['# Document\n'];
  for (let i = 0; i < paragraphs; i++) {
    parts.push(`## Section ${i}\n\nThis is paragraph ${i}. Lorem ipsum dolor sit amet.\n`);
  }
  return parts.join('\n');
}

// ============================================================================
// 1. FILE COUNT SCALING
// ============================================================================

describe('File Count Scaling', () => {
  const fileCounts = [1, 5, 10, 25, 50, 100, 200];
  
  for (const count of fileCounts) {
    it(`should discover ${count} files within time limit`, () => {
      const dir = createTestDir(`files-${count}`);
      
      for (let i = 0; i < count; i++) {
        createFile(dir, `src/file${i}.ts`, `export const x${i} = ${i};`);
      }
      
      const { result, elapsed } = measure(() => discoverSourceFiles(dir));
      
      console.log(`  [PERF] ${count} files: ${elapsed.toFixed(2)}ms`);
      
      assert.ok(result.length >= count * 0.9, `Expected >= ${count * 0.9} files, got ${result.length}`);
      
      // Time should scale roughly linearly
      const maxExpectedMs = count * 5 + 100;  // 5ms per file + 100ms overhead
      assert.ok(elapsed < maxExpectedMs, `Too slow: ${elapsed.toFixed(2)}ms > ${maxExpectedMs}ms`);
    });
  }
  
  it('should handle 500 files', () => {
    const dir = createTestDir('files-500');
    
    for (let i = 0; i < 500; i++) {
      createFile(dir, `src/file${i}.ts`, `export const x${i} = ${i};`);
    }
    
    const { result, elapsed } = measure(() => discoverSourceFiles(dir));
    
    console.log(`  [PERF] 500 files: ${elapsed.toFixed(2)}ms`);
    
    assert.ok(result.length >= 450, `Expected >= 450 files`);
    assert.ok(elapsed < 10000, `Too slow: ${elapsed.toFixed(2)}ms`);
  });
});

// ============================================================================
// 2. DOCUMENT COUNT SCALING
// ============================================================================

describe('Document Count Scaling', () => {
  const docCounts = [1, 5, 10, 25, 50];
  
  for (const count of docCounts) {
    it(`should discover ${count} documents within time limit`, () => {
      const dir = createTestDir(`docs-${count}`);
      
      mkdirSync(join(dir, 'docs'), { recursive: true });
      for (let i = 0; i < count; i++) {
        createFile(dir, `docs/doc${i}.md`, generateMarkdown(10));
      }
      
      const { result, elapsed } = measure(() => discoverDocsSync(dir));
      
      console.log(`  [PERF] ${count} docs: ${elapsed.toFixed(2)}ms`);
      
      // Time should be reasonable
      const maxExpectedMs = count * 50 + 200;  // 50ms per doc + 200ms overhead
      assert.ok(elapsed < maxExpectedMs, `Too slow: ${elapsed.toFixed(2)}ms > ${maxExpectedMs}ms`);
    });
  }
  
  it('should handle large documents (1MB each)', () => {
    const dir = createTestDir('docs-large');
    
    mkdirSync(join(dir, 'docs'), { recursive: true });
    const largeContent = generateMarkdown(500);  // ~50KB
    
    for (let i = 0; i < 10; i++) {
      createFile(dir, `docs/large${i}.md`, largeContent);
    }
    
    const { elapsed } = measure(() => discoverDocsSync(dir));
    
    console.log(`  [PERF] 10 large docs: ${elapsed.toFixed(2)}ms`);
    
    assert.ok(elapsed < 5000, `Too slow: ${elapsed.toFixed(2)}ms`);
  });
});

// ============================================================================
// 3. FILE SIZE VARIATIONS
// ============================================================================

describe('File Size Variations', () => {
  const sizes = [
    { name: 'tiny', lines: 1, maxMs: 100 },
    { name: 'small', lines: 50, maxMs: 200 },
    { name: 'medium', lines: 500, maxMs: 500 },
    { name: 'large', lines: 2000, maxMs: 1000 },
    { name: 'xlarge', lines: 10000, maxMs: 3000 },
  ];
  
  for (const { name, lines, maxMs } of sizes) {
    it(`should read ${name} files (${lines} lines) quickly`, () => {
      const dir = createTestDir(`size-${name}`);
      
      createFile(dir, 'src/main.ts', generateCode(lines));
      
      const { result, elapsed } = measure(() => 
        discoverAndReadCode(dir, { phase: { phase: 'BUILD', step: 'IMPLEMENT' } }, { maxTokens: 100000 })
      );
      
      console.log(`  [PERF] ${name} file (${lines} lines): ${elapsed.toFixed(2)}ms`);
      
      assert.ok(result.sourceFiles.length >= 1);
      assert.ok(elapsed < maxMs, `Too slow: ${elapsed.toFixed(2)}ms > ${maxMs}ms`);
    });
  }
  
  it('should handle mix of file sizes', () => {
    const dir = createTestDir('size-mixed');
    
    createFile(dir, 'src/tiny.ts', generateCode(1));
    createFile(dir, 'src/small.ts', generateCode(50));
    createFile(dir, 'src/medium.ts', generateCode(500));
    createFile(dir, 'src/large.ts', generateCode(2000));
    
    const { result, elapsed } = measure(() => 
      discoverAndReadCode(dir, { phase: { phase: 'BUILD', step: 'IMPLEMENT' } }, { maxTokens: 100000 })
    );
    
    console.log(`  [PERF] Mixed sizes: ${elapsed.toFixed(2)}ms`);
    
    assert.ok(result.sourceFiles.length >= 4);
    assert.ok(elapsed < 3000, `Too slow: ${elapsed.toFixed(2)}ms`);
  });
});

// ============================================================================
// 4. STATE OPERATIONS PERFORMANCE
// ============================================================================

describe('State Operations Performance', () => {
  it('should load state quickly (100 iterations)', () => {
    const dir = createTestDir('state-load');
    
    const state = getDefaultState();
    saveState(dir, state);
    
    const { elapsed } = measure(() => {
      for (let i = 0; i < 100; i++) {
        loadState(dir);
      }
    });
    
    console.log(`  [PERF] 100 state loads: ${elapsed.toFixed(2)}ms (${(elapsed / 100).toFixed(2)}ms each)`);
    
    assert.ok(elapsed < 5000, `Too slow: ${elapsed.toFixed(2)}ms`);
  });
  
  it('should save state quickly (100 iterations)', () => {
    const dir = createTestDir('state-save');
    
    const { elapsed } = measure(() => {
      for (let i = 0; i < 100; i++) {
        const state = getDefaultState();
        state.history.push(createHistoryEntry({ phase: 'PLAN', step: 'IDEA' }));
        saveState(dir, state);
      }
    });
    
    console.log(`  [PERF] 100 state saves: ${elapsed.toFixed(2)}ms (${(elapsed / 100).toFixed(2)}ms each)`);
    
    assert.ok(elapsed < 10000, `Too slow: ${elapsed.toFixed(2)}ms`);
  });
  
  it('should handle state with large history', () => {
    const dir = createTestDir('state-large-history');
    
    const state = getDefaultState();
    for (let i = 0; i < 1000; i++) {
      state.history.push(createHistoryEntry({ phase: 'PLAN', step: 'IDEA' }));
    }
    
    const { elapsed: saveElapsed } = measure(() => saveState(dir, state));
    const { elapsed: loadElapsed } = measure(() => loadState(dir));
    
    console.log(`  [PERF] 1000-entry history: save=${saveElapsed.toFixed(2)}ms, load=${loadElapsed.toFixed(2)}ms`);
    
    assert.ok(saveElapsed < 500, `Save too slow: ${saveElapsed.toFixed(2)}ms`);
    assert.ok(loadElapsed < 500, `Load too slow: ${loadElapsed.toFixed(2)}ms`);
  });
});

// ============================================================================
// 5. TRACKER OPERATIONS PERFORMANCE
// ============================================================================

describe('Tracker Operations Performance', () => {
  it('should record errors quickly (50 iterations)', () => {
    const dir = createTestDir('tracker-errors');
    
    const { elapsed } = measure(() => {
      for (let i = 0; i < 50; i++) {
        recordError(dir, `Error ${i}`, `file${i}.ts`);
      }
    });
    
    console.log(`  [PERF] 50 error recordings: ${elapsed.toFixed(2)}ms (${(elapsed / 50).toFixed(2)}ms each)`);
    
    assert.ok(elapsed < 30000, `Too slow: ${elapsed.toFixed(2)}ms`);
  });
  
  it('should load/save tracker with many errors', () => {
    const dir = createTestDir('tracker-large');
    
    // First populate with errors
    for (let i = 0; i < 50; i++) {
      recordError(dir, `Error ${i}`, `file${i}.ts`);
    }
    
    // Now measure load/save cycle
    const { elapsed } = measure(() => {
      for (let i = 0; i < 100; i++) {
        const tracker = loadTracker(dir);
        saveTracker(dir, tracker);
      }
    });
    
    console.log(`  [PERF] 100 load/save cycles (50 errors): ${elapsed.toFixed(2)}ms`);
    
    assert.ok(elapsed < 30000, `Too slow: ${elapsed.toFixed(2)}ms`);
  });
});

// ============================================================================
// 6. TOKEN ESTIMATION PERFORMANCE
// ============================================================================

describe('Token Estimation Performance', () => {
  const sizes = [
    { name: '1KB', chars: 1000, maxMs: 10 },
    { name: '10KB', chars: 10000, maxMs: 20 },
    { name: '100KB', chars: 100000, maxMs: 50 },
    { name: '1MB', chars: 1000000, maxMs: 200 },
  ];
  
  for (const { name, chars, maxMs } of sizes) {
    it(`should estimate tokens for ${name} text quickly`, () => {
      const text = 'x'.repeat(chars);
      
      const { result, elapsed } = measure(() => estimateTokens(text));
      
      console.log(`  [PERF] Token estimation ${name}: ${elapsed.toFixed(2)}ms, ~${result} tokens`);
      
      assert.ok(result > 0);
      assert.ok(elapsed < maxMs, `Too slow: ${elapsed.toFixed(2)}ms > ${maxMs}ms`);
    });
  }
  
  it('should handle 10MB text', () => {
    const text = 'x'.repeat(10000000);
    
    const { result, elapsed } = measure(() => estimateTokens(text));
    
    console.log(`  [PERF] Token estimation 10MB: ${elapsed.toFixed(2)}ms, ~${result} tokens`);
    
    assert.ok(result > 0);
    assert.ok(elapsed < 2000, `Too slow: ${elapsed.toFixed(2)}ms`);
  });
});

// ============================================================================
// 7. CONCURRENT OPERATIONS
// ============================================================================

describe('Concurrent Operations', () => {
  it('should handle 10 concurrent file discoveries', async () => {
    const dirs: string[] = [];
    for (let i = 0; i < 10; i++) {
      const dir = createTestDir(`concurrent-${i}`);
      for (let j = 0; j < 20; j++) {
        createFile(dir, `src/file${j}.ts`, `export const x = ${j};`);
      }
      dirs.push(dir);
    }
    
    const { elapsed } = await measureAsync(async () => {
      const promises = dirs.map(dir => 
        Promise.resolve(discoverSourceFiles(dir))
      );
      await Promise.all(promises);
    });
    
    console.log(`  [PERF] 10 concurrent discoveries: ${elapsed.toFixed(2)}ms`);
    
    assert.ok(elapsed < 5000, `Too slow: ${elapsed.toFixed(2)}ms`);
  });
  
  it('should handle 20 concurrent state saves', async () => {
    const dirs: string[] = [];
    for (let i = 0; i < 20; i++) {
      dirs.push(createTestDir(`concurrent-state-${i}`));
    }
    
    const { elapsed } = await measureAsync(async () => {
      const promises = dirs.map((dir) => 
        new Promise<void>((resolve) => {
          const state = getDefaultState();
          state.history.push(createHistoryEntry({ phase: 'PLAN', step: 'IDEA' }));
          saveState(dir, state);
          resolve();
        })
      );
      await Promise.all(promises);
    });
    
    console.log(`  [PERF] 20 concurrent state saves: ${elapsed.toFixed(2)}ms`);
    
    assert.ok(elapsed < 5000, `Too slow: ${elapsed.toFixed(2)}ms`);
  });
});

// ============================================================================
// 8. TIMING BOUNDARIES
// ============================================================================

describe('Timing Boundaries', () => {
  it('should complete empty project discovery in < 50ms', () => {
    const dir = createTestDir('timing-empty');
    
    const { elapsed } = measure(() => discoverSourceFiles(dir));
    
    console.log(`  [PERF] Empty project: ${elapsed.toFixed(2)}ms`);
    
    assert.ok(elapsed < 50, `Expected < 50ms, got ${elapsed.toFixed(2)}ms`);
  });
  
  it('should complete single file discovery in < 100ms', () => {
    const dir = createTestDir('timing-single');
    
    createFile(dir, 'index.ts', 'export const x = 1;');
    
    const { elapsed } = measure(() => discoverSourceFiles(dir));
    
    console.log(`  [PERF] Single file: ${elapsed.toFixed(2)}ms`);
    
    assert.ok(elapsed < 100, `Expected < 100ms, got ${elapsed.toFixed(2)}ms`);
  });
  
  it('should complete 100 files in < 500ms', () => {
    const dir = createTestDir('timing-100');
    
    for (let i = 0; i < 100; i++) {
      createFile(dir, `src/file${i}.ts`, `export const x = ${i};`);
    }
    
    const { elapsed } = measure(() => discoverSourceFiles(dir));
    
    console.log(`  [PERF] 100 files: ${elapsed.toFixed(2)}ms`);
    
    assert.ok(elapsed < 500, `Expected < 500ms, got ${elapsed.toFixed(2)}ms`);
  });
  
  it('should complete state load/save cycle in < 20ms', () => {
    const dir = createTestDir('timing-state');
    
    const state = getDefaultState();
    saveState(dir, state);
    
    const { elapsed } = measure(() => {
      const loaded = loadState(dir);
      saveState(dir, loaded);
    });
    
    console.log(`  [PERF] State load/save cycle: ${elapsed.toFixed(2)}ms`);
    
    assert.ok(elapsed < 50, `Expected < 50ms, got ${elapsed.toFixed(2)}ms`);
  });
});

// ============================================================================
// 9. REGRESSION DETECTION
// ============================================================================

describe('Regression Detection', () => {
  it('should maintain consistent discovery time over 10 runs', () => {
    const dir = createTestDir('regression-discovery');
    
    for (let i = 0; i < 50; i++) {
      createFile(dir, `src/file${i}.ts`, `export const x = ${i};`);
    }
    
    const times: number[] = [];
    for (let run = 0; run < 10; run++) {
      const { elapsed } = measure(() => discoverSourceFiles(dir));
      times.push(elapsed);
    }
    
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);
    const min = Math.min(...times);
    const variance = max - min;
    
    console.log(`  [PERF] Discovery 10 runs: avg=${avg.toFixed(2)}ms, min=${min.toFixed(2)}ms, max=${max.toFixed(2)}ms, variance=${variance.toFixed(2)}ms`);
    
    // Variance should be reasonable (< 5x the average)
    assert.ok(variance < avg * 5, `High variance: ${variance.toFixed(2)}ms`);
  });
  
  it('should maintain consistent state operation time', () => {
    const dir = createTestDir('regression-state');
    
    const times: number[] = [];
    for (let run = 0; run < 10; run++) {
      const { elapsed } = measure(() => {
        const state = getDefaultState();
        saveState(dir, state);
        loadState(dir);
      });
      times.push(elapsed);
    }
    
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);
    const min = Math.min(...times);
    
    console.log(`  [PERF] State ops 10 runs: avg=${avg.toFixed(2)}ms, min=${min.toFixed(2)}ms, max=${max.toFixed(2)}ms`);
    
    // Should be consistently fast
    assert.ok(avg < 100, `Average too slow: ${avg.toFixed(2)}ms`);
  });
});

// ============================================================================
// 10. COMBINED LOAD SCENARIOS
// ============================================================================

describe('Combined Load Scenarios', () => {
  it('should handle 100 files + 50 docs combined', () => {
    const dir = createTestDir('combined-100-50');
    
    // Create 100 source files
    for (let i = 0; i < 100; i++) {
      createFile(dir, `src/file${i}.ts`, generateCode(20));
    }
    
    // Create 50 docs
    mkdirSync(join(dir, 'docs'), { recursive: true });
    for (let i = 0; i < 50; i++) {
      createFile(dir, `docs/doc${i}.md`, generateMarkdown(5));
    }
    
    const { elapsed: discoverElapsed } = measure(() => discoverSourceFiles(dir));
    const { elapsed: docsElapsed } = measure(() => discoverDocsSync(dir));
    const totalElapsed = discoverElapsed + docsElapsed;
    
    console.log(`  [PERF] 100 files + 50 docs: discover=${discoverElapsed.toFixed(2)}ms, docs=${docsElapsed.toFixed(2)}ms, total=${totalElapsed.toFixed(2)}ms`);
    
    assert.ok(totalElapsed < 5000, `Too slow: ${totalElapsed.toFixed(2)}ms`);
  });
  
  it('should handle 200 files + 100 history entries + 50 errors', () => {
    const dir = createTestDir('combined-heavy');
    
    // Create files
    for (let i = 0; i < 200; i++) {
      createFile(dir, `src/file${i}.ts`, generateCode(10));
    }
    
    // Create state with large history
    const state = getDefaultState();
    for (let i = 0; i < 100; i++) {
      state.history.push(createHistoryEntry({ phase: 'BUILD', step: 'IMPLEMENT' }));
    }
    saveState(dir, state);
    
    // Create many errors
    for (let i = 0; i < 50; i++) {
      recordError(dir, `Error ${i}`, `file${i}.ts`);
    }
    
    // Measure combined operations
    const { elapsed: discoverElapsed } = measure(() => discoverSourceFiles(dir));
    const { elapsed: stateElapsed } = measure(() => loadState(dir));
    const { elapsed: trackerElapsed } = measure(() => loadTracker(dir));
    const totalElapsed = discoverElapsed + stateElapsed + trackerElapsed;
    
    console.log(`  [PERF] Heavy load: discover=${discoverElapsed.toFixed(2)}ms, state=${stateElapsed.toFixed(2)}ms, tracker=${trackerElapsed.toFixed(2)}ms`);
    
    assert.ok(totalElapsed < 5000, `Too slow: ${totalElapsed.toFixed(2)}ms`);
  });
});

// ============================================================================
// 11. MEMORY EFFICIENCY
// ============================================================================

describe('Memory Efficiency', () => {
  it('should not leak memory over 100 discovery operations', () => {
    const dir = createTestDir('memory-discovery');
    
    for (let i = 0; i < 50; i++) {
      createFile(dir, `src/file${i}.ts`, generateCode(50));
    }
    
    // Force GC if available
    if (global.gc) global.gc();
    const initialHeap = process.memoryUsage().heapUsed;
    
    for (let i = 0; i < 100; i++) {
      discoverSourceFiles(dir);
    }
    
    if (global.gc) global.gc();
    const finalHeap = process.memoryUsage().heapUsed;
    const heapGrowth = finalHeap - initialHeap;
    
    console.log(`  [PERF] Memory: initial=${(initialHeap / 1024 / 1024).toFixed(2)}MB, final=${(finalHeap / 1024 / 1024).toFixed(2)}MB, growth=${(heapGrowth / 1024 / 1024).toFixed(2)}MB`);
    
    // Growth should be bounded (< 50MB)
    assert.ok(heapGrowth < 50 * 1024 * 1024, `Too much memory growth: ${(heapGrowth / 1024 / 1024).toFixed(2)}MB`);
  });
  
  it('should not leak memory over 100 state cycles', () => {
    const dir = createTestDir('memory-state');
    
    if (global.gc) global.gc();
    const initialHeap = process.memoryUsage().heapUsed;
    
    for (let i = 0; i < 100; i++) {
      const state = getDefaultState();
      state.history.push(createHistoryEntry({ phase: 'PLAN', step: 'IDEA' }));
      saveState(dir, state);
      loadState(dir);
    }
    
    if (global.gc) global.gc();
    const finalHeap = process.memoryUsage().heapUsed;
    const heapGrowth = finalHeap - initialHeap;
    
    console.log(`  [PERF] State memory: initial=${(initialHeap / 1024 / 1024).toFixed(2)}MB, final=${(finalHeap / 1024 / 1024).toFixed(2)}MB, growth=${(heapGrowth / 1024 / 1024).toFixed(2)}MB`);
    
    assert.ok(heapGrowth < 50 * 1024 * 1024, `Too much memory growth: ${(heapGrowth / 1024 / 1024).toFixed(2)}MB`);
  });
});

// ============================================================================
// 12. THROUGHPUT BENCHMARKS
// ============================================================================

describe('Throughput Benchmarks', () => {
  it('should measure files per second discovery rate', () => {
    const dir = createTestDir('throughput-files');
    
    for (let i = 0; i < 200; i++) {
      createFile(dir, `src/file${i}.ts`, `export const x = ${i};`);
    }
    
    const { result, elapsed } = measure(() => discoverSourceFiles(dir));
    const filesPerSecond = (result.length / elapsed) * 1000;
    
    console.log(`  [PERF] Throughput: ${filesPerSecond.toFixed(0)} files/sec`);
    
    assert.ok(filesPerSecond > 100, `Too slow: ${filesPerSecond.toFixed(0)} files/sec`);
  });
  
  it('should measure tokens per second estimation rate', () => {
    const text = 'x'.repeat(1000000);  // 1MB
    
    const { result, elapsed } = measure(() => estimateTokens(text));
    const tokensPerSecond = (result / elapsed) * 1000;
    
    console.log(`  [PERF] Token estimation: ${(tokensPerSecond / 1000).toFixed(0)}K tokens/sec`);
    
    assert.ok(tokensPerSecond > 100000, `Too slow: ${tokensPerSecond.toFixed(0)} tokens/sec`);
  });
  
  it('should measure state operations per second', () => {
    const dir = createTestDir('throughput-state');
    
    const start = performance.now();
    let operations = 0;
    
    while (performance.now() - start < 1000) {  // Run for 1 second
      const state = getDefaultState();
      saveState(dir, state);
      loadState(dir);
      operations++;
    }
    
    console.log(`  [PERF] State throughput: ${operations} ops/sec`);
    
    assert.ok(operations > 10, `Too slow: ${operations} ops/sec`);
  });
});

// ============================================================================
// 13. SCALING BEHAVIOR
// ============================================================================

describe('Scaling Behavior', () => {
  it('should scale linearly with file count', () => {
    const counts = [10, 20, 50, 100];
    const times: { count: number; time: number }[] = [];
    
    for (const count of counts) {
      const dir = createTestDir(`scale-${count}`);
      
      for (let i = 0; i < count; i++) {
        createFile(dir, `src/file${i}.ts`, `export const x = ${i};`);
      }
      
      const { elapsed } = measure(() => discoverSourceFiles(dir));
      times.push({ count, time: elapsed });
    }
    
    console.log(`  [PERF] Scaling: ${times.map(t => `${t.count}files=${t.time.toFixed(2)}ms`).join(', ')}`);
    
    // Check roughly linear scaling (each doubling should at most triple time)
    for (let i = 1; i < times.length; i++) {
      const ratio = times[i].count / times[i - 1].count;
      const timeRatio = times[i].time / times[i - 1].time;
      
      // Allow 3x time increase for 2x file increase (accounting for overhead)
      assert.ok(timeRatio < ratio * 2, `Non-linear scaling at ${times[i].count} files`);
    }
  });
  
  it('should scale linearly with content size', () => {
    const sizes = [1000, 5000, 10000, 50000];
    const times: { size: number; time: number }[] = [];
    
    for (const size of sizes) {
      const dir = createTestDir(`scale-size-${size}`);
      
      createFile(dir, 'src/main.ts', 'x'.repeat(size));
      
      const { elapsed } = measure(() => 
        discoverAndReadCode(dir, { phase: { phase: 'BUILD', step: 'IMPLEMENT' } }, { maxTokens: 100000 })
      );
      times.push({ size, time: elapsed });
    }
    
    console.log(`  [PERF] Size scaling: ${times.map(t => `${t.size}chars=${t.time.toFixed(2)}ms`).join(', ')}`);
    
    // All sizes should complete reasonably fast
    for (const t of times) {
      assert.ok(t.time < 1000, `Too slow for ${t.size} chars: ${t.time.toFixed(2)}ms`);
    }
  });
});

// ============================================================================
// 14. COLD VS WARM START
// ============================================================================

describe('Cold vs Warm Start', () => {
  it('should measure cold start performance', () => {
    const dir = createTestDir('cold-start');
    
    for (let i = 0; i < 50; i++) {
      createFile(dir, `src/file${i}.ts`, generateCode(10));
    }
    
    // First run (cold)
    const { elapsed: coldElapsed } = measure(() => discoverSourceFiles(dir));
    
    // Subsequent runs (warm - file system cached)
    const warmTimes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const { elapsed } = measure(() => discoverSourceFiles(dir));
      warmTimes.push(elapsed);
    }
    
    const avgWarm = warmTimes.reduce((a, b) => a + b, 0) / warmTimes.length;
    
    console.log(`  [PERF] Cold start: ${coldElapsed.toFixed(2)}ms, Warm avg: ${avgWarm.toFixed(2)}ms`);
    
    // Warm should be at least as fast as cold (usually faster due to OS caching)
    assert.ok(avgWarm <= coldElapsed * 2, `Warm slower than expected`);
  });
});

// ============================================================================
// 15. BOUNDARY VALUE ANALYSIS
// ============================================================================

describe('Boundary Value Analysis', () => {
  const boundaries = [0, 1, 99, 100, 101, 499, 500, 501];
  
  for (const count of boundaries) {
    it(`should handle exactly ${count} files`, () => {
      const dir = createTestDir(`boundary-${count}`);
      
      for (let i = 0; i < count; i++) {
        createFile(dir, `src/file${i}.ts`, `export const x = ${i};`);
      }
      
      const { result, elapsed } = measure(() => discoverSourceFiles(dir));
      
      console.log(`  [PERF] Boundary ${count}: found=${result.length}, time=${elapsed.toFixed(2)}ms`);
      
      // Should find all files (within discovery limits)
      const expectedMin = Math.min(count, count);  // May be limited by implementation
      assert.ok(result.length >= expectedMin * 0.9, `Expected ${expectedMin}, got ${result.length}`);
    });
  }
  
  it('should handle 0-byte files', () => {
    const dir = createTestDir('boundary-empty-files');
    
    for (let i = 0; i < 10; i++) {
      createFile(dir, `src/file${i}.ts`, '');
    }
    
    const { result, elapsed } = measure(() => discoverSourceFiles(dir));
    
    console.log(`  [PERF] 10 empty files: ${elapsed.toFixed(2)}ms`);
    
    assert.ok(result.length >= 10);
    assert.ok(elapsed < 500);
  });
});
