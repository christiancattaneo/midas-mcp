/**
 * Empty/Null Data Stress Tests
 * 
 * Comprehensive testing of empty and null data handling:
 * - Empty projects (no files)
 * - Dotfiles-only projects
 * - Missing package.json
 * - Invalid/empty package.json
 * - Empty directories
 * - Null/undefined values
 * - Whitespace-only content
 * - Missing fields and schema violations
 * 
 * Based on defensive programming best practices.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, chmodSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Import functions to test
import { discoverAndReadCode, discoverSourceFiles } from '../code-discovery.js';
import { discoverDocsSync } from '../docs-discovery.js';
import { loadState, getDefaultState, saveState } from '../state/phase.js';
import { loadTracker } from '../tracker.js';
import { inferProjectProfile, getPreflightChecks } from '../preflight.js';
import { estimateTokens } from '../context.js';

// Helper to get default tracker (not exported)
function getDefaultTrackerLocal() {
  return {
    errorMemory: [],
    suggestionHistory: [],
    recentToolCalls: [],
    currentTask: null,
    lastAnalysis: null,
    _version: 0,
    _lastModified: new Date().toISOString(),
    _processId: '',
  };
}

// ============================================================================
// HELPERS
// ============================================================================

let testDirs: string[] = [];

function createTestDir(prefix: string): string {
  const dir = join(tmpdir(), `midas-empty-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
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
// 1. COMPLETELY EMPTY PROJECTS
// ============================================================================

describe('Completely Empty Projects', () => {
  it('should handle empty project directory', () => {
    const dir = createTestDir('empty');
    // No files created
    
    const result = discoverAndReadCode(dir, {});
    
    assert.ok(Array.isArray(result.files), 'Should return files array');
    assert.strictEqual(result.files.length, 0, 'Should find no files');
  });

  it('should handle empty project for docs discovery', () => {
    const dir = createTestDir('empty-docs');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null, 'Should return result object');
    assert.ok(result.prd === null || result.prd === undefined, 'Should have no prd');
    assert.ok(result.gameplan === null || result.gameplan === undefined, 'Should have no gameplan');
  });

  it('should handle empty project for state loading', () => {
    const dir = createTestDir('empty-state');
    // No .midas directory
    
    const state = loadState(dir);
    
    assert.ok(state !== null, 'Should return state object');
    assert.ok(state.current !== undefined, 'Should have current phase');
    assert.strictEqual(state.current.phase, 'IDLE', 'Should be IDLE phase');
  });

  it('should handle empty project for tracker loading', () => {
    const dir = createTestDir('empty-tracker');
    
    const tracker = loadTracker(dir);
    
    assert.ok(tracker !== null, 'Should return tracker object');
    assert.ok(Array.isArray(tracker.errorMemory), 'Should have errorMemory array');
  });

  it('should handle empty project for profile inference', async () => {
    const dir = createTestDir('empty-profile');
    
    const profile = await inferProjectProfile(dir);
    
    assert.ok(profile !== null, 'Should return profile object');
    assert.strictEqual(profile.collectsUserData, false, 'Should default to no user data');
    assert.strictEqual(profile.hasPayments, false, 'Should default to no payments');
  });

  it('should handle project with only empty subdirectories', () => {
    const dir = createTestDir('empty-subdirs');
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'lib'));
    mkdirSync(join(dir, 'test'));
    mkdirSync(join(dir, 'docs'));
    // All subdirectories are empty
    
    const result = discoverAndReadCode(dir, {});
    
    assert.strictEqual(result.files.length, 0, 'Should find no files in empty subdirs');
  });

  it('should handle deeply nested empty directories', () => {
    const dir = createTestDir('deep-empty');
    let path = dir;
    for (let i = 0; i < 20; i++) {
      path = join(path, `level${i}`);
    }
    mkdirSync(path, { recursive: true });
    // Deep structure but no files
    
    const result = discoverAndReadCode(dir, {});
    
    assert.strictEqual(result.files.length, 0, 'Should find no files in deep empty dirs');
  });
});

// ============================================================================
// 2. DOTFILES-ONLY PROJECTS
// ============================================================================

describe('Dotfiles-Only Projects', () => {
  it('should handle project with only .gitignore', () => {
    const dir = createTestDir('dotfiles-gitignore');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\ndist/');
    
    const result = discoverAndReadCode(dir, {});
    
    // Dotfiles should typically be ignored
    assert.ok(result.files.length === 0 || result.files.every(f => !f.path.startsWith('.')));
  });

  it('should handle project with only .env', () => {
    const dir = createTestDir('dotfiles-env');
    writeFileSync(join(dir, '.env'), 'API_KEY=secret\nDB_URL=localhost');
    
    const result = discoverAndReadCode(dir, {});
    
    // .env should be ignored (contains secrets)
    assert.ok(result.files.every(f => !f.path.includes('.env')));
  });

  it('should handle project with multiple dotfiles', () => {
    const dir = createTestDir('dotfiles-multiple');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/');
    writeFileSync(join(dir, '.env'), 'SECRET=value');
    writeFileSync(join(dir, '.editorconfig'), 'root = true');
    writeFileSync(join(dir, '.prettierrc'), '{}');
    writeFileSync(join(dir, '.eslintrc'), '{}');
    writeFileSync(join(dir, '.npmrc'), 'registry=https://registry.npmjs.org/');
    
    const result = discoverAndReadCode(dir, {});
    
    // Should not crash, may find some config files but should ignore .env and .gitignore
    assert.ok(Array.isArray(result.files), 'Should return files array');
    assert.ok(result.files.every(f => !f.path.includes('.env')), 'Should ignore .env');
    assert.ok(result.files.every(f => !f.path.includes('.gitignore')), 'Should ignore .gitignore');
  });

  it('should handle .git directory (should ignore)', () => {
    const dir = createTestDir('dotfiles-git');
    mkdirSync(join(dir, '.git', 'objects'), { recursive: true });
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main');
    writeFileSync(join(dir, '.git', 'config'), '[core]\n\trepositoryformatversion = 0');
    
    const result = discoverAndReadCode(dir, {});
    
    // .git directory should be completely ignored
    assert.ok(result.files.every(f => !f.path.includes('.git')));
  });

  it('should handle dotfiles in subdirectories', () => {
    const dir = createTestDir('dotfiles-nested');
    mkdirSync(join(dir, 'config'));
    writeFileSync(join(dir, 'config', '.secret'), 'hidden');
    mkdirSync(join(dir, '.hidden'));
    writeFileSync(join(dir, '.hidden', 'file.txt'), 'also hidden');
    
    const result = discoverAndReadCode(dir, {});
    
    assert.strictEqual(result.files.length, 0, 'Should ignore nested dotfiles');
  });

  it('should handle mixed dotfiles and visible files', () => {
    const dir = createTestDir('dotfiles-mixed');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/');
    writeFileSync(join(dir, '.env'), 'SECRET=value');
    writeFileSync(join(dir, 'index.ts'), 'console.log("hello");');
    writeFileSync(join(dir, 'README.md'), '# Project');
    
    const result = discoverAndReadCode(dir, {});
    
    // Should find visible files, ignore dotfiles
    assert.ok(result.files.length > 0, 'Should find visible files');
    assert.ok(result.files.every(f => !f.path.startsWith('.') && !f.path.includes('/.')));
  });
});

// ============================================================================
// 3. MISSING PACKAGE.JSON
// ============================================================================

describe('Missing package.json', () => {
  it('should handle project with source files but no package.json', () => {
    const dir = createTestDir('no-pkg');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.ts'), 'export const x = 1;');
    writeFileSync(join(dir, 'README.md'), '# Project');
    
    const result = discoverAndReadCode(dir, {});
    
    assert.ok(result.files.length > 0, 'Should still find source files');
  });

  it('should handle profile inference without package.json', async () => {
    const dir = createTestDir('no-pkg-profile');
    writeFileSync(join(dir, 'README.md'), '# My App\n\nThis app uses payments.');
    
    const profile = await inferProjectProfile(dir);
    
    assert.ok(profile !== null, 'Should return profile');
    // Should still try to infer from README
  });

  it('should handle project with package-lock.json but no package.json', () => {
    const dir = createTestDir('lock-only');
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({
      name: 'test',
      lockfileVersion: 3,
      packages: {},
    }, null, 2));
    
    const result = discoverAndReadCode(dir, {});
    
    // Should not crash
    assert.ok(Array.isArray(result.files));
  });

  it('should handle project with node_modules but no package.json', () => {
    const dir = createTestDir('modules-only');
    mkdirSync(join(dir, 'node_modules', 'some-package'), { recursive: true });
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'some-package', 'index.js'), 'module.exports = {}');
    writeFileSync(join(dir, 'src', 'index.ts'), 'import x from "some-package";');
    
    const result = discoverAndReadCode(dir, {});
    
    // Should ignore node_modules
    assert.ok(result.files.every(f => !f.path.includes('node_modules')));
  });
});

// ============================================================================
// 4. INVALID PACKAGE.JSON
// ============================================================================

describe('Invalid package.json', () => {
  it('should handle empty package.json (empty object)', async () => {
    const dir = createTestDir('pkg-empty-obj');
    writeFileSync(join(dir, 'package.json'), '{}');
    
    const profile = await inferProjectProfile(dir);
    
    assert.ok(profile !== null, 'Should not crash on empty package.json');
  });

  it('should handle package.json with only whitespace', async () => {
    const dir = createTestDir('pkg-whitespace');
    writeFileSync(join(dir, 'package.json'), '   \n\t\n   ');
    
    const profile = await inferProjectProfile(dir);
    
    assert.ok(profile !== null, 'Should handle whitespace-only package.json');
  });

  it('should handle package.json that is empty file', async () => {
    const dir = createTestDir('pkg-empty-file');
    writeFileSync(join(dir, 'package.json'), '');
    
    const profile = await inferProjectProfile(dir);
    
    assert.ok(profile !== null, 'Should handle empty package.json file');
  });

  it('should handle package.json with invalid JSON', async () => {
    const dir = createTestDir('pkg-invalid');
    writeFileSync(join(dir, 'package.json'), '{ name: "missing quotes" }');
    
    const profile = await inferProjectProfile(dir);
    
    assert.ok(profile !== null, 'Should handle invalid JSON in package.json');
  });

  it('should handle package.json with trailing comma', async () => {
    const dir = createTestDir('pkg-trailing');
    writeFileSync(join(dir, 'package.json'), '{ "name": "test", }');
    
    const profile = await inferProjectProfile(dir);
    
    assert.ok(profile !== null, 'Should handle trailing comma');
  });

  it('should handle package.json with null name', async () => {
    const dir = createTestDir('pkg-null-name');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: null, version: '1.0.0' }));
    
    const profile = await inferProjectProfile(dir);
    
    assert.ok(profile !== null, 'Should handle null name');
  });

  it('should handle package.json with null dependencies', async () => {
    const dir = createTestDir('pkg-null-deps');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'test',
      dependencies: null,
      devDependencies: null,
    }));
    
    const profile = await inferProjectProfile(dir);
    
    assert.ok(profile !== null, 'Should handle null dependencies');
  });

  it('should handle package.json with empty dependencies', async () => {
    const dir = createTestDir('pkg-empty-deps');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'test',
      dependencies: {},
      devDependencies: {},
    }));
    
    const profile = await inferProjectProfile(dir);
    
    assert.ok(profile !== null, 'Should handle empty dependencies');
  });

  it('should handle package.json with only scripts', async () => {
    const dir = createTestDir('pkg-scripts-only');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      scripts: {
        test: 'jest',
        build: 'tsc',
      },
    }));
    
    const profile = await inferProjectProfile(dir);
    
    assert.ok(profile !== null, 'Should handle scripts-only package.json');
  });

  it('should handle package.json with binary content', async () => {
    const dir = createTestDir('pkg-binary');
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);
    writeFileSync(join(dir, 'package.json'), binaryContent);
    
    const profile = await inferProjectProfile(dir);
    
    assert.ok(profile !== null, 'Should handle binary package.json');
  });
});

// ============================================================================
// 5. EMPTY FILES
// ============================================================================

describe('Empty Files', () => {
  it('should handle empty TypeScript file', () => {
    const dir = createTestDir('empty-ts');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.ts'), '');
    
    const result = discoverAndReadCode(dir, {});
    
    assert.ok(result.files.length > 0 || result.files.length === 0);
    // Should not crash
  });

  it('should handle empty JavaScript file', () => {
    const dir = createTestDir('empty-js');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.js'), '');
    
    const result = discoverAndReadCode(dir, {});
    
    // Should not crash
    assert.ok(Array.isArray(result.files));
  });

  it('should handle empty markdown file', () => {
    const dir = createTestDir('empty-md');
    writeFileSync(join(dir, 'README.md'), '');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle empty JSON file', () => {
    const dir = createTestDir('empty-json');
    writeFileSync(join(dir, 'config.json'), '');
    
    const result = discoverAndReadCode(dir, {});
    
    assert.ok(Array.isArray(result.files));
  });

  it('should handle mix of empty and non-empty files', () => {
    const dir = createTestDir('mixed-empty');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'empty.ts'), '');
    writeFileSync(join(dir, 'src', 'full.ts'), 'export const x = 1;');
    writeFileSync(join(dir, 'src', 'also-empty.ts'), '');
    
    const result = discoverAndReadCode(dir, {});
    
    assert.ok(result.files.length > 0, 'Should find files');
  });

  it('should handle file with only whitespace', () => {
    const dir = createTestDir('whitespace-only');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'spaces.ts'), '    \n\n\t\t\n    ');
    
    const result = discoverAndReadCode(dir, {});
    
    assert.ok(Array.isArray(result.files));
  });

  it('should handle file with only newlines', () => {
    const dir = createTestDir('newlines-only');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'newlines.ts'), '\n\n\n\n\n\n\n\n\n\n');
    
    const result = discoverAndReadCode(dir, {});
    
    assert.ok(Array.isArray(result.files));
  });

  it('should handle file with only comments', () => {
    const dir = createTestDir('comments-only');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'comments.ts'), '// This is a comment\n/* Block comment */');
    
    const result = discoverAndReadCode(dir, {});
    
    assert.ok(result.files.length >= 0);
  });
});

