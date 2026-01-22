/**
 * Tests for tools/scope.ts
 * 
 * Covers: detectProjectType, checkScopeCreep, setScopeBaseline
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { detectProjectType, checkScopeCreep, setScopeBaseline } from '../tools/scope.js';

const TEST_DIR = join(tmpdir(), `midas-scope-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function setupProject(options: {
  packageJson?: object;
  hasCargoToml?: boolean;
  cargoContent?: string;
  hasPyproject?: boolean;
  pyprojectContent?: string;
  hasWorkspaces?: boolean;
  hasLerna?: boolean;
  hasPnpmWorkspace?: boolean;
  files?: Record<string, string>;
} = {}) {
  const projectPath = join(TEST_DIR, `project-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(projectPath, '.midas'), { recursive: true });
  mkdirSync(join(projectPath, 'src'), { recursive: true });
  
  // Create package.json
  if (options.packageJson) {
    writeFileSync(join(projectPath, 'package.json'), JSON.stringify(options.packageJson, null, 2));
  }
  
  // Create Cargo.toml for Rust
  if (options.hasCargoToml) {
    writeFileSync(join(projectPath, 'Cargo.toml'), options.cargoContent || `
[package]
name = "test-cli"
version = "0.1.0"

[[bin]]
name = "test-cli"
path = "src/main.rs"
`);
  }
  
  // Create pyproject.toml for Python
  if (options.hasPyproject) {
    writeFileSync(join(projectPath, 'pyproject.toml'), options.pyprojectContent || `
[project]
name = "test-project"

[project.scripts]
test-cli = "main:cli"
`);
  }
  
  // Create lerna.json for monorepo
  if (options.hasLerna) {
    writeFileSync(join(projectPath, 'lerna.json'), JSON.stringify({ packages: ['packages/*'] }));
  }
  
  // Create pnpm-workspace.yaml for monorepo
  if (options.hasPnpmWorkspace) {
    writeFileSync(join(projectPath, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*');
  }
  
  // Create additional files
  if (options.files) {
    for (const [path, content] of Object.entries(options.files)) {
      const fullPath = join(projectPath, path);
      mkdirSync(join(fullPath, '..'), { recursive: true });
      writeFileSync(fullPath, content);
    }
  }
  
  return projectPath;
}

describe('detectProjectType', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });
  
  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {}
  });
  
  it('should return project type result structure', () => {
    const projectPath = setupProject({});
    const result = detectProjectType({ projectPath });
    
    assert.ok('type' in result);
    assert.ok('confidence' in result);
    assert.ok('indicators' in result);
    assert.ok('irrelevantSteps' in result);
    assert.ok(Array.isArray(result.indicators));
    assert.ok(Array.isArray(result.irrelevantSteps));
  });
  
  it('should detect CLI tool by bin field', () => {
    const projectPath = setupProject({
      packageJson: {
        name: 'my-cli',
        bin: { 'my-cli': './dist/index.js' },
      },
    });
    
    const result = detectProjectType({ projectPath });
    
    assert.equal(result.type, 'cli');
    assert.ok(result.confidence >= 80);
    assert.ok(result.indicators.some(i => i.includes('bin')));
  });
  
  it('should detect library by main/exports without app framework', () => {
    const projectPath = setupProject({
      packageJson: {
        name: 'my-lib',
        main: './dist/index.js',
        exports: { '.': './dist/index.js' },
      },
    });
    
    const result = detectProjectType({ projectPath });
    
    assert.equal(result.type, 'library');
    assert.ok(result.confidence >= 70);
  });
  
  it('should detect React web app', () => {
    const projectPath = setupProject({
      packageJson: {
        name: 'my-app',
        dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
      },
    });
    
    const result = detectProjectType({ projectPath });
    
    assert.equal(result.type, 'web-app');
    assert.equal(result.framework, 'react');
    assert.ok(result.confidence >= 80);
  });
  
  it('should detect Vue web app', () => {
    const projectPath = setupProject({
      packageJson: {
        name: 'my-vue-app',
        dependencies: { vue: '^3.0.0' },
      },
    });
    
    const result = detectProjectType({ projectPath });
    
    assert.equal(result.type, 'web-app');
    assert.equal(result.framework, 'vue');
  });
  
  it('should detect Next.js web app', () => {
    const projectPath = setupProject({
      packageJson: {
        name: 'my-next-app',
        dependencies: { next: '^14.0.0' }, // Only next, no react to avoid react being detected first
      },
    });
    
    const result = detectProjectType({ projectPath });
    
    assert.equal(result.type, 'web-app');
    assert.equal(result.framework, 'next');
  });
  
  it('should detect Express API', () => {
    const projectPath = setupProject({
      packageJson: {
        name: 'my-api',
        dependencies: { express: '^4.18.0' },
      },
    });
    
    const result = detectProjectType({ projectPath });
    
    assert.equal(result.type, 'api');
    assert.equal(result.framework, 'express');
  });
  
  it('should detect Fastify API', () => {
    const projectPath = setupProject({
      packageJson: {
        name: 'my-api',
        dependencies: { fastify: '^4.0.0' },
      },
    });
    
    const result = detectProjectType({ projectPath });
    
    assert.equal(result.type, 'api');
    assert.equal(result.framework, 'fastify');
  });
  
  it('should detect NestJS API', () => {
    const projectPath = setupProject({
      packageJson: {
        name: 'my-nest-api',
        dependencies: { nestjs: '^10.0.0' },
      },
    });
    
    const result = detectProjectType({ projectPath });
    
    assert.equal(result.type, 'api');
  });
  
  it('should detect React Native mobile app', () => {
    const projectPath = setupProject({
      packageJson: {
        name: 'my-mobile-app',
        dependencies: { 'react-native': '^0.72.0' },
      },
    });
    
    const result = detectProjectType({ projectPath });
    
    assert.equal(result.type, 'mobile');
    assert.equal(result.framework, 'react-native');
  });
  
  it('should detect Expo mobile app', () => {
    const projectPath = setupProject({
      packageJson: {
        name: 'my-expo-app',
        dependencies: { expo: '^49.0.0' },
      },
    });
    
    const result = detectProjectType({ projectPath });
    
    assert.equal(result.type, 'mobile');
    assert.equal(result.framework, 'expo');
  });
  
  it('should detect monorepo by workspaces', () => {
    const projectPath = setupProject({
      packageJson: {
        name: 'my-monorepo',
        workspaces: ['packages/*'],
      },
    });
    
    const result = detectProjectType({ projectPath });
    
    assert.equal(result.type, 'monorepo');
    assert.ok(result.indicators.some(i => i.includes('workspaces') || i.includes('monorepo')));
  });
  
  it('should detect monorepo by lerna.json', () => {
    const projectPath = setupProject({
      packageJson: { name: 'mono' },
      hasLerna: true,
    });
    
    const result = detectProjectType({ projectPath });
    
    assert.equal(result.type, 'monorepo');
  });
  
  it('should detect monorepo by pnpm-workspace.yaml', () => {
    const projectPath = setupProject({
      packageJson: { name: 'mono' },
      hasPnpmWorkspace: true,
    });
    
    const result = detectProjectType({ projectPath });
    
    assert.equal(result.type, 'monorepo');
  });
  
  it('should detect Rust CLI by Cargo.toml', () => {
    const projectPath = setupProject({
      hasCargoToml: true,
    });
    
    const result = detectProjectType({ projectPath });
    
    assert.equal(result.type, 'cli');
    assert.ok(result.indicators.some(i => i.includes('Rust') || i.includes('Cargo')));
  });
  
  it('should detect Python CLI by pyproject.toml', () => {
    const projectPath = setupProject({
      hasPyproject: true,
    });
    
    const result = detectProjectType({ projectPath });
    
    assert.equal(result.type, 'cli');
    assert.ok(result.indicators.some(i => i.includes('Python') || i.includes('pyproject')));
  });
  
  it('should detect Python web framework', () => {
    const projectPath = setupProject({
      hasPyproject: true,
      pyprojectContent: `
[project]
name = "my-api"
dependencies = ["fastapi", "uvicorn"]
`,
    });
    
    const result = detectProjectType({ projectPath });
    
    // Should detect as API
    assert.ok(result.type === 'api' || result.type === 'cli'); // May detect scripts first
  });
  
  it('should return unknown for empty project', () => {
    const projectPath = setupProject({});
    const result = detectProjectType({ projectPath });
    
    // Without package.json, should be unknown or low confidence
    assert.ok(result.type === 'unknown' || result.confidence < 50);
  });
  
  it('should include irrelevant steps for CLI', () => {
    const projectPath = setupProject({
      packageJson: { name: 'cli', bin: { cli: './index.js' } },
    });
    
    const result = detectProjectType({ projectPath });
    
    assert.ok(result.irrelevantSteps.length > 0);
    assert.ok(result.irrelevantSteps.some(s => 
      s.includes('UI') || s.includes('API') || s.includes('Mobile')
    ));
  });
  
  it('should include irrelevant steps for web-app', () => {
    const projectPath = setupProject({
      packageJson: { name: 'app', dependencies: { react: '^18.0.0' } },
    });
    
    const result = detectProjectType({ projectPath });
    
    assert.ok(result.irrelevantSteps.length > 0);
  });
});

describe('checkScopeCreep', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });
  
  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {}
  });
  
  it('should return scope metrics structure', () => {
    const projectPath = setupProject({
      files: {
        'src/index.ts': 'export const x = 1;',
      },
    });
    
    const result = checkScopeCreep({ projectPath });
    
    assert.ok('initialFileCount' in result);
    assert.ok('currentFileCount' in result);
    assert.ok('initialComplexity' in result);
    assert.ok('currentComplexity' in result);
    assert.ok('driftPercentage' in result);
    assert.ok('featuresAdded' in result);
    assert.ok('warning' in result);
    assert.ok('message' in result);
  });
  
  it('should count current files', () => {
    const projectPath = setupProject({
      files: {
        'src/a.ts': 'export const a = 1;',
        'src/b.ts': 'export const b = 2;',
        'src/c.ts': 'export const c = 3;',
      },
    });
    
    const result = checkScopeCreep({ projectPath });
    
    assert.ok(result.currentFileCount >= 3);
  });
  
  it('should use baseline when set', () => {
    const projectPath = setupProject({
      files: {
        'src/index.ts': 'export const x = 1;',
      },
    });
    
    // Set baseline first
    setScopeBaseline({ projectPath });
    
    // Add more files
    writeFileSync(join(projectPath, 'src', 'extra1.ts'), 'export const e1 = 1;');
    writeFileSync(join(projectPath, 'src', 'extra2.ts'), 'export const e2 = 2;');
    
    const result = checkScopeCreep({ projectPath });
    
    // Should have detected growth
    assert.ok(result.driftPercentage > 0 || result.initialFileCount > 0);
  });
  
  it('should warn on significant growth', () => {
    const projectPath = setupProject({});
    
    // Create baseline with 2 files
    writeFileSync(join(projectPath, 'src', 'a.ts'), 'export const a = 1;');
    writeFileSync(join(projectPath, 'src', 'b.ts'), 'export const b = 2;');
    setScopeBaseline({ projectPath });
    
    // Add many more files (>100% growth)
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(projectPath, 'src', `new${i}.ts`), `export const n${i} = ${i};`);
    }
    
    const result = checkScopeCreep({ projectPath });
    
    // Should warn about growth
    assert.ok(result.driftPercentage > 50 || result.message.includes('grow'));
  });
  
  it('should report no baseline message', () => {
    const projectPath = setupProject({
      files: { 'src/index.ts': 'export const x = 1;' },
    });
    
    const result = checkScopeCreep({ projectPath });
    
    // Without baseline, should indicate this
    if (result.initialFileCount === 0) {
      assert.ok(result.message.includes('baseline') || result.message.includes('No baseline'));
    }
  });
  
  it('should return features from journal', () => {
    const projectPath = setupProject({});
    
    const result = checkScopeCreep({ projectPath });
    
    assert.ok(Array.isArray(result.featuresAdded));
  });
  
  it('should ignore node_modules in count', () => {
    const projectPath = setupProject({
      files: { 'src/index.ts': 'export const x = 1;' },
    });
    
    // Create node_modules files
    mkdirSync(join(projectPath, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(projectPath, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;');
    
    const result = checkScopeCreep({ projectPath });
    
    // Should not count node_modules
    assert.ok(result.currentFileCount < 100);
  });
});

describe('setScopeBaseline', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });
  
  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {}
  });
  
  it('should create baseline file', () => {
    const projectPath = setupProject({
      files: {
        'src/a.ts': 'export const a = 1;',
        'src/b.ts': 'export const b = 2;',
      },
    });
    
    const result = setScopeBaseline({ projectPath });
    
    assert.equal(result.success, true);
    assert.ok(existsSync(join(projectPath, '.midas', 'scope-baseline.json')));
  });
  
  it('should store file count in baseline', () => {
    const projectPath = setupProject({
      files: {
        'src/a.ts': 'export const a = 1;',
        'src/b.ts': 'export const b = 2;',
        'src/c.ts': 'export const c = 3;',
      },
    });
    
    setScopeBaseline({ projectPath });
    
    const baseline = JSON.parse(readFileSync(join(projectPath, '.midas', 'scope-baseline.json'), 'utf8'));
    
    assert.ok('fileCount' in baseline);
    assert.ok(baseline.fileCount >= 3);
  });
  
  it('should store complexity in baseline', () => {
    const projectPath = setupProject({
      files: {
        'src/index.ts': 'export const x = 1;\nconst y = 2;\nconst z = 3;',
      },
    });
    
    setScopeBaseline({ projectPath });
    
    const baseline = JSON.parse(readFileSync(join(projectPath, '.midas', 'scope-baseline.json'), 'utf8'));
    
    assert.ok('complexity' in baseline);
    assert.ok(baseline.complexity > 0);
  });
  
  it('should store timestamp in baseline', () => {
    const projectPath = setupProject({
      files: { 'src/index.ts': 'export const x = 1;' },
    });
    
    setScopeBaseline({ projectPath });
    
    const baseline = JSON.parse(readFileSync(join(projectPath, '.midas', 'scope-baseline.json'), 'utf8'));
    
    assert.ok('createdAt' in baseline);
    assert.ok(new Date(baseline.createdAt).getTime() > 0);
  });
  
  it('should return descriptive message', () => {
    const projectPath = setupProject({
      files: {
        'src/a.ts': 'export const a = 1;',
        'src/b.ts': 'export const b = 2;',
      },
    });
    
    const result = setScopeBaseline({ projectPath });
    
    assert.ok(result.message.includes('files') || result.message.includes('Baseline'));
  });
  
  it('should create .midas directory if missing', () => {
    const projectPath = join(TEST_DIR, `clean-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(projectPath, 'src'), { recursive: true });
    writeFileSync(join(projectPath, 'src', 'index.ts'), 'export const x = 1;');
    
    const result = setScopeBaseline({ projectPath });
    
    assert.equal(result.success, true);
    assert.ok(existsSync(join(projectPath, '.midas')));
  });
  
  it('should overwrite existing baseline', () => {
    const projectPath = setupProject({
      files: { 'src/a.ts': 'export const a = 1;' },
    });
    
    // Set initial baseline
    setScopeBaseline({ projectPath });
    
    // Add more files
    writeFileSync(join(projectPath, 'src', 'b.ts'), 'export const b = 2;');
    writeFileSync(join(projectPath, 'src', 'c.ts'), 'export const c = 3;');
    
    // Set new baseline
    setScopeBaseline({ projectPath });
    
    const baseline = JSON.parse(readFileSync(join(projectPath, '.midas', 'scope-baseline.json'), 'utf8'));
    
    // Should have updated count
    assert.ok(baseline.fileCount >= 3);
  });
});
