/**
 * Tech Stack Detection and Project Rules Generation
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, extname } from 'path';
import { sanitizePath } from './security.js';

export interface TechStack {
  language: 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'swift' | 'unknown';
  framework?: string;
  runtime?: string;
  hasTests: boolean;
  hasDocs: boolean;
  hasCI: boolean;
  dependencies: string[];
}

/**
 * Detect tech stack from project files
 */
export function detectTechStack(projectPath: string): TechStack {
  const safePath = sanitizePath(projectPath);
  
  const stack: TechStack = {
    language: 'unknown',
    hasTests: false,
    hasDocs: false,
    hasCI: false,
    dependencies: [],
  };
  
  // Check for package.json (Node.js/JavaScript/TypeScript)
  const pkgPath = join(safePath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      stack.dependencies = Object.keys(allDeps).slice(0, 20);
      
      // Detect TypeScript
      if (allDeps.typescript || existsSync(join(safePath, 'tsconfig.json'))) {
        stack.language = 'typescript';
      } else {
        stack.language = 'javascript';
      }
      
      // Detect framework
      if (allDeps.next) stack.framework = 'Next.js';
      else if (allDeps.react) stack.framework = 'React';
      else if (allDeps.vue) stack.framework = 'Vue';
      else if (allDeps.svelte) stack.framework = 'Svelte';
      else if (allDeps.express) stack.framework = 'Express';
      else if (allDeps.fastify) stack.framework = 'Fastify';
      else if (allDeps['@hono/node-server'] || allDeps.hono) stack.framework = 'Hono';
      
      // Detect runtime
      if (allDeps.bun) stack.runtime = 'Bun';
      else stack.runtime = 'Node.js';
      
      // Check for tests
      if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
        stack.hasTests = true;
      }
    } catch {
      // Invalid package.json
    }
  }
  
  // Check for Python
  const reqPath = join(safePath, 'requirements.txt');
  const pyprojectPath = join(safePath, 'pyproject.toml');
  if (existsSync(reqPath) || existsSync(pyprojectPath)) {
    stack.language = 'python';
    if (existsSync(reqPath)) {
      const reqs = readFileSync(reqPath, 'utf-8');
      if (reqs.includes('fastapi')) stack.framework = 'FastAPI';
      else if (reqs.includes('django')) stack.framework = 'Django';
      else if (reqs.includes('flask')) stack.framework = 'Flask';
    }
  }
  
  // Check for Go
  if (existsSync(join(safePath, 'go.mod'))) {
    stack.language = 'go';
  }
  
  // Check for Rust
  if (existsSync(join(safePath, 'Cargo.toml'))) {
    stack.language = 'rust';
  }
  
  // Check for Swift
  if (existsSync(join(safePath, 'Package.swift'))) {
    stack.language = 'swift';
  }
  
  // Check for docs
  stack.hasDocs = existsSync(join(safePath, 'docs')) || existsSync(join(safePath, 'README.md'));
  
  // Check for CI
  stack.hasCI = existsSync(join(safePath, '.github', 'workflows'));
  
  // Check for tests (general)
  if (!stack.hasTests) {
    try {
      const files = readdirSync(safePath, { withFileTypes: true });
      stack.hasTests = files.some(f => 
        f.name.includes('test') || f.name.includes('spec') || f.name === '__tests__'
      );
    } catch {
      // Can't read directory
    }
  }
  
  return stack;
}

/**
 * Generate project-specific .cursorrules based on tech stack
 */
export function generateCursorRules(projectPath: string, projectName: string): string {
  const stack = detectTechStack(projectPath);
  
  const lines: string[] = [
    `# Project: ${projectName}`,
    '',
    '# Golden Code Methodology',
    '- Follow the 4 phases: EAGLE_SIGHT -> BUILD -> SHIP -> GROW',
    '- Use the 7-step BUILD cycle: RULES -> INDEX -> READ -> RESEARCH -> IMPLEMENT -> TEST -> DEBUG',
    '- When stuck: Use Tornado (research + logs + tests)',
    '',
  ];
  
  // Language-specific rules
  if (stack.language === 'typescript') {
    lines.push('# TypeScript Rules');
    lines.push('- Use strict mode (strict: true in tsconfig)');
    lines.push('- No `any` types - use `unknown` and narrow with type guards');
    lines.push('- Explicit return types on exported functions');
    lines.push('- Use `type` imports: `import type { X } from ...`');
    lines.push('- Always use .js extension in ESM imports');
    lines.push('');
  } else if (stack.language === 'javascript') {
    lines.push('# JavaScript Rules');
    lines.push('- Use ES modules (import/export)');
    lines.push('- Prefer const over let, never use var');
    lines.push('- Use async/await over raw promises');
    lines.push('');
  } else if (stack.language === 'python') {
    lines.push('# Python Rules');
    lines.push('- Use type hints on all function signatures');
    lines.push('- Follow PEP 8 style guide');
    lines.push('- Use dataclasses or Pydantic for data structures');
    lines.push('- Virtual environment required (venv or poetry)');
    lines.push('');
  } else if (stack.language === 'go') {
    lines.push('# Go Rules');
    lines.push('- Follow effective Go patterns');
    lines.push('- Handle all errors explicitly');
    lines.push('- Use gofmt for formatting');
    lines.push('- Prefer composition over inheritance');
    lines.push('');
  } else if (stack.language === 'rust') {
    lines.push('# Rust Rules');
    lines.push('- Follow Rust API guidelines');
    lines.push('- Handle all Results and Options');
    lines.push('- Use clippy for linting');
    lines.push('- Document public APIs');
    lines.push('');
  }
  
  // Framework-specific rules
  if (stack.framework) {
    lines.push(`# ${stack.framework} Rules`);
    if (stack.framework === 'Next.js') {
      lines.push('- Use App Router (app/) over Pages Router');
      lines.push('- Server Components by default, use "use client" sparingly');
      lines.push('- Colocate components with their routes');
    } else if (stack.framework === 'React') {
      lines.push('- Functional components with hooks');
      lines.push('- Colocate state with components that need it');
      lines.push('- Extract reusable logic to custom hooks');
    } else if (stack.framework === 'Express' || stack.framework === 'Fastify') {
      lines.push('- Validate all request inputs');
      lines.push('- Use middleware for cross-cutting concerns');
      lines.push('- Centralized error handling');
    }
    lines.push('');
  }
  
  // Testing rules
  lines.push('# Testing');
  if (stack.hasTests) {
    lines.push('- Run tests before committing: npm test');
    lines.push('- Write tests for new features');
    lines.push('- Test edge cases and error paths');
  } else {
    lines.push('- Set up testing framework');
    lines.push('- Write tests for all business logic');
  }
  lines.push('');
  
  // Security rules
  lines.push('# Security');
  lines.push('- Never commit API keys or secrets');
  lines.push('- Validate and sanitize all user input');
  lines.push('- Use environment variables for configuration');
  lines.push('');
  
  // Midas integration
  lines.push('# Midas Integration');
  lines.push('- Call midas_analyze at session start');
  lines.push('- Call midas_journal_save after significant changes');
  lines.push('- Call midas_tornado when stuck on the same error');
  
  return lines.join('\n');
}

/**
 * Write .cursorrules to project
 */
export function writeCursorRules(projectPath: string, projectName: string): { success: boolean; path: string } {
  const safePath = sanitizePath(projectPath);
  const rules = generateCursorRules(safePath, projectName);
  const rulesPath = join(safePath, '.cursorrules');
  
  writeFileSync(rulesPath, rules);
  
  return { success: true, path: rulesPath };
}