// ============================================================================
// 6. NULL/UNDEFINED VALUES IN STATE
// ============================================================================

describe('Null/Undefined Values in State', () => {
  it('should handle state.json with null current', () => {
    const dir = createTestDir('state-null-current');
    mkdirSync(join(dir, '.midas'));
    writeFileSync(join(dir, '.midas', 'state.json'), JSON.stringify({ current: null }));
    
    const state = loadState(dir);
    
    assert.ok(state !== null);
    assert.ok(state.current !== null, 'Should provide default current');
  });

  it('should handle state.json with null history', () => {
    const dir = createTestDir('state-null-history');
    mkdirSync(join(dir, '.midas'));
    writeFileSync(join(dir, '.midas', 'state.json'), JSON.stringify({
      current: { phase: 'IDLE' },
      history: null,
    }));
    
    const state = loadState(dir);
    
    assert.ok(Array.isArray(state.history), 'Should provide default history array');
  });

  it('should handle state.json with undefined fields (missing)', () => {
    const dir = createTestDir('state-missing-fields');
    mkdirSync(join(dir, '.midas'));
    writeFileSync(join(dir, '.midas', 'state.json'), JSON.stringify({
      current: { phase: 'BUILD', step: 'IMPLEMENT' },
      // history, docs, etc. are missing
    }));
    
    const state = loadState(dir);
    
    assert.ok(Array.isArray(state.history), 'Should have history array');
    assert.ok(state.docs !== undefined, 'Should have docs object');
  });

  it('should handle tracker.json with null errorMemory', () => {
    const dir = createTestDir('tracker-null-errors');
    mkdirSync(join(dir, '.midas'));
    writeFileSync(join(dir, '.midas', 'tracker.json'), JSON.stringify({
      errorMemory: null,
    }));
    
    const tracker = loadTracker(dir);
    
    assert.ok(Array.isArray(tracker.errorMemory), 'Should provide default errorMemory');
  });

  it('should handle tracker.json with null fields throughout', () => {
    const dir = createTestDir('tracker-all-null');
    mkdirSync(join(dir, '.midas'));
    writeFileSync(join(dir, '.midas', 'tracker.json'), JSON.stringify({
      currentTask: null,
      lastAnalysis: null,
      errorMemory: null,
      suggestionHistory: null,
      recentToolCalls: null,
    }));
    
    const tracker = loadTracker(dir);
    
    assert.ok(tracker !== null);
    assert.ok(Array.isArray(tracker.errorMemory));
    assert.ok(Array.isArray(tracker.suggestionHistory));
  });

  it('should handle completely null state file', () => {
    const dir = createTestDir('state-just-null');
    mkdirSync(join(dir, '.midas'));
    writeFileSync(join(dir, '.midas', 'state.json'), 'null');
    
    const state = loadState(dir);
    
    assert.ok(state !== null, 'Should return default state');
    assert.ok(state.current !== undefined);
  });
});

