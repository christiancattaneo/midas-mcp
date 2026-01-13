import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { detectTechStack, generateCursorRules, writeCursorRules } from '../techstack.js';

describe('Tech Stack Detection', () => {
  const testDir = join(tmpdir(), 'midas-techstack-test-' + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('detectTechStack', () => {
    it('detects TypeScript from tsconfig.json', () => {
      writeFileSync(join(testDir, 'tsconfig.json'), '{}');
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({ dependencies: {} }));
      
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.language, 'typescript');
    });

    it('detects TypeScript from package.json', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        devDependencies: { typescript: '5.0.0' }
      }));
      
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.language, 'typescript');
    });

    it('detects JavaScript without TypeScript', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        dependencies: { express: '4.0.0' }
      }));
      
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.language, 'javascript');
    });

    it('detects React framework', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        dependencies: { react: '18.0.0' }
      }));
      
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.framework, 'React');
    });

    it('detects Next.js framework', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        dependencies: { next: '14.0.0', react: '18.0.0' }
      }));
      
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.framework, 'Next.js');
    });

    it('detects Express framework', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        dependencies: { express: '4.0.0' }
      }));
      
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.framework, 'Express');
    });

    it('detects Python from requirements.txt', () => {
      writeFileSync(join(testDir, 'requirements.txt'), 'flask==2.0.0');
      
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.language, 'python');
      assert.strictEqual(stack.framework, 'Flask');
    });

    it('detects Python from pyproject.toml', () => {
      writeFileSync(join(testDir, 'pyproject.toml'), '[tool.poetry]');
      
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.language, 'python');
    });

    it('detects Go from go.mod', () => {
      writeFileSync(join(testDir, 'go.mod'), 'module example.com/test');
      
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.language, 'go');
    });

    it('detects Rust from Cargo.toml', () => {
      writeFileSync(join(testDir, 'Cargo.toml'), '[package]');
      
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.language, 'rust');
    });

    it('detects Swift from Package.swift', () => {
      writeFileSync(join(testDir, 'Package.swift'), '// swift package');
      
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.language, 'swift');
    });

    it('detects tests exist from test script', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        scripts: { test: 'jest' }
      }));
      
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.hasTests, true);
    });

    it('ignores default npm test script', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        scripts: { test: 'echo "Error: no test specified" && exit 1' }
      }));
      
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.hasTests, false);
    });

    it('detects docs from docs directory', () => {
      mkdirSync(join(testDir, 'docs'));
      
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.hasDocs, true);
    });

    it('detects docs from README.md', () => {
      writeFileSync(join(testDir, 'README.md'), '# Project');
      
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.hasDocs, true);
    });

    it('detects CI from GitHub workflows', () => {
      mkdirSync(join(testDir, '.github', 'workflows'), { recursive: true });
      
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.hasCI, true);
    });

    it('returns unknown for empty project', () => {
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.language, 'unknown');
    });

    it('collects dependencies from package.json', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        dependencies: { react: '18.0.0', lodash: '4.0.0' },
        devDependencies: { typescript: '5.0.0' }
      }));
      
      const stack = detectTechStack(testDir);
      assert.strictEqual(stack.dependencies.includes('react'), true);
      assert.strictEqual(stack.dependencies.includes('lodash'), true);
      assert.strictEqual(stack.dependencies.includes('typescript'), true);
    });
  });

  describe('generateCursorRules', () => {
    it('generates rules for TypeScript project', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        devDependencies: { typescript: '5.0.0' }
      }));
      
      const rules = generateCursorRules(testDir, 'test-project');
      assert.strictEqual(rules.includes('# Project: test-project'), true);
      assert.strictEqual(rules.includes('# TypeScript Rules'), true);
      assert.strictEqual(rules.includes('No `any` types'), true);
    });

    it('generates rules for Python project', () => {
      writeFileSync(join(testDir, 'requirements.txt'), 'django==4.0.0');
      
      const rules = generateCursorRules(testDir, 'py-project');
      assert.strictEqual(rules.includes('# Python Rules'), true);
      assert.strictEqual(rules.includes('type hints'), true);
    });

    it('includes framework-specific rules for Next.js', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        dependencies: { next: '14.0.0' }
      }));
      
      const rules = generateCursorRules(testDir, 'next-app');
      assert.strictEqual(rules.includes('# Next.js Rules'), true);
      assert.strictEqual(rules.includes('App Router'), true);
    });

    it('includes Midas integration rules', () => {
      const rules = generateCursorRules(testDir, 'any-project');
      assert.strictEqual(rules.includes('# Midas Integration'), true);
      assert.strictEqual(rules.includes('midas_analyze'), true);
    });

    it('includes security rules', () => {
      const rules = generateCursorRules(testDir, 'any-project');
      assert.strictEqual(rules.includes('# Security'), true);
      assert.strictEqual(rules.includes('API keys'), true);
    });

    it('includes Golden Code methodology', () => {
      const rules = generateCursorRules(testDir, 'any-project');
      assert.strictEqual(rules.includes('Golden Code Methodology'), true);
      assert.strictEqual(rules.includes('EAGLE_SIGHT'), true);
    });
  });

  describe('writeCursorRules', () => {
    it('creates .cursorrules file', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        devDependencies: { typescript: '5.0.0' }
      }));
      
      const result = writeCursorRules(testDir, 'test-project');
      assert.strictEqual(result.success, true);
      assert.strictEqual(existsSync(join(testDir, '.cursorrules')), true);
    });

    it('writes correct content', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        dependencies: { react: '18.0.0' }
      }));
      
      writeCursorRules(testDir, 'my-app');
      const content = readFileSync(join(testDir, '.cursorrules'), 'utf-8');
      assert.strictEqual(content.includes('# Project: my-app'), true);
      assert.strictEqual(content.includes('React'), true);
    });
  });
});
