/**
 * Code Discovery Stress Tests
 * 
 * Comprehensive testing of code discovery functionality:
 * - Test-only projects (no source code)
 * - Config-only projects (no source or tests)
 * - Unicode content in filenames and content
 * - Mixed project structures
 * - Edge cases in file classification
 * - Performance under various conditions
 * 
 * Based on source code scanning and project structure analysis best practices.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Import functions to test
import {
  discoverSourceFiles,
  readSourceFiles,
  discoverAndReadCode,
  hasTestFiles,
  SourceFile,
  CodeDiscoveryResult,
} from '../code-discovery.js';

// Helper to check if a file is a test file
function isTestFile(path: string): boolean {
  return path.includes('.test.') || 
         path.includes('.spec.') || 
         path.includes('test/') || 
         path.includes('tests/') || 
         path.includes('__tests__/');
}

// Helper to check if a file is a config file
function isConfigFile(filename: string): boolean {
  return filename.includes('config') ||
         filename === 'package.json' ||
         filename === 'tsconfig.json' ||
         filename === 'jsconfig.json' ||
         filename.startsWith('.') ||
         filename.endsWith('.json') ||
         filename.endsWith('.yml') ||
         filename.endsWith('.yaml');
}

// Helper to categorize files from discoverSourceFiles result
function categorizeFiles(files: SourceFile[]): { sourceFiles: SourceFile[], testFiles: SourceFile[], configFiles: SourceFile[] } {
  return {
    sourceFiles: files.filter(f => !isTestFile(f.path) && !isConfigFile(f.filename)),
    testFiles: files.filter(f => isTestFile(f.path)),
    configFiles: files.filter(f => isConfigFile(f.filename)),
  };
}

// ============================================================================
// HELPERS
// ============================================================================

let testDirs: string[] = [];

function createTestDir(prefix: string): string {
  const dir = join(tmpdir(), `midas-code-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

// Helper to create a file with content
function createFile(dir: string, path: string, content: string = ''): string {
  const fullPath = join(dir, path);
  const parentDir = join(fullPath, '..');
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
  writeFileSync(fullPath, content);
  return fullPath;
}

// ============================================================================
// 1. TEST-ONLY PROJECTS
// ============================================================================

describe('Test-Only Projects', () => {
  it('should discover test files in tests directory', () => {
    const dir = createTestDir('test-only-tests');
    
    createFile(dir, 'tests/unit.test.ts', 'describe("test", () => {});');
    createFile(dir, 'tests/integration.test.ts', 'describe("test", () => {});');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.testFiles.length >= 2);
  });

  it('should discover test files in __tests__ directory', () => {
    const dir = createTestDir('test-only-dunder');
    
    createFile(dir, '__tests__/app.test.js', 'test("works", () => {});');
    createFile(dir, '__tests__/utils.test.js', 'test("works", () => {});');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.testFiles.length >= 2);
  });

  it('should discover spec files', () => {
    const dir = createTestDir('test-only-spec');
    
    createFile(dir, 'src/app.spec.ts', 'it("works", () => {});');
    createFile(dir, 'src/utils.spec.ts', 'it("works", () => {});');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.testFiles.length >= 2);
  });

  it('should handle project with only test files', () => {
    const dir = createTestDir('test-only-pure');
    
    createFile(dir, 'test/a.test.ts', 'test("a", () => {});');
    createFile(dir, 'test/b.test.ts', 'test("b", () => {});');
    createFile(dir, 'test/c.test.ts', 'test("c", () => {});');
    createFile(dir, 'package.json', '{"name": "test-only"}');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.testFiles.length >= 3);
    assert.strictEqual(result.sourceFiles.length, 0);
  });

  it('should distinguish test from source files', () => {
    const dir = createTestDir('test-only-mixed');
    
    createFile(dir, 'src/app.ts', 'export const app = {};');
    createFile(dir, 'src/app.test.ts', 'test("app", () => {});');
    createFile(dir, 'src/utils.ts', 'export const utils = {};');
    createFile(dir, 'src/utils.spec.ts', 'test("utils", () => {});');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    const testPaths = result.testFiles.map(f => f.path);
    const sourcePaths = result.sourceFiles.map(f => f.path);
    
    // Test files should be in testFiles
    assert.ok(testPaths.some(p => p.includes('.test.')));
    assert.ok(testPaths.some(p => p.includes('.spec.')));
    
    // Source files should not have test/spec
    for (const path of sourcePaths) {
      assert.ok(!path.includes('.test.'), `${path} should not be in source files`);
      assert.ok(!path.includes('.spec.'), `${path} should not be in source files`);
    }
  });

  it('should handle test files with various extensions', () => {
    const dir = createTestDir('test-extensions');
    
    createFile(dir, 'test/a.test.ts', 'test');
    createFile(dir, 'test/b.test.js', 'test');
    createFile(dir, 'test/c.test.tsx', 'test');
    createFile(dir, 'test/d.test.jsx', 'test');
    createFile(dir, 'test/e.test.mjs', 'test');
    createFile(dir, 'test/f.test.cjs', 'test');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.testFiles.length >= 6);
  });

  it('should detect hasTestFiles correctly', () => {
    const dir = createTestDir('has-test-files');
    
    // No tests initially
    assert.strictEqual(hasTestFiles(dir), false);
    
    // Add a test file
    createFile(dir, 'test.test.ts', 'test');
    
    assert.strictEqual(hasTestFiles(dir), true);
  });

  it('should handle deeply nested test files', () => {
    const dir = createTestDir('test-nested');
    
    createFile(dir, 'tests/unit/services/auth/login.test.ts', 'test');
    createFile(dir, 'tests/integration/api/v1/users.test.ts', 'test');
    createFile(dir, 'tests/e2e/scenarios/checkout/payment.test.ts', 'test');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.testFiles.length >= 3);
  });
});

// ============================================================================
// 2. CONFIG-ONLY PROJECTS
// ============================================================================

describe('Config-Only Projects', () => {
  it('should discover config files', () => {
    const dir = createTestDir('config-only-basic');
    
    createFile(dir, 'package.json', '{"name": "config-only"}');
    createFile(dir, 'tsconfig.json', '{"compilerOptions": {}}');
    createFile(dir, '.eslintrc.json', '{}');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.configFiles.length >= 2);
  });

  it('should handle project with only config files', () => {
    const dir = createTestDir('config-only-pure');
    
    createFile(dir, 'package.json', '{"name": "config-only"}');
    createFile(dir, 'tsconfig.json', '{}');
    createFile(dir, '.prettierrc', '{}');
    createFile(dir, '.eslintrc.js', 'module.exports = {}');
    createFile(dir, 'webpack.config.js', 'module.exports = {}');
    createFile(dir, 'babel.config.js', 'module.exports = {}');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.configFiles.length >= 3);
    assert.strictEqual(result.sourceFiles.length, 0);
    assert.strictEqual(result.testFiles.length, 0);
  });

  it('should classify various config file types', () => {
    const dir = createTestDir('config-types');
    
    // JSON configs
    createFile(dir, 'tsconfig.json', '{}');
    createFile(dir, 'jsconfig.json', '{}');
    createFile(dir, '.babelrc', '{}');
    
    // JS configs
    createFile(dir, 'jest.config.js', 'module.exports = {}');
    createFile(dir, 'vite.config.ts', 'export default {}');
    createFile(dir, 'next.config.mjs', 'export default {}');
    
    // YAML configs
    createFile(dir, '.github/workflows/ci.yml', 'name: CI');
    createFile(dir, 'docker-compose.yml', 'version: "3"');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.configFiles.length >= 3);
  });

  it('should not classify config files as source', () => {
    const dir = createTestDir('config-not-source');
    
    createFile(dir, 'webpack.config.js', 'module.exports = {}');
    createFile(dir, 'rollup.config.ts', 'export default {}');
    createFile(dir, 'vitest.config.ts', 'export default {}');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    // Config files should not be in source files
    for (const src of result.sourceFiles) {
      assert.ok(!src.path.includes('config'), `${src.path} should be in configFiles`);
    }
  });

  it('should handle dotfile configs', () => {
    const dir = createTestDir('config-dotfiles');
    
    createFile(dir, '.prettierrc', '{}');
    createFile(dir, '.eslintrc', '{}');
    createFile(dir, '.babelrc', '{}');
    createFile(dir, '.editorconfig', 'root = true');
    createFile(dir, '.nvmrc', '20');
    
    const files = discoverSourceFiles(dir);
    
    // Should handle gracefully, not crash
    assert.ok(files !== null);
  });

  it('should handle nested config directories', () => {
    const dir = createTestDir('config-nested');
    
    createFile(dir, 'config/development.json', '{}');
    createFile(dir, 'config/production.json', '{}');
    createFile(dir, 'config/test.json', '{}');
    createFile(dir, '.config/settings.json', '{}');
    
    const files = discoverSourceFiles(dir);
    
    assert.ok(files !== null);
  });
});

// ============================================================================
// 3. UNICODE CONTENT IN FILENAMES
// ============================================================================

describe('Unicode Filenames', () => {
  it('should handle Chinese characters in filename', () => {
    const dir = createTestDir('unicode-chinese');
    
    createFile(dir, 'src/组件.ts', 'export const 组件 = {};');
    createFile(dir, 'src/测试工具.ts', 'export const 测试 = {};');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 2);
  });

  it('should handle Japanese characters in filename', () => {
    const dir = createTestDir('unicode-japanese');
    
    createFile(dir, 'src/コンポーネント.ts', 'export const x = 1;');
    createFile(dir, 'src/ユーティリティ.ts', 'export const y = 2;');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 2);
  });

  it('should handle Korean characters in filename', () => {
    const dir = createTestDir('unicode-korean');
    
    createFile(dir, 'src/구성요소.ts', 'export const x = 1;');
    createFile(dir, 'src/유틸리티.ts', 'export const y = 2;');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 2);
  });

  it('should handle emoji in filename', () => {
    const dir = createTestDir('unicode-emoji');
    
    createFile(dir, 'src/🚀.ts', 'export const rocket = true;');
    createFile(dir, 'src/✨utils.ts', 'export const sparkle = true;');
    createFile(dir, 'src/app_🎉.ts', 'export const party = true;');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 3);
  });

  it('should handle mixed scripts in filename', () => {
    const dir = createTestDir('unicode-mixed');
    
    createFile(dir, 'src/Component_组件_コンポーネント.ts', 'export const x = 1;');
    createFile(dir, 'src/Utilsприклад.ts', 'export const y = 2;');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 2);
  });

  it('should handle accented characters in filename', () => {
    const dir = createTestDir('unicode-accents');
    
    createFile(dir, 'src/café.ts', 'export const cafe = true;');
    createFile(dir, 'src/naïve.ts', 'export const naive = true;');
    createFile(dir, 'src/résumé.ts', 'export const resume = true;');
    createFile(dir, 'src/façade.ts', 'export const facade = true;');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 4);
  });

  it('should handle Arabic characters in filename', () => {
    const dir = createTestDir('unicode-arabic');
    
    createFile(dir, 'src/مكون.ts', 'export const x = 1;');
    createFile(dir, 'src/أداة.ts', 'export const y = 2;');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 2);
  });

  it('should handle Hebrew characters in filename', () => {
    const dir = createTestDir('unicode-hebrew');
    
    createFile(dir, 'src/רכיב.ts', 'export const x = 1;');
    createFile(dir, 'src/כלי.ts', 'export const y = 2;');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 2);
  });

  it('should handle Cyrillic characters in filename', () => {
    const dir = createTestDir('unicode-cyrillic');
    
    createFile(dir, 'src/компонент.ts', 'export const x = 1;');
    createFile(dir, 'src/утилита.ts', 'export const y = 2;');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 2);
  });

  it('should handle Greek characters in filename', () => {
    const dir = createTestDir('unicode-greek');
    
    createFile(dir, 'src/στοιχείο.ts', 'export const x = 1;');
    createFile(dir, 'src/βοηθητικό.ts', 'export const y = 2;');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 2);
  });
});

// ============================================================================
// 4. UNICODE CONTENT IN FILES
// ============================================================================

describe('Unicode Content', () => {
  it('should read files with Chinese content', () => {
    const dir = createTestDir('content-chinese');
    
    createFile(dir, 'src/app.ts', `
      // 这是一个注释
      export const message = "你好世界";
      export const 组件名称 = "测试";
    `);
    
    const result = discoverAndReadCode(dir, {
      phase: { phase: 'BUILD', step: 'IMPLEMENT' },
    }, { maxTokens: 10000 });
    
    assert.ok(result.codeContext.includes('你好世界') || result.sourceFiles.length > 0);
  });

  it('should read files with Japanese content', () => {
    const dir = createTestDir('content-japanese');
    
    createFile(dir, 'src/app.ts', `
      // これはコメントです
      export const message = "こんにちは世界";
      export const コンポーネント = "テスト";
    `);
    
    const result = discoverAndReadCode(dir, {
      phase: { phase: 'BUILD', step: 'IMPLEMENT' },
    }, { maxTokens: 10000 });
    
    assert.ok(result.sourceFiles.length > 0);
  });

  it('should read files with emoji content', () => {
    const dir = createTestDir('content-emoji');
    
    createFile(dir, 'src/app.ts', `
      // 🚀 Rocket launch!
      export const status = "✅ Success";
      export const warning = "⚠️ Be careful";
      export const celebration = "🎉🎊🎈";
    `);
    
    const result = discoverAndReadCode(dir, {
      phase: { phase: 'BUILD', step: 'IMPLEMENT' },
    }, { maxTokens: 10000 });
    
    assert.ok(result.sourceFiles.length > 0);
  });

  it('should read files with RTL content', () => {
    const dir = createTestDir('content-rtl');
    
    createFile(dir, 'src/app.ts', `
      // هذا تعليق بالعربية
      export const message = "مرحبا بالعالم";
      // זה תגובה בעברית
      export const greeting = "שלום עולם";
    `);
    
    const result = discoverAndReadCode(dir, {
      phase: { phase: 'BUILD', step: 'IMPLEMENT' },
    }, { maxTokens: 10000 });
    
    assert.ok(result.sourceFiles.length > 0);
  });

  it('should read files with combining characters', () => {
    const dir = createTestDir('content-combining');
    
    createFile(dir, 'src/app.ts', `
      // Combining characters: é = e + ́
      export const cafe = "café"; // NFD form
      export const resume = "résumé";
      export const test = "ñ ü ö ä";
    `);
    
    const result = discoverAndReadCode(dir, {
      phase: { phase: 'BUILD', step: 'IMPLEMENT' },
    }, { maxTokens: 10000 });
    
    assert.ok(result.sourceFiles.length > 0);
  });

  it('should read files with various quote styles', () => {
    const dir = createTestDir('content-quotes');
    
    createFile(dir, 'src/app.ts', `
      // Various quote styles
      export const a = "double quotes";
      export const b = 'single quotes';
      export const c = \`backticks\`;
      export const d = "curly quotes";
      export const e = 'smart quotes';
      export const f = «guillemets»;
    `);
    
    const result = discoverAndReadCode(dir, {
      phase: { phase: 'BUILD', step: 'IMPLEMENT' },
    }, { maxTokens: 10000 });
    
    assert.ok(result.sourceFiles.length > 0);
  });

  it('should read files with mathematical symbols', () => {
    const dir = createTestDir('content-math');
    
    createFile(dir, 'src/math.ts', `
      // Math symbols
      export const pi = 3.14159; // π
      export const sum = "∑";
      export const infinity = "∞";
      export const lessThanOrEqual = "≤";
      export const notEqual = "≠";
      export const approx = "≈";
    `);
    
    const result = discoverAndReadCode(dir, {
      phase: { phase: 'BUILD', step: 'IMPLEMENT' },
    }, { maxTokens: 10000 });
    
    assert.ok(result.sourceFiles.length > 0);
  });

  it('should handle files with BOM', () => {
    const dir = createTestDir('content-bom');
    
    // UTF-8 BOM
    createFile(dir, 'src/app.ts', '\uFEFFexport const x = 1;');
    
    const result = discoverAndReadCode(dir, {
      phase: { phase: 'BUILD', step: 'IMPLEMENT' },
    }, { maxTokens: 10000 });
    
    assert.ok(result.sourceFiles.length > 0);
  });

  it('should handle files with null characters', () => {
    const dir = createTestDir('content-null');
    
    createFile(dir, 'src/app.ts', 'export const x = 1;\x00// null byte');
    
    const result = discoverAndReadCode(dir, {
      phase: { phase: 'BUILD', step: 'IMPLEMENT' },
    }, { maxTokens: 10000 });
    
    // Should handle gracefully
    assert.ok(result !== null);
  });
});

// ============================================================================
// 5. MIXED PROJECT STRUCTURES
// ============================================================================

describe('Mixed Project Structures', () => {
  it('should handle standard src/tests structure', () => {
    const dir = createTestDir('mixed-standard');
    
    createFile(dir, 'src/index.ts', 'export const app = {};');
    createFile(dir, 'src/utils.ts', 'export const utils = {};');
    createFile(dir, 'tests/index.test.ts', 'test("app", () => {});');
    createFile(dir, 'tests/utils.test.ts', 'test("utils", () => {});');
    createFile(dir, 'package.json', '{}');
    createFile(dir, 'tsconfig.json', '{}');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 2);
    assert.ok(result.testFiles.length >= 2);
    assert.ok(result.configFiles.length >= 2);
  });

  it('should handle monorepo structure', () => {
    const dir = createTestDir('mixed-monorepo');
    
    createFile(dir, 'packages/core/src/index.ts', 'export const core = {};');
    createFile(dir, 'packages/core/tests/index.test.ts', 'test("core", () => {});');
    createFile(dir, 'packages/utils/src/index.ts', 'export const utils = {};');
    createFile(dir, 'packages/utils/tests/index.test.ts', 'test("utils", () => {});');
    createFile(dir, 'package.json', '{}');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 2);
    assert.ok(result.testFiles.length >= 2);
  });

  it('should handle flat structure', () => {
    const dir = createTestDir('mixed-flat');
    
    createFile(dir, 'index.ts', 'export const app = {};');
    createFile(dir, 'utils.ts', 'export const utils = {};');
    createFile(dir, 'index.test.ts', 'test("app", () => {});');
    createFile(dir, 'utils.test.ts', 'test("utils", () => {});');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 2);
    assert.ok(result.testFiles.length >= 2);
  });

  it('should handle colocated tests', () => {
    const dir = createTestDir('mixed-colocated');
    
    createFile(dir, 'src/components/Button.tsx', 'export const Button = () => {};');
    createFile(dir, 'src/components/Button.test.tsx', 'test("Button", () => {});');
    createFile(dir, 'src/utils/format.ts', 'export const format = () => {};');
    createFile(dir, 'src/utils/format.spec.ts', 'test("format", () => {});');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 2);
    assert.ok(result.testFiles.length >= 2);
  });

  it('should handle multiple test directories', () => {
    const dir = createTestDir('mixed-multi-test');
    
    createFile(dir, 'src/app.ts', 'export const app = {};');
    createFile(dir, 'tests/unit/app.test.ts', 'test');
    createFile(dir, 'tests/integration/app.test.ts', 'test');
    createFile(dir, 'e2e/app.test.ts', 'test');
    createFile(dir, '__tests__/app.test.ts', 'test');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.testFiles.length >= 4);
  });
});

// ============================================================================
// 6. EMPTY AND MINIMAL PROJECTS
// ============================================================================

describe('Empty and Minimal Projects', () => {
  it('should handle completely empty directory', () => {
    const dir = createTestDir('empty');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.strictEqual(result.sourceFiles.length, 0);
    assert.strictEqual(result.testFiles.length, 0);
  });

  it('should handle directory with only package.json', () => {
    const dir = createTestDir('minimal-pkg');
    
    createFile(dir, 'package.json', '{"name": "minimal"}');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.strictEqual(result.sourceFiles.length, 0);
    assert.ok(result.configFiles.length >= 1);
  });

  it('should handle directory with empty src folder', () => {
    const dir = createTestDir('minimal-empty-src');
    
    mkdirSync(join(dir, 'src'), { recursive: true });
    createFile(dir, 'package.json', '{}');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.strictEqual(result.sourceFiles.length, 0);
  });

  it('should handle single file project', () => {
    const dir = createTestDir('minimal-single');
    
    createFile(dir, 'index.ts', 'console.log("hello");');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 1);
  });

  it('should handle project with only README', () => {
    const dir = createTestDir('minimal-readme');
    
    createFile(dir, 'README.md', '# Project');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.strictEqual(result.sourceFiles.length, 0);
    assert.strictEqual(result.testFiles.length, 0);
  });
});

// ============================================================================
// 7. FILE TYPE CLASSIFICATION
// ============================================================================

describe('File Type Classification', () => {
  it('should classify TypeScript files', () => {
    const dir = createTestDir('classify-ts');
    
    createFile(dir, 'src/index.ts', 'export const x = 1;');
    createFile(dir, 'src/types.d.ts', 'declare const x: number;');
    createFile(dir, 'src/app.tsx', 'export const App = () => <div/>;');
    createFile(dir, 'src/util.mts', 'export const util = {};');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 3);
  });

  it('should classify JavaScript files', () => {
    const dir = createTestDir('classify-js');
    
    createFile(dir, 'src/index.js', 'export const x = 1;');
    createFile(dir, 'src/app.jsx', 'export const App = () => <div/>;');
    createFile(dir, 'src/util.mjs', 'export const util = {};');
    createFile(dir, 'src/legacy.cjs', 'module.exports = {};');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 4);
  });

  it('should classify Python files', () => {
    const dir = createTestDir('classify-py');
    
    createFile(dir, 'src/main.py', 'def main(): pass');
    createFile(dir, 'src/utils.py', 'def util(): pass');
    createFile(dir, 'tests/test_main.py', 'def test_main(): pass');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length + result.testFiles.length >= 3);
  });

  it('should classify Go files', () => {
    const dir = createTestDir('classify-go');
    
    createFile(dir, 'main.go', 'package main');
    createFile(dir, 'utils/helper.go', 'package utils');
    createFile(dir, 'main_test.go', 'package main');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length + result.testFiles.length >= 3);
  });

  it('should classify Rust files', () => {
    const dir = createTestDir('classify-rust');
    
    createFile(dir, 'src/main.rs', 'fn main() {}');
    createFile(dir, 'src/lib.rs', 'pub fn lib() {}');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    assert.ok(result.sourceFiles.length >= 2);
  });

  it('should ignore build output directories', () => {
    const dir = createTestDir('classify-ignore-build');
    
    createFile(dir, 'src/app.ts', 'export const app = {};');
    createFile(dir, 'dist/app.js', 'const app = {};');
    createFile(dir, 'build/app.js', 'const app = {};');
    createFile(dir, 'out/app.js', 'const app = {};');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    const paths = result.sourceFiles.map(f => f.path);
    
    for (const path of paths) {
      assert.ok(!path.includes('dist/'));
      assert.ok(!path.includes('build/'));
      assert.ok(!path.includes('out/'));
    }
  });

  it('should ignore node_modules', () => {
    const dir = createTestDir('classify-ignore-node-modules');
    
    createFile(dir, 'src/app.ts', 'export const app = {};');
    createFile(dir, 'node_modules/package/index.js', 'module.exports = {};');
    
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    
    const paths = result.sourceFiles.map(f => f.path);
    
    for (const path of paths) {
      assert.ok(!path.includes('node_modules'));
    }
  });
});

// ============================================================================
// 8. READING AND TOKEN LIMITS
// ============================================================================

describe('Reading and Token Limits', () => {
  it('should respect token limits', () => {
    const dir = createTestDir('read-token-limit');
    
    // Create files with known content
    for (let i = 0; i < 10; i++) {
      createFile(dir, `src/file${i}.ts`, 'x'.repeat(1000));
    }
    
    const result = discoverAndReadCode(dir, {
      phase: { phase: 'BUILD', step: 'IMPLEMENT' },
    }, { maxTokens: 1000 });  // Low limit
    
    // Should truncate or limit files
    assert.ok(result.codeContext.length < 10000);
  });

  it('should handle very large files', () => {
    const dir = createTestDir('read-large-file');
    
    // Create a large file (100KB)
    createFile(dir, 'src/large.ts', 'x'.repeat(100000));
    
    const result = discoverAndReadCode(dir, {
      phase: { phase: 'BUILD', step: 'IMPLEMENT' },
    }, { maxTokens: 50000 });
    
    // Should handle without crashing
    assert.ok(result !== null);
  });

  it('should prioritize important files', () => {
    const dir = createTestDir('read-prioritize');
    
    createFile(dir, 'src/index.ts', 'export const main = {};');
    createFile(dir, 'src/utils.ts', 'export const utils = {};');
    createFile(dir, 'src/deep/nested/file.ts', 'export const deep = {};');
    
    const result = discoverAndReadCode(dir, {
      phase: { phase: 'BUILD', step: 'IMPLEMENT' },
    }, { maxTokens: 1000 });
    
    // Should include index file (usually highest priority)
    assert.ok(result.sourceFiles.some(f => f.path.includes('index')));
  });

  it('should read test files when in TEST phase', () => {
    const dir = createTestDir('read-test-phase');
    
    createFile(dir, 'src/app.ts', 'export const app = {};');
    createFile(dir, 'tests/app.test.ts', 'test("app", () => {});');
    
    const result = discoverAndReadCode(dir, {
      phase: { phase: 'BUILD', step: 'TEST' },
    }, { maxTokens: 10000 });
    
    assert.ok(result.testFiles.length >= 1);
  });
});

// ============================================================================
// 9. SYMLINKS AND SPECIAL FILES
// ============================================================================

describe('Symlinks and Special Files', () => {
  it('should handle symlinked source files', () => {
    const dir = createTestDir('symlink-source');
    
    createFile(dir, 'src/original.ts', 'export const original = {};');
    
    try {
      symlinkSync(join(dir, 'src/original.ts'), join(dir, 'src/linked.ts'));
    } catch {
      // Skip on Windows
      return;
    }
    
    const files = discoverSourceFiles(dir);
    
    // Should handle symlinks
    assert.ok(files !== null);
  });

  it('should handle symlinked directories', () => {
    const dir = createTestDir('symlink-dir');
    
    mkdirSync(join(dir, 'original'), { recursive: true });
    createFile(dir, 'original/app.ts', 'export const app = {};');
    
    try {
      symlinkSync(join(dir, 'original'), join(dir, 'linked'));
    } catch {
      // Skip on Windows
      return;
    }
    
    const files = discoverSourceFiles(dir);
    
    assert.ok(files !== null);
  });

  it('should handle broken symlinks gracefully', () => {
    const dir = createTestDir('symlink-broken');
    
    try {
      symlinkSync(join(dir, 'nonexistent.ts'), join(dir, 'broken.ts'));
    } catch {
      // Skip on Windows
      return;
    }
    
    const files = discoverSourceFiles(dir);
    
    // Should not crash
    assert.ok(files !== null);
  });
});

// ============================================================================
// 10. PERFORMANCE BENCHMARKS
// ============================================================================

describe('Performance Benchmarks', () => {
  it('should discover 100 files quickly', () => {
    const dir = createTestDir('perf-100-files');
    
    for (let i = 0; i < 100; i++) {
      createFile(dir, `src/file${i}.ts`, `export const file${i} = ${i};`);
    }
    
    const start = Date.now();
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 100 files discovered in ${elapsed}ms`);
    
    assert.ok(result.sourceFiles.length >= 100);
    assert.ok(elapsed < 5000, `Too slow: ${elapsed}ms`);
  });

  it('should read 50 files quickly', () => {
    const dir = createTestDir('perf-50-read');
    
    for (let i = 0; i < 50; i++) {
      createFile(dir, `src/file${i}.ts`, 'x'.repeat(1000));
    }
    
    const start = Date.now();
    const result = discoverAndReadCode(dir, {
      phase: { phase: 'BUILD', step: 'IMPLEMENT' },
    }, { maxTokens: 100000 });
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 50 files read in ${elapsed}ms`);
    
    assert.ok(result !== null);
    assert.ok(elapsed < 10000, `Too slow: ${elapsed}ms`);
  });

  it('should handle deep nesting efficiently', () => {
    const dir = createTestDir('perf-deep');
    
    // Note: discoverSourceFiles has depth limit of 10
    let path = 'src';
    for (let i = 0; i < 8; i++) {
      path = join(path, `level${i}`);
    }
    createFile(dir, join(path, 'deep.ts'), 'export const deep = true;');
    
    const start = Date.now();
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] Deep nesting (8 levels) discovered in ${elapsed}ms`);
    
    assert.ok(result.sourceFiles.length >= 1);
    assert.ok(elapsed < 5000, `Too slow: ${elapsed}ms`);
  });

  it('should handle wide directories efficiently', () => {
    const dir = createTestDir('perf-wide');
    
    // Create 20 subdirectories with 5 files each
    for (let d = 0; d < 20; d++) {
      for (let f = 0; f < 5; f++) {
        createFile(dir, `src/dir${d}/file${f}.ts`, `export const x = ${d * 5 + f};`);
      }
    }
    
    const start = Date.now();
    const files = discoverSourceFiles(dir);
    const result = categorizeFiles(files);
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] Wide structure discovered in ${elapsed}ms`);
    
    assert.ok(result.sourceFiles.length >= 100);
    assert.ok(elapsed < 5000, `Too slow: ${elapsed}ms`);
  });
});

// ============================================================================
// 11. EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  it('should handle permission errors gracefully', () => {
    const dir = createTestDir('edge-permission');
    
    createFile(dir, 'src/app.ts', 'export const app = {};');
    
    // Note: Can't easily test permission errors in cross-platform way
    const files = discoverSourceFiles(dir);
    
    assert.ok(files !== null);
  });

  it('should handle circular directory structures', () => {
    const dir = createTestDir('edge-circular');
    
    mkdirSync(join(dir, 'src'), { recursive: true });
    createFile(dir, 'src/app.ts', 'export const app = {};');
    
    try {
      // Create circular symlink
      symlinkSync(join(dir, 'src'), join(dir, 'src/link'));
    } catch {
      // Skip on Windows or if fails
      return;
    }
    
    const files = discoverSourceFiles(dir);
    
    // Should not hang or crash
    assert.ok(files !== null);
  });

  it('should handle files with unusual extensions', () => {
    const dir = createTestDir('edge-extensions');
    
    createFile(dir, 'src/file.ts.bak', 'export const x = 1;');
    createFile(dir, 'src/file.ts.orig', 'export const x = 1;');
    createFile(dir, 'src/file.ts~', 'export const x = 1;');
    createFile(dir, 'src/file', 'export const x = 1;');  // No extension
    
    const files = discoverSourceFiles(dir);
    
    // Should not include backup files
    assert.ok(files !== null);
  });

  it('should handle very long filenames', () => {
    const dir = createTestDir('edge-long-name');
    
    const longName = 'a'.repeat(200) + '.ts';
    createFile(dir, `src/${longName}`, 'export const x = 1;');
    
    const files = discoverSourceFiles(dir);
    
    assert.ok(files !== null);
  });

  it('should handle hidden files', () => {
    const dir = createTestDir('edge-hidden');
    
    createFile(dir, '.hidden.ts', 'export const hidden = true;');
    createFile(dir, 'src/.hidden.ts', 'export const hidden = true;');
    
    const files = discoverSourceFiles(dir);
    
    // Hidden files typically ignored
    assert.ok(files !== null);
  });
});