// ============================================================================
// 7. EMPTY ARRAYS AND OBJECTS
// ============================================================================

describe('Empty Arrays and Objects', () => {
  it('should handle state with empty history', () => {
    const dir = createTestDir('empty-history');
    mkdirSync(join(dir, '.midas'));
    const state = getDefaultState();
    state.history = [];
    writeFileSync(join(dir, '.midas', 'state.json'), JSON.stringify(state));
    
    const loaded = loadState(dir);
    
    assert.ok(Array.isArray(loaded.history));
    assert.strictEqual(loaded.history.length, 0);
  });

  it('should handle tracker with empty arrays', () => {
    const dir = createTestDir('empty-tracker-arrays');
    mkdirSync(join(dir, '.midas'));
    const tracker = getDefaultTrackerLocal();
    tracker.errorMemory = [];
    tracker.suggestionHistory = [];
    writeFileSync(join(dir, '.midas', 'tracker.json'), JSON.stringify(tracker));
    
    const loaded = loadTracker(dir);
    
    assert.strictEqual(loaded.errorMemory.length, 0);
    assert.strictEqual(loaded.suggestionHistory.length, 0);
  });

  it('should handle empty docs object', () => {
    const dir = createTestDir('empty-docs-obj');
    mkdirSync(join(dir, '.midas'));
    const state = getDefaultState();
    state.docs = { prd: false, gameplan: false };
    writeFileSync(join(dir, '.midas', 'state.json'), JSON.stringify(state));
    
    const loaded = loadState(dir);
    
    assert.ok(loaded.docs !== undefined);
    assert.strictEqual(loaded.docs.prd, false);
  });

  it('should handle package.json with empty arrays', async () => {
    const dir = createTestDir('pkg-empty-arrays');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'test',
      keywords: [],
      files: [],
      workspaces: [],
    }));
    
    const profile = await inferProjectProfile(dir);
    
    assert.ok(profile !== null);
  });
});

