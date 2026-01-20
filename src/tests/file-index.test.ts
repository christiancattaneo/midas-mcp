/**
 * File Index Tests
 * 
 * Tests for the lightweight file indexing module.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  loadIndex,
  saveIndex,
  hashFile,
  hasFileChanged,
  getChangedFiles,
  extractSymbols,
  indexFile,
  updateIndex,
  getCachedMetadata,
  cleanupIndex,
  getIndexStats,
  searchSymbols,
} from '../file-index.js';

// ============================================================================
// HELPERS
// ============================================================================

let testDirs: string[] = [];

function createTestDir(name: string): string {
  const dir = join(tmpdir(), `midas-index-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, '.midas'), { recursive: true });
  testDirs.push(dir);
  return dir;
}

function cleanup(): void {
  for (const dir of testDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
  testDirs = [];
}

afterEach(cleanup);

// ============================================================================
// LOAD/SAVE INDEX
// ============================================================================

describe('File Index - Load/Save', () => {
  it('should create empty index for new project', () => {
    const dir = createTestDir('empty');
    const index = loadIndex(dir);
    
    assert.strictEqual(index.version, 1);
    assert.strictEqual(Object.keys(index.files).length, 0);
    assert.strictEqual(index.totalFiles, 0);
  });
  
  it('should persist and reload index', () => {
    const dir = createTestDir('persist');
    const index = loadIndex(dir);
    
    index.files['test.ts'] = {
      hash: 'abc123',
      size: 100,
      mtime: Date.now(),
      lastIndexed: Date.now(),
      symbols: ['foo', 'bar'],
      imports: ['./utils'],
    };
    
    saveIndex(dir, index);
    
    const reloaded = loadIndex(dir);
    assert.strictEqual(Object.keys(reloaded.files).length, 1);
    assert.deepStrictEqual(reloaded.files['test.ts'].symbols, ['foo', 'bar']);
  });
  
  it('should handle corrupted index gracefully', () => {
    const dir = createTestDir('corrupted');
    writeFileSync(join(dir, '.midas', 'file-index.json'), 'not valid json');
    
    const index = loadIndex(dir);
    assert.strictEqual(index.version, 1);
    assert.strictEqual(Object.keys(index.files).length, 0);
  });
});

// ============================================================================
// FILE HASHING
// ============================================================================

describe('File Index - Hashing', () => {
  it('should generate consistent hash for same content', () => {
    const dir = createTestDir('hash');
    const filePath = join(dir, 'test.ts');
    writeFileSync(filePath, 'const x = 1;');
    
    const hash1 = hashFile(filePath);
    const hash2 = hashFile(filePath);
    
    assert.strictEqual(hash1, hash2);
    assert.ok(hash1.length > 0);
  });
  
  it('should generate different hash for different content', () => {
    const dir = createTestDir('hash-diff');
    const filePath = join(dir, 'test.ts');
    
    writeFileSync(filePath, 'const x = 1;');
    const hash1 = hashFile(filePath);
    
    writeFileSync(filePath, 'const x = 2;');
    const hash2 = hashFile(filePath);
    
    assert.notStrictEqual(hash1, hash2);
  });
  
  it('should handle missing file', () => {
    const hash = hashFile('/nonexistent/file.ts');
    assert.strictEqual(hash, '');
  });
});

// ============================================================================
// CHANGE DETECTION
// ============================================================================

describe('File Index - Change Detection', () => {
  it('should detect new file as changed', () => {
    const dir = createTestDir('new-file');
    const filePath = join(dir, 'test.ts');
    writeFileSync(filePath, 'const x = 1;');
    
    const index = loadIndex(dir);
    const changed = hasFileChanged(filePath, index);
    
    assert.strictEqual(changed, true);
  });
  
  it('should detect unchanged file', () => {
    const dir = createTestDir('unchanged');
    const filePath = join(dir, 'test.ts');
    writeFileSync(filePath, 'const x = 1;');
    
    // Index the file
    updateIndex(['test.ts'], dir);
    
    // Check again - pass relative path for lookup
    const index = loadIndex(dir);
    const changed = hasFileChanged(filePath, index, 'test.ts');
    
    assert.strictEqual(changed, false);
  });
  
  it('should detect modified file', () => {
    const dir = createTestDir('modified');
    const filePath = join(dir, 'test.ts');
    writeFileSync(filePath, 'const x = 1;');
    
    // Index the file
    updateIndex(['test.ts'], dir);
    
    // Modify the file
    writeFileSync(filePath, 'const x = 2;');
    
    // Check again - pass relative path for lookup
    const index = loadIndex(dir);
    const changed = hasFileChanged(filePath, index, 'test.ts');
    
    assert.strictEqual(changed, true);
  });
  
  it('should batch check changed files', () => {
    const dir = createTestDir('batch');
    writeFileSync(join(dir, 'a.ts'), 'const a = 1;');
    writeFileSync(join(dir, 'b.ts'), 'const b = 2;');
    writeFileSync(join(dir, 'c.ts'), 'const c = 3;');
    
    // Index two files
    updateIndex(['a.ts', 'b.ts'], dir);
    
    // Check all three
    const result = getChangedFiles(['a.ts', 'b.ts', 'c.ts'], dir);
    
    assert.strictEqual(result.unchanged.length, 2);
    assert.strictEqual(result.changed.length, 1);
    assert.ok(result.changed.includes('c.ts'));
  });
});

// ============================================================================
// SYMBOL EXTRACTION
// ============================================================================

describe('File Index - Symbol Extraction', () => {
  it('should extract TypeScript functions', () => {
    const content = `
      function foo() {}
      const bar = () => {};
      const baz = async function() {};
      export function qux() {}
    `;
    
    const { symbols } = extractSymbols(content, '.ts');
    
    assert.ok(symbols.includes('foo'));
    assert.ok(symbols.includes('bar'));
    assert.ok(symbols.includes('baz'));
    assert.ok(symbols.includes('qux'));
  });
  
  it('should extract TypeScript classes', () => {
    const content = `
      class MyClass {}
      export class ExportedClass {}
    `;
    
    const { symbols } = extractSymbols(content, '.ts');
    
    assert.ok(symbols.includes('MyClass'));
    assert.ok(symbols.includes('ExportedClass'));
  });
  
  it('should extract TypeScript imports', () => {
    const content = `
      import { foo } from './utils';
      import bar from '../lib';
      import type { Baz } from 'external';
    `;
    
    const { imports } = extractSymbols(content, '.ts');
    
    assert.ok(imports.includes('./utils'));
    assert.ok(imports.includes('../lib'));
    assert.ok(imports.includes('external'));
  });
  
  it('should extract Python functions and classes', () => {
    const content = `
def hello():
    pass

class MyClass:
    def method(self):
        pass

from os import path
import sys
    `;
    
    const { symbols, imports } = extractSymbols(content, '.py');
    
    assert.ok(symbols.includes('hello'));
    assert.ok(symbols.includes('MyClass'));
    assert.ok(symbols.includes('method'));
    assert.ok(imports.includes('os'));
    assert.ok(imports.includes('sys'));
  });
  
  it('should extract Rust symbols', () => {
    const content = `
fn main() {}
pub fn public_func() {}
struct MyStruct {}
enum MyEnum {}
use std::io;
    `;
    
    const { symbols, imports } = extractSymbols(content, '.rs');
    
    assert.ok(symbols.includes('main'));
    assert.ok(symbols.includes('public_func'));
    assert.ok(symbols.includes('MyStruct'));
    assert.ok(symbols.includes('MyEnum'));
    assert.ok(imports.some(i => i.includes('std::io')));
  });
  
  it('should extract Go symbols', () => {
    const content = `
package main

func main() {}
func (r Receiver) Method() {}
type MyType struct {}
import "fmt"
    `;
    
    const { symbols, imports } = extractSymbols(content, '.go');
    
    assert.ok(symbols.includes('main'));
    assert.ok(symbols.includes('Method'));
    assert.ok(symbols.includes('MyType'));
    assert.ok(imports.includes('fmt'));
  });
  
  it('should handle empty content', () => {
    const { symbols, imports } = extractSymbols('', '.ts');
    
    assert.strictEqual(symbols.length, 0);
    assert.strictEqual(imports.length, 0);
  });
  
  it('should deduplicate symbols', () => {
    const content = `
      function foo() {}
      export function foo() {}
      export { foo };
    `;
    
    const { symbols } = extractSymbols(content, '.ts');
    
    const fooCount = symbols.filter(s => s === 'foo').length;
    assert.strictEqual(fooCount, 1);
  });
});

// ============================================================================
// INDEX OPERATIONS
// ============================================================================

describe('File Index - Index Operations', () => {
  it('should index a single file', () => {
    const dir = createTestDir('single');
    writeFileSync(join(dir, 'test.ts'), 'export function hello() { return "world"; }');
    
    const metadata = indexFile('test.ts', dir);
    
    assert.ok(metadata);
    assert.ok(metadata.hash.length > 0);
    assert.ok(metadata.symbols.includes('hello'));
    assert.ok(metadata.lineCount! >= 1);
  });
  
  it('should update index for multiple files', () => {
    const dir = createTestDir('multiple');
    writeFileSync(join(dir, 'a.ts'), 'export function a() {}');
    writeFileSync(join(dir, 'b.ts'), 'export function b() {}');
    
    const result = updateIndex(['a.ts', 'b.ts'], dir);
    
    assert.strictEqual(result.updated, 2);
    assert.strictEqual(result.cached, 0);
    
    // Check index
    const index = loadIndex(dir);
    assert.ok(index.files['a.ts']);
    assert.ok(index.files['b.ts']);
  });
  
  it('should cache unchanged files on second run', () => {
    const dir = createTestDir('cache');
    writeFileSync(join(dir, 'a.ts'), 'export function a() {}');
    
    // First run
    updateIndex(['a.ts'], dir);
    
    // Second run (no changes)
    const result = updateIndex(['a.ts'], dir);
    
    assert.strictEqual(result.cached, 1);
    assert.strictEqual(result.updated, 0);
  });
  
  it('should get cached metadata', () => {
    const dir = createTestDir('get-cached');
    writeFileSync(join(dir, 'test.ts'), 'export const x = 1;');
    
    updateIndex(['test.ts'], dir);
    
    const cached = getCachedMetadata('test.ts', dir);
    
    assert.ok(cached);
    assert.ok(cached.hash);
    assert.ok(cached.symbols.includes('x'));
  });
});

// ============================================================================
// CLEANUP
// ============================================================================

describe('File Index - Cleanup', () => {
  it('should remove entries for deleted files', () => {
    const dir = createTestDir('cleanup');
    writeFileSync(join(dir, 'test.ts'), 'const x = 1;');
    
    updateIndex(['test.ts'], dir);
    
    // Delete the file
    rmSync(join(dir, 'test.ts'));
    
    // Cleanup
    const result = cleanupIndex(dir);
    
    assert.strictEqual(result.removed, 1);
    
    const index = loadIndex(dir);
    assert.strictEqual(Object.keys(index.files).length, 0);
  });
});

// ============================================================================
// SYMBOL SEARCH
// ============================================================================

describe('File Index - Symbol Search', () => {
  it('should search symbols by name', () => {
    const dir = createTestDir('search');
    writeFileSync(join(dir, 'auth.ts'), 'export function login() {} export function logout() {}');
    writeFileSync(join(dir, 'api.ts'), 'export function fetchLogin() {}');
    
    updateIndex(['auth.ts', 'api.ts'], dir);
    
    const results = searchSymbols('login', dir);
    
    assert.ok(results.length >= 2);
    // Exact match should score higher
    const exactMatch = results.find(r => r.symbol === 'login');
    const partialMatch = results.find(r => r.symbol === 'fetchLogin');
    assert.ok(exactMatch);
    assert.ok(partialMatch);
    assert.ok(exactMatch!.score > partialMatch!.score);
  });
  
  it('should limit search results', () => {
    const dir = createTestDir('search-limit');
    
    // Create file with many symbols
    const symbols = Array.from({ length: 50 }, (_, i) => `export function func${i}() {}`).join('\n');
    writeFileSync(join(dir, 'many.ts'), symbols);
    
    updateIndex(['many.ts'], dir);
    
    const results = searchSymbols('func', dir, 10);
    
    assert.strictEqual(results.length, 10);
  });
  
  it('should handle no matches', () => {
    const dir = createTestDir('no-match');
    writeFileSync(join(dir, 'test.ts'), 'export function hello() {}');
    
    updateIndex(['test.ts'], dir);
    
    const results = searchSymbols('nonexistent', dir);
    
    assert.strictEqual(results.length, 0);
  });
});

// ============================================================================
// STATS
// ============================================================================

describe('File Index - Stats', () => {
  it('should return index statistics', () => {
    const dir = createTestDir('stats');
    writeFileSync(join(dir, 'a.ts'), 'export function foo() {} export function bar() {}');
    writeFileSync(join(dir, 'b.ts'), 'export class Baz {}');
    
    updateIndex(['a.ts', 'b.ts'], dir);
    
    const stats = getIndexStats(dir);
    
    assert.strictEqual(stats.indexed, 2);
    assert.ok(stats.symbols >= 3);
    assert.ok(stats.lastScan > 0);
  });
});
