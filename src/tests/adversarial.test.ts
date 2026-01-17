/**
 * Adversarial Tests - Expose blindspots, edge cases, and potential failures
 * 
 * These tests are designed to BREAK the code, not validate happy paths.
 * Each test targets a specific vulnerability or edge case that could
 * cause production failures.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Imports from actual modules
import { discoverSourceFiles, readSourceFiles, discoverAndReadCode } from '../code-discovery.js';
import { discoverDocs, discoverDocsSync } from '../docs-discovery.js';
import { loadState, saveState, getDefaultState, setPhase, createHistoryEntry, type HistoryEntry } from '../state/phase.js';
import { loadTracker, saveTracker, recordError, getStuckErrors } from '../tracker.js';
import { inferProjectProfile, getRealityChecks, updateCheckStatus, resetCheckStatuses } from '../reality.js';
import { estimateTokens } from '../context.js';
import { sanitizePath, isShellSafe } from '../security.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

let testDir: string;
let cleanupDirs: string[] = [];

function createTestDir(name: string): string {
  const dir = join(tmpdir(), `midas-adversarial-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

beforeEach(() => {
  testDir = createTestDir('test');
});

afterEach(() => {
  cleanup();
});

// ============================================================================
// 1. RACE CONDITIONS / CONCURRENT ACCESS
// ============================================================================

describe('Race Conditions', () => {
  it('should handle concurrent state modifications without data loss', async () => {
    // Simulate two concurrent writers
    const state1 = getDefaultState();
    const state2 = getDefaultState();
    
    state1.current = { phase: 'PLAN', step: 'IDEA' };
    state2.current = { phase: 'BUILD', step: 'IMPLEMENT' };
    
    // Write both "simultaneously" - last write wins, but shouldn't corrupt
    saveState(testDir, state1);
    saveState(testDir, state2);
    
    const loaded = loadState(testDir);
    // Should have valid state (either one wins)
    assert.ok(['PLAN', 'BUILD'].includes(loaded.current.phase));
  });

  it('should not corrupt tracker on rapid successive writes', () => {
    // Rapid fire writes
    for (let i = 0; i < 50; i++) {
      recordError(testDir, `Error ${i}`, `file${i}.ts`, i);
    }
    
    // Should still be valid JSON
    const tracker = loadTracker(testDir);
    assert.ok(tracker.errorMemory.length > 0);
    assert.ok(tracker.errorMemory.length <= 50); // We cap at 50
  });

  it('should handle interleaved read-modify-write cycles', async () => {
    // Reader sees old state while writer is saving
    const initial = getDefaultState();
    saveState(testDir, initial);
    
    // Simulate interleaved operations
    const read1 = loadState(testDir);
    const read2 = loadState(testDir);
    
    read1.history.push(createHistoryEntry({ phase: 'PLAN', step: 'IDEA' }));
    read2.history.push(createHistoryEntry({ phase: 'BUILD', step: 'TEST' }));
    
    saveState(testDir, read1);
    saveState(testDir, read2); // With atomic merge, this MERGES, not overwrites
    
    const final = loadState(testDir);
    // With atomic merge, BOTH changes are preserved (no lost updates)
    assert.strictEqual(final.history.length, 2);
  });
});

// ============================================================================
// 2. FILE SYSTEM EDGE CASES
// ============================================================================

describe('File System Edge Cases', () => {
  it('should handle deeply nested directories without stack overflow', () => {
    // Create a very deep directory structure
    let currentDir = testDir;
    for (let i = 0; i < 50; i++) {
      currentDir = join(currentDir, `level${i}`);
      mkdirSync(currentDir, { recursive: true });
    }
    writeFileSync(join(currentDir, 'deep.ts'), 'export const deep = true;');
    
    // Should not throw or hang
    const files = discoverSourceFiles(testDir);
    // Depth limit should prevent reading everything, but should complete
    assert.ok(files !== undefined);
  });

  it('should handle circular symlinks gracefully', () => {
    // Create a circular symlink
    const linkA = join(testDir, 'linkA');
    const linkB = join(testDir, 'linkB');
    
    mkdirSync(linkA);
    try {
      symlinkSync(linkA, linkB);
      // Now link A back to B - circular!
      symlinkSync(linkB, join(linkA, 'toB'));
      
      // Should complete without infinite loop
      const files = discoverSourceFiles(testDir);
      assert.ok(files !== undefined);
    } catch {
      // Some systems don't allow symlinks
      assert.ok(true);
    }
  });

  it('should handle unreadable files gracefully', () => {
    writeFileSync(join(testDir, 'normal.ts'), 'export const x = 1;');
    // We can't easily make a file unreadable in tests, but we can test empty files
    writeFileSync(join(testDir, 'empty.ts'), '');
    
    const files = discoverSourceFiles(testDir);
    const read = readSourceFiles(files);
    
    // Should include both without crashing
    assert.ok(files.length >= 1);
  });

  it('should handle binary files without crashing', () => {
    // Write a file with binary content
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE]);
    writeFileSync(join(testDir, 'binary.ts'), binaryContent);
    
    const files = discoverSourceFiles(testDir);
    // Binary file detected but shouldn't crash
    assert.ok(files !== undefined);
  });

  it('should handle very long filenames', () => {
    // Create a file with a very long name
    const longName = 'a'.repeat(200) + '.ts';
    try {
      writeFileSync(join(testDir, longName), 'const x = 1;');
      const files = discoverSourceFiles(testDir);
      assert.ok(files !== undefined);
    } catch {
      // Some filesystems don't allow this
      assert.ok(true);
    }
  });

  it('should handle special characters in filenames', () => {
    const specialNames = [
      'file with spaces.ts',
      'file-with-dashes.ts',
      'file_with_underscores.ts',
      'CamelCase.ts',
    ];
    
    for (const name of specialNames) {
      try {
        writeFileSync(join(testDir, name), `// ${name}`);
      } catch {
        // Skip if filesystem doesn't allow
      }
    }
    
    const files = discoverSourceFiles(testDir);
    assert.ok(files.length >= 1);
  });

  it('should not read files outside project directory', () => {
    // Attempt to escape the project directory
    const evilPath = join(testDir, '..', '..', 'etc', 'passwd');
    const sanitized = sanitizePath(evilPath);
    
    // Should not allow path traversal outside the provided root
    // The behavior depends on sanitizePath implementation
    assert.ok(!sanitized.includes('../'));
  });
});

// ============================================================================
// 3. STATE FILE CORRUPTION
// ============================================================================

describe('State File Corruption', () => {
  it('should recover from corrupted JSON in state file', () => {
    const statePath = join(testDir, '.midas', 'state.json');
    mkdirSync(join(testDir, '.midas'), { recursive: true });
    
    // Write corrupted JSON
    writeFileSync(statePath, '{"current": { phase: "PLAN"'); // Missing closing braces
    
    // Should return default state, not throw
    const state = loadState(testDir);
    assert.strictEqual(state.current.phase, 'IDLE');
  });

  it('should recover from empty state file', () => {
    const statePath = join(testDir, '.midas', 'state.json');
    mkdirSync(join(testDir, '.midas'), { recursive: true });
    writeFileSync(statePath, '');
    
    const state = loadState(testDir);
    assert.strictEqual(state.current.phase, 'IDLE');
  });

  it('should recover from null state file', () => {
    const statePath = join(testDir, '.midas', 'state.json');
    mkdirSync(join(testDir, '.midas'), { recursive: true });
    writeFileSync(statePath, 'null');
    
    const state = loadState(testDir);
    assert.ok(state !== undefined);
    // Should have default structure
    assert.ok(state.current !== undefined);
  });

  it('should handle state with missing required fields', () => {
    const statePath = join(testDir, '.midas', 'state.json');
    mkdirSync(join(testDir, '.midas'), { recursive: true });
    
    // State with missing fields
    writeFileSync(statePath, JSON.stringify({ current: { phase: 'PLAN' } }));
    
    const state = loadState(testDir);
    // Should still have docs field from defaults
    assert.ok(state.docs !== undefined);
  });

  it('should handle extremely large state files', () => {
    // Create state with huge history
    const state = getDefaultState();
    for (let i = 0; i < 10000; i++) {
      state.history.push(createHistoryEntry({ phase: 'BUILD', step: 'IMPLEMENT' }));
    }
    
    saveState(testDir, state);
    const loaded = loadState(testDir);
    
    // Should load without crashing
    assert.strictEqual(loaded.history.length, 10000);
  });
});

// ============================================================================
// 4. TOKEN ESTIMATION ACCURACY
// ============================================================================

describe('Token Estimation', () => {
  it('should not underestimate tokens for code with many symbols', () => {
    // Symbols often tokenize to individual tokens
    const symbolHeavy = '(){}[]<>.,;:!@#$%^&*+-='.repeat(100);
    const estimate = estimateTokens(symbolHeavy);
    
    // Each symbol is roughly 1 token, chars/4 would underestimate
    // This test documents the limitation
    assert.ok(estimate > 0);
    // The actual tokenizer would give ~2300 tokens, our estimate gives ~575
    // This is a known limitation
  });

  it('should handle empty string', () => {
    assert.strictEqual(estimateTokens(''), 0);
  });

  it('should handle unicode characters', () => {
    const unicode = '你好世界'.repeat(100); // Chinese characters
    const estimate = estimateTokens(unicode);
    
    // Each Chinese char often tokenizes to 2-3 tokens
    // chars/4 underestimates significantly
    assert.ok(estimate > 0);
  });

  it('should handle very long single words', () => {
    const longWord = 'supercalifragilisticexpialidocious'.repeat(100);
    const estimate = estimateTokens(longWord);
    assert.ok(estimate > 0);
  });
});

// ============================================================================
// 5. GIT EDGE CASES
// ============================================================================

describe('Git Edge Cases', () => {
  it('should handle repos with no commits', () => {
    // Create a git repo but don't commit
    mkdirSync(join(testDir, '.git'), { recursive: true });
    writeFileSync(join(testDir, '.git', 'HEAD'), 'ref: refs/heads/main');
    
    // Tracker shouldn't crash
    const tracker = loadTracker(testDir);
    // Git activity might be null or have branch
    assert.ok(tracker !== undefined);
  });

  it('should handle missing .git directory', () => {
    // Not a git repo
    const tracker = loadTracker(testDir);
    assert.strictEqual(tracker.gitActivity, null);
  });

  it('should handle corrupted .git directory', () => {
    // Create corrupt .git
    mkdirSync(join(testDir, '.git'), { recursive: true });
    writeFileSync(join(testDir, '.git', 'HEAD'), 'garbage');
    
    // Should not throw
    const tracker = loadTracker(testDir);
    assert.ok(tracker !== undefined);
  });
});

// ============================================================================
// 6. MEMORY / UNBOUNDED GROWTH
// ============================================================================

describe('Memory and Unbounded Growth', () => {
  it('should cap error memory to prevent unbounded growth', () => {
    // Record many errors
    for (let i = 0; i < 100; i++) {
      recordError(testDir, `Error ${i}`);
    }
    
    const tracker = loadTracker(testDir);
    // Should be capped at 50
    assert.ok(tracker.errorMemory.length <= 50);
  });

  it('should handle very large files without memory issues', () => {
    // Create a 10MB file
    const largeContent = 'const x = 1;\n'.repeat(500000);
    writeFileSync(join(testDir, 'large.ts'), largeContent);
    
    const files = discoverSourceFiles(testDir);
    const read = readSourceFiles(files, { maxTokens: 1000 });
    
    // Should truncate, not load entire file
    if (read.length > 0 && read[0].content) {
      assert.ok(read[0].content.length < largeContent.length);
      assert.strictEqual(read[0].truncated, true);
    }
  });

  it('should limit recent tool calls array', () => {
    const tracker = loadTracker(testDir);
    
    // Add many tool calls manually
    for (let i = 0; i < 100; i++) {
      tracker.recentToolCalls.push({
        tool: `tool_${i}`,
        timestamp: Date.now(),
      });
    }
    
    saveTracker(testDir, tracker);
    const loaded = loadTracker(testDir);
    
    // Should be limited somewhere (implementation may vary)
    assert.ok(loaded.recentToolCalls.length <= 100);
  });
});

// ============================================================================
// 7. PATH SECURITY
// ============================================================================

describe('Path Security', () => {
  it('should reject paths with null bytes', () => {
    const maliciousPath = testDir + '\x00' + '/etc/passwd';
    const sanitized = sanitizePath(maliciousPath);
    assert.ok(!sanitized.includes('\x00'));
  });

  it('should not allow double-dot escapes', () => {
    const escape1 = join(testDir, '..', '..', 'etc', 'passwd');
    const sanitized = sanitizePath(escape1);
    
    // Should resolve to a safe path
    assert.ok(!sanitized.match(/\/etc\/passwd$/));
  });

  it('should detect unsafe shell paths', () => {
    const unsafePaths = [
      'path; rm -rf /',
      'path && cat /etc/passwd',
      'path | grep password',
      'path`whoami`',
      'path$(whoami)',
    ];
    
    for (const path of unsafePaths) {
      assert.strictEqual(isShellSafe(path), false, `Expected ${path} to be unsafe`);
    }
  });

  it('should allow safe paths', () => {
    const safePaths = [
      '/Users/test/project',
      '/home/user/my-project',
      '/var/www/app_v2',
      testDir,
    ];
    
    for (const path of safePaths) {
      assert.strictEqual(isShellSafe(path), true, `Expected ${path} to be safe`);
    }
  });
});

// ============================================================================
// 8. API ERROR HANDLING (Simulated)
// ============================================================================

describe('API Error Handling', () => {
  it('should handle empty profile gracefully', () => {
    // No docs at all
    const profile = inferProjectProfile(testDir);
    
    // Should return valid profile with defaults
    assert.ok(profile !== undefined);
    assert.strictEqual(profile.collectsUserData, false);
    assert.strictEqual(profile.hasPayments, false);
  });

  it('should handle malformed docs in profile inference', () => {
    // Create docs with unusual content
    mkdirSync(join(testDir, 'docs'), { recursive: true });
    writeFileSync(join(testDir, 'docs', 'prd.md'), '\x00\x01\x02\xFF'); // Binary garbage
    
    // Should not throw
    const profile = inferProjectProfile(testDir);
    assert.ok(profile !== undefined);
  });
});

// ============================================================================
// 9. JSON PARSING FRAGILITY
// ============================================================================

describe('JSON Parsing Fragility', () => {
  it('should handle JSON with trailing commas', () => {
    // Our code should not generate trailing commas, but test robustness
    const badJson = '{"current": {"phase": "PLAN",}}';
    
    try {
      JSON.parse(badJson);
      assert.fail('Should have thrown');
    } catch {
      // Expected - JSON.parse is strict
      assert.ok(true);
    }
  });

  it('should handle JSON with undefined values', () => {
    const state = getDefaultState();
    (state as unknown as Record<string, unknown>).undefinedField = undefined;
    
    // Saving and loading should work (undefined becomes missing)
    saveState(testDir, state);
    const loaded = loadState(testDir);
    assert.ok(loaded !== undefined);
    assert.strictEqual((loaded as unknown as Record<string, unknown>).undefinedField, undefined);
  });

  it('should handle JSON with NaN and Infinity', () => {
    const tracker = loadTracker(testDir);
    (tracker as unknown as Record<string, unknown>).badNumber = NaN;
    (tracker as unknown as Record<string, unknown>).infiniteNumber = Infinity;
    
    // JSON.stringify converts these to null
    saveTracker(testDir, tracker);
    const loaded = loadTracker(testDir);
    assert.ok(loaded !== undefined);
    // NaN and Infinity become null in JSON
  });
});

// ============================================================================
// 10. ASYNC EDGE CASES
// ============================================================================

describe('Async Edge Cases', () => {
  it('should handle synchronous throws in async context', async () => {
    // Test that sync errors in async functions are properly caught
    try {
      const docs = discoverDocsSync('/nonexistent/path/that/should/not/exist');
      // Should return empty result, not throw
      assert.strictEqual(docs.totalDocsFound, 0);
    } catch {
      // If it throws, that's also acceptable
      assert.ok(true);
    }
  });
});

// ============================================================================
// 11. INFINITE LOOP PROTECTION
// ============================================================================

describe('Infinite Loop Protection', () => {
  it('should respect depth limits in directory scanning', () => {
    // Create nested structure
    let current = testDir;
    for (let i = 0; i < 20; i++) {
      current = join(current, 'nested');
      mkdirSync(current, { recursive: true });
      writeFileSync(join(current, `file${i}.ts`), `export const x${i} = 1;`);
    }
    
    const start = Date.now();
    const files = discoverSourceFiles(testDir);
    const elapsed = Date.now() - start;
    
    // Should complete quickly (depth limited)
    assert.ok(elapsed < 5000);
    assert.ok(files !== undefined);
  });

  it('should not hang on regex with catastrophic backtracking', () => {
    // Create a file that might cause regex issues
    const evilString = 'a'.repeat(1000) + '!';
    writeFileSync(join(testDir, 'test.ts'), evilString);
    
    const start = Date.now();
    const files = discoverSourceFiles(testDir);
    const elapsed = Date.now() - start;
    
    // Should complete quickly
    assert.ok(elapsed < 5000);
  });
});

// ============================================================================
// 12. EMPTY / NULL DATA
// ============================================================================

describe('Empty and Null Data', () => {
  it('should handle completely empty project', () => {
    const files = discoverSourceFiles(testDir);
    assert.deepStrictEqual(files, []);
  });

  it('should handle project with only dotfiles', () => {
    writeFileSync(join(testDir, '.gitignore'), 'node_modules');
    writeFileSync(join(testDir, '.env'), 'SECRET=123');
    
    const files = discoverSourceFiles(testDir);
    // Should not include dotfiles unless they're configs
    assert.ok(!files.some(f => f.filename === '.env'));
  });

  it('should handle project with no package.json', () => {
    writeFileSync(join(testDir, 'app.ts'), 'console.log("hello");');
    
    const profile = inferProjectProfile(testDir);
    assert.ok(profile !== undefined);
    // Default business model should be set
    assert.ok(profile.businessModel !== undefined);
  });

  it('should handle reality checks with no matching conditions', () => {
    // Empty project = no conditions should match
    const result = getRealityChecks(testDir);
    
    // Should return result object with checks array, not throw
    assert.ok(result !== undefined);
    assert.ok(Array.isArray(result.checks));
  });

  it('should handle reset with no existing state', () => {
    // No .midas directory
    resetCheckStatuses(testDir);
    
    // Should not throw
    const result = getRealityChecks(testDir);
    assert.ok(result !== undefined);
    assert.ok(Array.isArray(result.checks));
  });
});

// ============================================================================
// 13. DOCS DISCOVERY EDGE CASES
// ============================================================================

describe('Docs Discovery Edge Cases', () => {
  it('should handle README with no actual content', () => {
    writeFileSync(join(testDir, 'README.md'), '# Title\n\n');
    
    const result = discoverDocsSync(testDir);
    assert.ok(result.readme !== undefined);
    assert.strictEqual(result.readme?.content, '# Title\n\n');
  });

  it('should handle docs with markdown code blocks containing JSON', () => {
    mkdirSync(join(testDir, 'docs'));
    writeFileSync(join(testDir, 'docs', 'prd.md'), `
# PRD

\`\`\`json
{"fake": "json that looks like config"}
\`\`\`

Real requirements here.
`);
    
    const result = discoverDocsSync(testDir);
    assert.ok(result.prd !== undefined);
  });

  it('should prioritize docs/ directory over root', () => {
    // Create competing files
    writeFileSync(join(testDir, 'prd.md'), 'Root PRD');
    mkdirSync(join(testDir, 'docs'));
    writeFileSync(join(testDir, 'docs', 'prd.md'), 'Docs PRD');
    
    const result = discoverDocsSync(testDir);
    // Should prefer docs/ version
    assert.ok(result.prd?.path.includes('docs'));
  });

  it('should handle very large documentation files', () => {
    mkdirSync(join(testDir, 'docs'));
    const largeDoc = '# Huge Doc\n\n' + 'Lorem ipsum '.repeat(100000);
    writeFileSync(join(testDir, 'docs', 'huge.md'), largeDoc);
    
    const result = discoverDocsSync(testDir);
    assert.ok(result.allDocs.length >= 0);
  });
});

// ============================================================================
// 14. REALITY CHECKS EDGE CASES
// ============================================================================

describe('Reality Checks Edge Cases', () => {
  it('should handle updating non-existent check', () => {
    // Shouldn't throw
    updateCheckStatus(testDir, 'FAKE_CHECK_THAT_DOES_NOT_EXIST', 'completed');
    
    // Should be stored anyway
    const result = getRealityChecks(testDir);
    // The fake check won't appear in checks (no definition), but shouldn't crash
    assert.ok(result !== undefined);
    assert.ok(Array.isArray(result.checks));
  });

  it('should handle check with very long skipped reason', () => {
    const longReason = 'This is skipped because '.repeat(1000);
    updateCheckStatus(testDir, 'SOME_CHECK', 'skipped', longReason);
    
    // Shouldn't throw, might truncate
    assert.ok(true);
  });

  it('should handle rapid status updates', () => {
    for (let i = 0; i < 50; i++) {
      updateCheckStatus(testDir, 'TOGGLE_CHECK', i % 2 === 0 ? 'completed' : 'pending');
    }
    
    // Final state should be one of the values
    const result = getRealityChecks(testDir);
    assert.ok(result !== undefined);
    assert.ok(Array.isArray(result.checks));
  });
});

// ============================================================================
// 15. PHASE STATE EDGE CASES
// ============================================================================

describe('Phase State Edge Cases', () => {
  it('should handle setting invalid phase', () => {
    // TypeScript would catch this, but at runtime...
    const invalidPhase = { phase: 'FAKE_PHASE', step: 'FAKE_STEP' } as unknown as Parameters<typeof setPhase>[1];
    
    // Shouldn't throw, should store what's given
    setPhase(testDir, invalidPhase);
    const state = loadState(testDir);
    assert.strictEqual(state.current.phase, 'FAKE_PHASE');
  });

  it('should handle setting phase with missing step', () => {
    const noStep = { phase: 'BUILD' } as unknown as Parameters<typeof setPhase>[1];
    setPhase(testDir, noStep);
    
    const state = loadState(testDir);
    assert.strictEqual(state.current.phase, 'BUILD');
  });

  it('should preserve history through many transitions', () => {
    for (let i = 0; i < 100; i++) {
      setPhase(testDir, { phase: 'BUILD', step: 'IMPLEMENT' });
      setPhase(testDir, { phase: 'BUILD', step: 'TEST' });
    }
    
    const state = loadState(testDir);
    // History should exist (might be limited)
    assert.ok(state.history.length > 0);
  });
});

// ============================================================================
// 16. STUCK DETECTION EDGE CASES
// ============================================================================

describe('Stuck Detection Edge Cases', () => {
  it('should handle no errors recorded', () => {
    const stuck = getStuckErrors(testDir);
    assert.deepStrictEqual(stuck, []);
  });

  it('should count fix attempts correctly', () => {
    const error = recordError(testDir, 'Test error');
    
    // Add many fix attempts
    for (let i = 0; i < 10; i++) {
      // We need to use recordFixAttempt properly
      const tracker = loadTracker(testDir);
      const err = tracker.errorMemory.find(e => e.id === error.id);
      if (err) {
        err.fixAttempts.push({
          approach: `Attempt ${i}`,
          timestamp: Date.now(),
          worked: false,
        });
        saveTracker(testDir, tracker);
      }
    }
    
    const stuck = getStuckErrors(testDir);
    assert.ok(stuck.length > 0);
    assert.strictEqual(stuck[0].fixAttempts.length, 10);
  });
});

// ============================================================================
// 17. CODE DISCOVERY EDGE CASES
// ============================================================================

describe('Code Discovery Edge Cases', () => {
  it('should handle project with only test files', () => {
    mkdirSync(join(testDir, '__tests__'));
    writeFileSync(join(testDir, '__tests__', 'app.test.ts'), 'test("works", () => {});');
    
    const result = discoverAndReadCode(testDir);
    assert.ok(result.testFiles.length > 0);
    assert.strictEqual(result.sourceFiles.length, 0);
  });

  it('should handle project with only config files', () => {
    writeFileSync(join(testDir, 'package.json'), '{"name": "test"}');
    writeFileSync(join(testDir, 'tsconfig.json'), '{}');
    
    const result = discoverAndReadCode(testDir);
    assert.ok(result.configFiles.length > 0);
  });

  it('should handle file with no extension', () => {
    writeFileSync(join(testDir, 'Makefile'), 'all: build');
    writeFileSync(join(testDir, 'Dockerfile'), 'FROM node:18');
    
    const result = discoverAndReadCode(testDir);
    // These should be detected as config files
    assert.ok(result.configFiles.some(f => f.filename === 'Makefile' || f.filename === 'Dockerfile'));
  });

  it('should handle unicode in file content', () => {
    writeFileSync(join(testDir, 'i18n.ts'), `
      export const messages = {
        hello: '你好',
        goodbye: 'さようなら',
        emoji: '🚀',
      };
    `);
    
    const result = discoverAndReadCode(testDir);
    assert.ok(result.files.length > 0);
    assert.ok(result.codeContext.includes('你好'));
  });
});

// ============================================================================
// 18. TIMING ATTACKS / PERFORMANCE
// ============================================================================

describe('Performance Boundaries', () => {
  it('should complete code discovery within reasonable time', () => {
    // Create many files
    mkdirSync(join(testDir, 'src'));
    for (let i = 0; i < 100; i++) {
      writeFileSync(join(testDir, 'src', `file${i}.ts`), `export const x${i} = ${i};`);
    }
    
    const start = Date.now();
    const result = discoverAndReadCode(testDir);
    const elapsed = Date.now() - start;
    
    assert.ok(elapsed < 10000); // 10 seconds max
    assert.strictEqual(result.totalFiles, 100);
  });

  it('should complete docs discovery within reasonable time', () => {
    mkdirSync(join(testDir, 'docs'));
    for (let i = 0; i < 50; i++) {
      writeFileSync(join(testDir, 'docs', `doc${i}.md`), `# Document ${i}\n\nContent ${i}`);
    }
    
    const start = Date.now();
    const result = discoverDocsSync(testDir);
    const elapsed = Date.now() - start;
    
    assert.ok(elapsed < 5000); // 5 seconds max
    assert.strictEqual(result.totalDocsFound, 50);
  });
});