// ============================================================================
// 8. WHITESPACE AND SPECIAL STRINGS
// ============================================================================

describe('Whitespace and Special Strings', () => {
  it('should handle empty string estimateTokens', () => {
    const result = estimateTokens('');
    assert.strictEqual(result, 0);
  });

  it('should handle whitespace-only string estimateTokens', () => {
    const result = estimateTokens('   \n\t\n   ');
    assert.ok(result >= 0);
  });

  it('should handle null-like strings', () => {
    const result1 = estimateTokens('null');
    const result2 = estimateTokens('undefined');
    const result3 = estimateTokens('NaN');
    
    assert.ok(result1 > 0);
    assert.ok(result2 > 0);
    assert.ok(result3 > 0);
  });

  it('should handle strings with only control characters', () => {
    const result = estimateTokens('\x00\x01\x02\x03\x04\x05');
    assert.ok(result >= 0);
  });

  it('should handle strings with only unicode spaces', () => {
    // Various unicode space characters
    const unicodeSpaces = '\u00A0\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000';
    const result = estimateTokens(unicodeSpaces);
    assert.ok(result >= 0);
  });
});

// ============================================================================
// 9. MINIMAL VALID PROJECTS
// ============================================================================

describe('Minimal Valid Projects', () => {
  it('should handle project with single file', () => {
    const dir = createTestDir('single-file');
    writeFileSync(join(dir, 'index.ts'), 'export const x = 1;');
    
    const result = discoverAndReadCode(dir, {});
    
    assert.ok(result.files.length >= 1);
  });

  it('should handle project with minimal package.json', async () => {
    const dir = createTestDir('minimal-pkg');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    
    const profile = await inferProjectProfile(dir);
    
    assert.ok(profile !== null);
  });

  it('should handle project with only README', () => {
    const dir = createTestDir('readme-only');
    writeFileSync(join(dir, 'README.md'), '# Test Project\n\nThis is a test.');
    
    const result = discoverDocsSync(dir);
    
    assert.ok(result !== null);
  });

  it('should handle project with only LICENSE', () => {
    const dir = createTestDir('license-only');
    writeFileSync(join(dir, 'LICENSE'), 'MIT License\n\nCopyright...');
    
    const result = discoverAndReadCode(dir, {});
    
    assert.ok(Array.isArray(result.files));
  });

  it('should handle project with only tsconfig.json', () => {
    const dir = createTestDir('tsconfig-only');
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true },
    }));
    
    const result = discoverAndReadCode(dir, {});
    
    assert.ok(Array.isArray(result.files));
  });
});

