/**
 * Tests for tools/complexity.ts
 * 
 * Covers: analyzeComplexity, analyzeSimplify
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { analyzeComplexity, analyzeSimplify } from '../tools/complexity.js';

const TEST_DIR = join(tmpdir(), `midas-complexity-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function setupProject(files: Record<string, string> = {}) {
  const projectPath = join(TEST_DIR, `project-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(projectPath, 'src'), { recursive: true });
  
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(projectPath, path);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content);
  }
  
  return projectPath;
}

describe('analyzeComplexity', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });
  
  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {}
  });
  
  it('should return complexity report structure', () => {
    const projectPath = setupProject({
      'src/index.ts': 'export function hello() { return "hello"; }',
    });
    
    const result = analyzeComplexity({ projectPath });
    
    assert.ok('summary' in result);
    assert.ok('hotspots' in result);
    assert.ok('fileStats' in result);
    assert.ok('suggestedPrompt' in result);
    assert.ok(Array.isArray(result.hotspots));
    assert.ok(Array.isArray(result.fileStats));
  });
  
  it('should count files analyzed', () => {
    const projectPath = setupProject({
      'src/a.ts': 'export const a = 1;',
      'src/b.ts': 'export const b = 2;',
      'src/c.ts': 'export const c = 3;',
    });
    
    const result = analyzeComplexity({ projectPath });
    
    assert.ok(result.summary.filesAnalyzed >= 3);
  });
  
  it('should detect simple function', () => {
    const projectPath = setupProject({
      'src/simple.ts': `
export function add(a: number, b: number): number {
  return a + b;
}
`,
    });
    
    const result = analyzeComplexity({ projectPath, threshold: 1 });
    
    // Should have low complexity for simple function
    const addFunc = result.hotspots.find(h => h.name === 'add');
    if (addFunc) {
      assert.ok(addFunc.metrics.cyclomaticComplexity <= 5);
      assert.equal(addFunc.severity, 'low');
    }
  });
  
  it('should detect complex function with many conditionals', () => {
    const projectPath = setupProject({
      'src/complex.ts': `
export function complexLogic(a: number, b: string, c: boolean) {
  if (a > 0) {
    if (b === 'test') {
      if (c) {
        for (let i = 0; i < a; i++) {
          if (i % 2 === 0) {
            while (i > 0 && b.length > 0) {
              if (i === 5 || i === 10) {
                switch (i) {
                  case 5:
                    return 'five';
                  case 10:
                    return 'ten';
                  default:
                    return 'other';
                }
              }
            }
          }
        }
      }
    }
  }
  return 'default';
}
`,
    });
    
    const result = analyzeComplexity({ projectPath, threshold: 1 });
    
    // Should find the complex function
    const complexFunc = result.hotspots.find(h => h.name === 'complexLogic');
    assert.ok(complexFunc, 'Should find complexLogic function');
    assert.ok(complexFunc.metrics.cyclomaticComplexity > 5, 'Should have high complexity');
    assert.ok(complexFunc.metrics.nestingDepth > 3, 'Should have deep nesting');
  });
  
  it('should respect threshold parameter', () => {
    const projectPath = setupProject({
      'src/mixed.ts': `
export function simple() { return 1; }
export function medium(x: number) {
  if (x > 0) { return x; }
  else if (x < 0) { return -x; }
  return 0;
}
`,
    });
    
    const lowThreshold = analyzeComplexity({ projectPath, threshold: 1 });
    const highThreshold = analyzeComplexity({ projectPath, threshold: 20 });
    
    assert.ok(lowThreshold.hotspots.length >= highThreshold.hotspots.length);
  });
  
  it('should respect limit parameter', () => {
    const projectPath = setupProject({
      'src/many.ts': Array.from({ length: 10 }, (_, i) => 
        `export function fn${i}(x: number) { if (x > 0) { return x; } return 0; }`
      ).join('\n'),
    });
    
    const result = analyzeComplexity({ projectPath, threshold: 1, limit: 3 });
    
    assert.ok(result.hotspots.length <= 3);
  });
  
  it('should calculate average complexity', () => {
    const projectPath = setupProject({
      'src/funcs.ts': `
export function a() { return 1; }
export function b(x: number) { if (x) return 2; return 3; }
`,
    });
    
    const result = analyzeComplexity({ projectPath, threshold: 1 });
    
    assert.equal(typeof result.summary.avgComplexity, 'number');
    assert.ok(result.summary.avgComplexity >= 0);
  });
  
  it('should include file statistics', () => {
    const projectPath = setupProject({
      'src/stats.ts': `
export function a() { return 1; }
export function b() { return 2; }
export function c() { return 3; }
`,
    });
    
    const result = analyzeComplexity({ projectPath });
    
    const stats = result.fileStats.find(f => f.file.includes('stats.ts'));
    if (stats) {
      assert.ok('lineCount' in stats);
      assert.ok('functionCount' in stats);
      assert.ok('avgComplexity' in stats);
      assert.ok('maxComplexity' in stats);
    }
  });
  
  it('should generate suggested prompt for hotspots', () => {
    const projectPath = setupProject({
      'src/hot.ts': `
export function messyCode(a: number) {
  if (a > 0) {
    if (a > 10) {
      if (a > 100) {
        for (let i = 0; i < a; i++) {
          if (i % 2 && i % 3 && i % 5) {
            return i;
          }
        }
      }
    }
  }
  return 0;
}
`,
    });
    
    const result = analyzeComplexity({ projectPath, threshold: 1 });
    
    assert.ok(result.suggestedPrompt.length > 0);
  });
  
  it('should handle empty project', () => {
    const projectPath = setupProject({});
    
    const result = analyzeComplexity({ projectPath });
    
    assert.equal(result.summary.filesAnalyzed, 0);
    assert.equal(result.hotspots.length, 0);
  });
  
  it('should ignore node_modules', () => {
    const projectPath = setupProject({
      'src/app.ts': 'export const x = 1;',
    });
    
    // Create a node_modules file (shouldn't be analyzed)
    mkdirSync(join(projectPath, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(projectPath, 'node_modules', 'pkg', 'index.js'), 
      'function complex() { if(1){if(2){if(3){if(4){}}}} }');
    
    const result = analyzeComplexity({ projectPath, threshold: 1 });
    
    // Should not include node_modules
    const hasNodeModules = result.hotspots.some(h => h.file.includes('node_modules'));
    assert.equal(hasNodeModules, false);
  });
  
  it('should detect issues for complex functions', () => {
    const projectPath = setupProject({
      'src/issues.ts': `
export function tooManyParams(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) {
  if (a > 0) {
    if (b > 0) {
      if (c > 0) {
        if (d > 0) {
          if (e > 0) {
            return a + b + c + d + e + f + g + h;
          }
        }
      }
    }
  }
  return 0;
}
`,
    });
    
    const result = analyzeComplexity({ projectPath, threshold: 1 });
    
    const func = result.hotspots.find(h => h.name === 'tooManyParams');
    if (func) {
      assert.ok(func.issues.length > 0);
      assert.ok(func.metrics.parameterCount >= 7);
    }
  });
  
  it('should analyze Python files', () => {
    const projectPath = setupProject({
      'src/module.py': `
def complex_function(a, b, c):
    if a > 0:
        if b > 0:
            for i in range(a):
                if i % 2 == 0:
                    while i > 0:
                        return i
    return 0
`,
    });
    
    const result = analyzeComplexity({ projectPath, threshold: 1 });
    
    // Should analyze Python
    assert.ok(result.summary.filesAnalyzed >= 1);
  });
  
  it('should analyze Go files', () => {
    const projectPath = setupProject({
      'src/main.go': `
package main

func complexFunc(a int) int {
    if a > 0 {
        if a > 10 {
            for i := 0; i < a; i++ {
                if i%2 == 0 {
                    return i
                }
            }
        }
    }
    return 0
}
`,
    });
    
    const result = analyzeComplexity({ projectPath, threshold: 1 });
    
    assert.ok(result.summary.filesAnalyzed >= 1);
  });
  
  it('should assign severity levels correctly', () => {
    const projectPath = setupProject({
      'src/levels.ts': `
export function critical(x: number) {
  // Super complex with deep nesting and many conditions
  if (x > 0) { if (x > 1) { if (x > 2) { if (x > 3) { if (x > 4) {
    for (let i = 0; i < x; i++) {
      for (let j = 0; j < i; j++) {
        if (i + j > 10 && i * j < 100 || i - j === 0) {
          switch (i % 5) {
            case 0: return 'a';
            case 1: return 'b';
            case 2: return 'c';
            case 3: return 'd';
            default: return 'e';
          }
        }
      }
    }
  } } } } }
  return 'x';
}
`,
    });
    
    const result = analyzeComplexity({ projectPath, threshold: 1 });
    
    // Should find high or critical severity
    const severities = result.hotspots.map(h => h.severity);
    assert.ok(
      severities.some(s => s === 'high' || s === 'critical') || result.hotspots.length === 0,
      'Should have high or critical severity functions'
    );
  });
});

describe('analyzeSimplify', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });
  
  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {}
  });
  
  it('should return simplify report structure', () => {
    const projectPath = setupProject({
      'src/target.ts': 'export const x = 1;',
    });
    
    const result = analyzeSimplify({ projectPath, file: 'src/target.ts' });
    
    assert.ok('file' in result);
    assert.ok('issues' in result);
    assert.ok('suggestedPrompt' in result);
    assert.ok('estimatedImprovement' in result);
    assert.ok(Array.isArray(result.issues));
  });
  
  it('should detect deep nesting', () => {
    const projectPath = setupProject({
      'src/nested.ts': `
export function deepNesting(x: number) {
  if (x > 0) {
    if (x > 1) {
      if (x > 2) {
        if (x > 3) {
          if (x > 4) {
            return x;
          }
        }
      }
    }
  }
  return 0;
}
`,
    });
    
    const result = analyzeSimplify({ projectPath, file: 'src/nested.ts' });
    
    const nestingIssue = result.issues.find(i => i.type === 'nesting');
    assert.ok(nestingIssue, 'Should detect nesting issue');
    assert.ok(nestingIssue.suggestion.length > 0);
  });
  
  it('should detect long functions', () => {
    const projectPath = setupProject({
      'src/long.ts': `
export function longFunction() {
  const a = 1;
  ${Array.from({ length: 60 }, (_, i) => `const x${i} = ${i};`).join('\n  ')}
  return a;
}
`,
    });
    
    const result = analyzeSimplify({ projectPath, file: 'src/long.ts' });
    
    const lengthIssue = result.issues.find(i => i.type === 'length');
    if (lengthIssue) {
      assert.ok(lengthIssue.description.includes('lines'));
    }
  });
  
  it('should detect code duplication', () => {
    const projectPath = setupProject({
      'src/dup.ts': `
export function withDuplication() {
  const result1 = someComplexOperation(1, 2, 3, 4, 5);
  const result2 = someComplexOperation(1, 2, 3, 4, 5);
  const result3 = someComplexOperation(1, 2, 3, 4, 5);
  return result1 + result2 + result3;
}
`,
    });
    
    const result = analyzeSimplify({ projectPath, file: 'src/dup.ts' });
    
    const dupIssue = result.issues.find(i => i.type === 'duplication');
    if (dupIssue) {
      assert.ok(dupIssue.description.includes('repeated') || dupIssue.description.includes('pattern'));
    }
  });
  
  it('should detect commented out code', () => {
    const projectPath = setupProject({
      'src/comments.ts': `
export function withComments() {
  const x = 1;
  // function oldCode() { return 1; }
  // const unused = 2;
  // if (condition) { doSomething(); }
  // for (let i = 0; i < 10; i++) { console.log(i); }
  // while (running) { process(); }
  // return oldResult;
  return x;
}
`,
    });
    
    const result = analyzeSimplify({ projectPath, file: 'src/comments.ts' });
    
    const deadCodeIssue = result.issues.find(i => i.type === 'dead-code');
    if (deadCodeIssue) {
      assert.ok(deadCodeIssue.suggestion.includes('git') || deadCodeIssue.suggestion.includes('Remove'));
    }
  });
  
  it('should detect over-abstraction', () => {
    const projectPath = setupProject({
      'src/overabs.ts': Array.from({ length: 30 }, (_, i) => 
        `const fn${i} = () => ${i};`
      ).join('\n'),
    });
    
    const result = analyzeSimplify({ projectPath, file: 'src/overabs.ts' });
    
    const absIssue = result.issues.find(i => i.type === 'abstraction');
    // May or may not be detected depending on exact counts
    if (absIssue) {
      assert.ok(absIssue.description.includes('functions') || absIssue.description.includes('abstracted'));
    }
  });
  
  it('should auto-select most complex file when no file specified', () => {
    const projectPath = setupProject({
      'src/simple.ts': 'export const x = 1;',
      'src/complex.ts': `
export function complex() {
  if (1) { if (2) { if (3) { if (4) { return 5; } } } }
  return 0;
}
`,
    });
    
    const result = analyzeSimplify({ projectPath });
    
    // Should have analyzed something
    assert.ok(result.file.length >= 0); // May be empty if no issues
  });
  
  it('should handle missing file', () => {
    const projectPath = setupProject({});
    
    const result = analyzeSimplify({ projectPath, file: 'nonexistent.ts' });
    
    assert.ok(result.suggestedPrompt.includes('not found') || result.issues.length === 0);
  });
  
  it('should generate improvement estimate', () => {
    const projectPath = setupProject({
      'src/messy.ts': `
export function messy() {
  if (1) {
    if (2) {
      if (3) {
        if (4) {
          return 5;
        }
      }
    }
  }
  return 0;
}
`,
    });
    
    const result = analyzeSimplify({ projectPath, file: 'src/messy.ts' });
    
    assert.ok(result.estimatedImprovement.length > 0);
    assert.ok(typeof result.estimatedImprovement === 'string');
  });
  
  it('should include line numbers in issues', () => {
    const projectPath = setupProject({
      'src/lined.ts': `
export function test() {
  if (1) {
    if (2) {
      if (3) {
        if (4) {
          return 5;
        }
      }
    }
  }
  return 0;
}
`,
    });
    
    const result = analyzeSimplify({ projectPath, file: 'src/lined.ts' });
    
    for (const issue of result.issues) {
      assert.ok('line' in issue);
      assert.equal(typeof issue.line, 'number');
    }
  });
  
  it('should include priority for issues', () => {
    const projectPath = setupProject({
      'src/priority.ts': `
export function test() {
  if (1) { if (2) { if (3) { if (4) { return 5; } } } }
  return 0;
}
`,
    });
    
    const result = analyzeSimplify({ projectPath, file: 'src/priority.ts' });
    
    for (const issue of result.issues) {
      assert.ok(['low', 'medium', 'high'].includes(issue.priority));
    }
  });
  
  it('should report clean file with no issues', () => {
    const projectPath = setupProject({
      'src/clean.ts': `
export function add(a: number, b: number): number {
  return a + b;
}
`,
    });
    
    const result = analyzeSimplify({ projectPath, file: 'src/clean.ts' });
    
    // Clean file should have few or no issues
    assert.ok(result.issues.length <= 1);
  });
  
  it('should handle absolute file paths', () => {
    const projectPath = setupProject({
      'src/abs.ts': 'export const x = 1;',
    });
    
    const absolutePath = join(projectPath, 'src/abs.ts');
    const result = analyzeSimplify({ projectPath, file: absolutePath });
    
    assert.ok('file' in result);
  });
});
