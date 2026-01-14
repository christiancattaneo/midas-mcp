import { z } from 'zod';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { execSync } from 'child_process';
import { logger } from '../logger.js';
import { sanitizePath } from '../security.js';
import { getJournalEntries } from './journal.js';

// ============================================================================
// Project Type Detection
// ============================================================================

export type ProjectType = 'cli' | 'library' | 'web-app' | 'api' | 'mobile' | 'monorepo' | 'unknown';

export interface ProjectTypeResult {
  type: ProjectType;
  confidence: number;
  indicators: string[];
  framework?: string;
  irrelevantSteps: string[];
}

export const detectProjectTypeSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
});

export type DetectProjectTypeInput = z.infer<typeof detectProjectTypeSchema>;

export function detectProjectType(input: DetectProjectTypeInput): ProjectTypeResult {
  const projectPath = sanitizePath(input.projectPath);
  const indicators: string[] = [];
  let type: ProjectType = 'unknown';
  let confidence = 0;
  let framework: string | undefined;
  const irrelevantSteps: string[] = [];

  // Check package.json
  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      
      // CLI tool detection
      if (pkg.bin) {
        type = 'cli';
        confidence = 90;
        indicators.push('Has "bin" field in package.json');
        irrelevantSteps.push('API endpoints', 'UI components', 'Mobile layouts');
      }
      
      // Library detection
      if (!pkg.bin && (pkg.main || pkg.exports) && !pkg.dependencies?.react && !pkg.dependencies?.express) {
        type = 'library';
        confidence = 80;
        indicators.push('Has "main" or "exports" field, no app framework');
        irrelevantSteps.push('Deployment configuration', 'Monitoring setup', 'UI testing');
      }
      
      // Web app detection
      const webFrameworks = ['react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'remix'];
      for (const fw of webFrameworks) {
        if (pkg.dependencies?.[fw] || pkg.devDependencies?.[fw]) {
          type = 'web-app';
          framework = fw;
          confidence = 85;
          indicators.push(`Uses ${fw} framework`);
          irrelevantSteps.push('CLI arguments', 'Package publishing');
          break;
        }
      }
      
      // API detection
      const apiFrameworks = ['express', 'fastify', 'koa', 'hapi', 'nestjs'];
      for (const fw of apiFrameworks) {
        if (pkg.dependencies?.[fw] || pkg.devDependencies?.[fw]) {
          type = 'api';
          framework = fw;
          confidence = 85;
          indicators.push(`Uses ${fw} for API`);
          irrelevantSteps.push('UI components', 'Mobile layouts', 'Package publishing');
          break;
        }
      }
      
      // Mobile detection
      const mobileFrameworks = ['react-native', 'expo', 'ionic', 'capacitor'];
      for (const fw of mobileFrameworks) {
        if (pkg.dependencies?.[fw] || pkg.devDependencies?.[fw]) {
          type = 'mobile';
          framework = fw;
          confidence = 85;
          indicators.push(`Uses ${fw} for mobile`);
          irrelevantSteps.push('Server deployment', 'Docker configuration');
          break;
        }
      }
      
      // Monorepo detection
      if (pkg.workspaces || existsSync(join(projectPath, 'lerna.json')) || existsSync(join(projectPath, 'pnpm-workspace.yaml'))) {
        type = 'monorepo';
        confidence = 90;
        indicators.push('Has workspaces or monorepo config');
        irrelevantSteps.push('Single package deployment');
      }
      
    } catch (error) {
      logger.debug('Error parsing package.json for project type detection', { error: String(error) });
    }
  }
  
  // Check Cargo.toml for Rust projects
  const cargoPath = join(projectPath, 'Cargo.toml');
  if (existsSync(cargoPath)) {
    try {
      const cargo = readFileSync(cargoPath, 'utf8');
      if (cargo.includes('[[bin]]') || cargo.includes('[package]') && cargo.includes('name')) {
        type = 'cli';
        confidence = 85;
        indicators.push('Rust binary project (Cargo.toml)');
        irrelevantSteps.push('npm publish', 'Web deployment');
      }
    } catch (error) {
      logger.debug('Error reading Cargo.toml', { error: String(error) });
    }
  }
  
  // Check pyproject.toml for Python projects
  const pyprojectPath = join(projectPath, 'pyproject.toml');
  if (existsSync(pyprojectPath)) {
    try {
      const pyproject = readFileSync(pyprojectPath, 'utf8');
      if (pyproject.includes('[project.scripts]') || pyproject.includes('[tool.poetry.scripts]')) {
        type = 'cli';
        confidence = 85;
        indicators.push('Python CLI project (pyproject.toml scripts)');
        irrelevantSteps.push('npm publish', 'Web deployment');
      } else if (pyproject.includes('django') || pyproject.includes('flask') || pyproject.includes('fastapi')) {
        type = 'api';
        confidence = 80;
        indicators.push('Python web framework detected');
        irrelevantSteps.push('Package publishing');
      }
    } catch (error) {
      logger.debug('Error reading pyproject.toml', { error: String(error) });
    }
  }

  return { type, confidence, indicators, framework, irrelevantSteps };
}

// ============================================================================
// Scope Creep Detection
// ============================================================================

export interface ScopeMetrics {
  initialFileCount: number;
  currentFileCount: number;
  initialComplexity: number;
  currentComplexity: number;
  driftPercentage: number;
  featuresAdded: string[];
  warning: boolean;
  message: string;
}