// ============================================================================
// 10. REALITY CHECKS WITH EMPTY DATA
// ============================================================================

describe('Reality Checks with Empty Data', () => {
  it('should handle reality checks with empty profile', async () => {
    const dir = createTestDir('reality-empty');
    
    const checks = await getPreflightChecks(dir);
    
    assert.ok(checks !== null);
    assert.ok(Array.isArray(checks.checks));
  });

  it('should handle reality checks with minimal profile', async () => {
    const dir = createTestDir('reality-minimal');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    
    const checks = await getPreflightChecks(dir);
    
    assert.ok(checks !== null);
  });

  it('should handle reality checks with empty brainlift', async () => {
    const dir = createTestDir('reality-empty-brainlift');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'brainlift.md'), '');
    
    const checks = await getPreflightChecks(dir);
    
    assert.ok(checks !== null);
  });
});

// ============================================================================
// 11. EDGE CASE COMBINATIONS
// ============================================================================

describe('Edge Case Combinations', () => {
  it('should handle empty folder + .gitignore only', () => {
    const dir = createTestDir('combo-gitignore');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n*.log');
    
    const result = discoverAndReadCode(dir, {});
    const docs = discoverDocsSync(dir);
    
    assert.ok(Array.isArray(result.files));
    assert.ok(docs !== null);
  });

  it('should handle nested empty folders with one deep file', () => {
    const dir = createTestDir('combo-deep-file');
    const deepPath = join(dir, 'a', 'b', 'c', 'd', 'e');
    mkdirSync(deepPath, { recursive: true });
    writeFileSync(join(deepPath, 'index.ts'), 'export const x = 1;');
    
    const result = discoverAndReadCode(dir, {});
    
    assert.ok(result.files.length >= 1);
  });

  it('should handle mix: dotfiles + empty package.json + one source file', async () => {
    const dir = createTestDir('combo-mixed');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/');
    writeFileSync(join(dir, '.env'), 'SECRET=x');
    writeFileSync(join(dir, 'package.json'), '{}');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.ts'), 'console.log("hello");');
    
    const result = discoverAndReadCode(dir, {});
    const profile = await inferProjectProfile(dir);
    
    assert.ok(result.files.length >= 1);
    assert.ok(profile !== null);
  });

  it('should handle all empty but valid structure', () => {
    const dir = createTestDir('combo-structure');
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'tests'));
    mkdirSync(join(dir, 'docs'));
    mkdirSync(join(dir, 'lib'));
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'README.md'), '');
    // All directories empty, files empty
    
    const result = discoverAndReadCode(dir, {});
    const docs = discoverDocsSync(dir);
    
    assert.ok(result !== null);
    assert.ok(docs !== null);
  });
});