export const checkScopeCreepSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
});

export type CheckScopeCreepInput = z.infer<typeof checkScopeCreepSchema>;

/**
 * Estimate code complexity by counting files and lines
 */
function countCodeMetrics(projectPath: string): { files: number; lines: number } {
  let files = 0;
  let lines = 0;
  
  function walk(dir: string, depth: number) {
    if (depth > 5) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!['node_modules', '.git', '.midas', 'dist', 'build', 'coverage'].includes(entry.name)) {
            walk(fullPath, depth + 1);
          }
        } else if (entry.isFile() && /\.(ts|js|tsx|jsx|py|rs|go|java|c|cpp|h|hpp)$/.test(entry.name)) {
          files++;
          try {
            const content = readFileSync(fullPath, 'utf8');
            lines += content.split('\n').length;
          } catch {
            // Skip unreadable files
          }
        }
      }
    } catch (error) {
      logger.debug('Error walking directory', { dir, error: String(error) });
    }
  }
  
  walk(projectPath, 0);
  return { files, lines };
}

/**
 * Get initial scope from PRD or first journal entry
 */
function getInitialScope(projectPath: string): { fileCount: number; complexity: number } | null {
  // Check for scope baseline in .midas/scope-baseline.json
  const baselinePath = join(projectPath, '.midas', 'scope-baseline.json');
  if (existsSync(baselinePath)) {
    try {
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
      return { fileCount: baseline.fileCount || 0, complexity: baseline.complexity || 0 };
    } catch {
      // Fall through
    }
  }
  
  // Try to infer from git history (first commit)
  try {
    const firstCommit = execSync('git rev-list --max-parents=0 HEAD', { cwd: projectPath, encoding: 'utf8' }).trim();
    if (firstCommit) {
      const filesAtStart = execSync(`git ls-tree -r --name-only ${firstCommit}`, { cwd: projectPath, encoding: 'utf8' })
        .split('\n')
        .filter(f => /\.(ts|js|tsx|jsx|py|rs|go|java|c|cpp|h|hpp)$/.test(f));
      return { fileCount: filesAtStart.length, complexity: filesAtStart.length * 50 }; // Rough estimate
    }
  } catch {
    // No git history
  }
  
  return null;
}

/**
 * Extract features mentioned in journal entries
 */
function getAddedFeatures(projectPath: string): string[] {
  const entries = getJournalEntries({ projectPath, limit: 50 });
  const features: string[] = [];
  
  for (const entry of entries) {
    // Look for feature-related keywords in journal titles
    const title = entry.title.toLowerCase();
    if (title.includes('add') || title.includes('implement') || title.includes('feat') || title.includes('new')) {
      features.push(entry.title);
    }
  }
  
  return features.slice(0, 10); // Limit to 10 recent features
}

export function checkScopeCreep(input: CheckScopeCreepInput): ScopeMetrics {
  const projectPath = sanitizePath(input.projectPath);
  
  const currentMetrics = countCodeMetrics(projectPath);
  const initialScope = getInitialScope(projectPath);
  const featuresAdded = getAddedFeatures(projectPath);
  
  let driftPercentage = 0;
  let warning = false;
  let message = '';
  
  if (initialScope && initialScope.fileCount > 0) {
    driftPercentage = Math.round(((currentMetrics.files - initialScope.fileCount) / initialScope.fileCount) * 100);
    
    if (driftPercentage > 100) {
      warning = true;
      message = `Scope has grown ${driftPercentage}% (${initialScope.fileCount} → ${currentMetrics.files} files). Consider: split project, defer features, or update PRD.`;
    } else if (driftPercentage > 50) {
      warning = true;
      message = `Scope growing: ${driftPercentage}% increase. Review if all features are in PRD.`;
    } else if (driftPercentage > 0) {
      message = `Healthy growth: ${driftPercentage}% increase since baseline.`;
    } else {
      message = 'Project size stable or reduced.';
    }
  } else {
    message = 'No baseline found. Run midas_set_scope_baseline to track growth.';
  }
  
  return {
    initialFileCount: initialScope?.fileCount || 0,
    currentFileCount: currentMetrics.files,
    initialComplexity: initialScope?.complexity || 0,
    currentComplexity: currentMetrics.lines,
    driftPercentage,
    featuresAdded,
    warning,
    message,
  };
}

// ============================================================================
// Set Scope Baseline
// ============================================================================

export const setScopeBaselineSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
});

export type SetScopeBaselineInput = z.infer<typeof setScopeBaselineSchema>;

export function setScopeBaseline(input: SetScopeBaselineInput): { success: boolean; message: string } {
  const projectPath = sanitizePath(input.projectPath);
  const { mkdirSync, writeFileSync } = require('fs');
  
  const metrics = countCodeMetrics(projectPath);
  const baselinePath = join(projectPath, '.midas', 'scope-baseline.json');
  
  try {
    mkdirSync(join(projectPath, '.midas'), { recursive: true });
    writeFileSync(baselinePath, JSON.stringify({
      fileCount: metrics.files,
      complexity: metrics.lines,
      createdAt: new Date().toISOString(),
    }, null, 2));
    
    return {
      success: true,
      message: `Baseline set: ${metrics.files} files, ${metrics.lines} lines.`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to save baseline: ${String(error)}`,
    };
  }
}