// ============================================================================
// 12. PERFORMANCE WITH EMPTY DATA
// ============================================================================

describe('Performance with Empty Data', () => {
  it('should be fast for empty project', () => {
    const dir = createTestDir('perf-empty');
    
    const start = Date.now();
    discoverAndReadCode(dir, {});
    discoverDocsSync(dir);
    loadState(dir);
    loadTracker(dir);
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] Empty project operations: ${elapsed}ms`);
    assert.ok(elapsed < 1000, `Too slow for empty project: ${elapsed}ms`);
  });

  it('should be fast for dotfiles-only project', () => {
    const dir = createTestDir('perf-dotfiles');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/');
    writeFileSync(join(dir, '.env'), 'SECRET=x');
    writeFileSync(join(dir, '.editorconfig'), 'root = true');
    
    const start = Date.now();
    discoverAndReadCode(dir, {});
    discoverDocsSync(dir);
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] Dotfiles-only project: ${elapsed}ms`);
    assert.ok(elapsed < 1000, `Too slow: ${elapsed}ms`);
  });

  it('should handle many empty files quickly', () => {
    const dir = createTestDir('perf-many-empty');
    mkdirSync(join(dir, 'src'));
    
    for (let i = 0; i < 100; i++) {
      writeFileSync(join(dir, 'src', `empty${i}.ts`), '');
    }
    
    const start = Date.now();
    const result = discoverAndReadCode(dir, {});
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 100 empty files: ${elapsed}ms, found: ${result.files.length}`);
    assert.ok(elapsed < 5000, `Too slow: ${elapsed}ms`);
  });
});

// ============================================================================
// 13. DISCOVER SOURCE FILES EDGE CASES
// ============================================================================

describe('Discover Source Files Edge Cases', () => {
  it('should handle discoverSourceFiles on empty dir', () => {
    const dir = createTestDir('scan-empty');
    
    const files = discoverSourceFiles(dir);
    
    assert.ok(Array.isArray(files));
    assert.strictEqual(files.length, 0);
  });

  it('should handle discoverSourceFiles on dotfiles-only', () => {
    const dir = createTestDir('scan-dotfiles');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/');
    writeFileSync(join(dir, '.env'), 'SECRET=x');
    
    const files = discoverSourceFiles(dir);
    
    assert.ok(Array.isArray(files));
    // Should ignore dotfiles
    assert.ok(files.every(f => !f.path.startsWith('.')));
  });

  it('should handle discoverSourceFiles with only config files', () => {
    const dir = createTestDir('scan-config');
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'tsconfig.json'), '{}');
    writeFileSync(join(dir, '.eslintrc.json'), '{}');
    
    const files = discoverSourceFiles(dir);
    
    // Should find config files
    assert.ok(Array.isArray(files));
  });
});
