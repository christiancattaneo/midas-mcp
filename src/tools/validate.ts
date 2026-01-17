/**
 * Validation Pipeline
 * 
 * Enforces compile/type/lint/test gates before phase advancement.
 * Gates must pass before moving from BUILD to SHIP phase.
 */

import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { sanitizePath } from '../security.js';
import { loadState, saveState, type Phase } from '../state/phase.js';
import { logger } from '../logger.js';

// ============================================================================
// SCHEMA
// ============================================================================

export const validateGatesSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  autoFix: z.boolean().optional().describe('Auto-fix lint issues if possible'),
});

export const enforceGatesSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  targetPhase: z.string().describe('Target phase to advance to'),
  targetStep: z.string().describe('Target step within phase'),
  force: z.boolean().optional().describe('Force advance even if gates fail'),
});

export type ValidateGatesInput = z.infer<typeof validateGatesSchema>;
export type EnforceGatesInput = z.infer<typeof enforceGatesSchema>;

// ============================================================================
// TYPES
// ============================================================================

interface GateResult {
  name: string;
  pass: boolean;
  output: string;
  duration: number;  // ms
  skipped?: boolean;
  command?: string;
}

interface ValidationResult {
  allPass: boolean;
  gates: GateResult[];
  canAdvance: boolean;
  blockedBy: string[];
  summary: string;
}

// ============================================================================
// GATE RUNNERS
// ============================================================================

function runGate(
  name: string,
  command: string,
  cwd: string,
  timeout = 60000
): GateResult {
  const start = Date.now();
  
  try {
    execSync(command, {
      cwd,
      timeout,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    
    return {
      name,
      pass: true,
      output: 'OK',
      duration: Date.now() - start,
      command,
    };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const output = err.stdout || err.stderr || err.message || 'Failed';
    
    return {
      name,
      pass: false,
      output: output.slice(0, 500),  // Limit output
      duration: Date.now() - start,
      command,
    };
  }
}

function detectPackageManager(projectPath: string): 'npm' | 'yarn' | 'pnpm' {
  if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(projectPath, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function hasScript(projectPath: string, script: string): boolean {
  const pkgPath = join(projectPath, 'package.json');
  if (!existsSync(pkgPath)) return false;
  
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return !!pkg.scripts?.[script];
  } catch {
    return false;
  }
}

// ============================================================================
// MAIN VALIDATION FUNCTION
// ============================================================================

export function validateGates(input: ValidateGatesInput): ValidationResult {
  const projectPath = sanitizePath(input.projectPath || process.cwd());
  const autoFix = input.autoFix ?? false;
  const pm = detectPackageManager(projectPath);
  
  const gates: GateResult[] = [];
  const blockedBy: string[] = [];
  
  // 1. TypeScript Compile
  if (existsSync(join(projectPath, 'tsconfig.json'))) {
    // Use tsc --noEmit for type checking only
    const tscResult = runGate(
      'typescript',
      `${pm} run build 2>&1 || npx tsc --noEmit 2>&1`,
      projectPath,
      120000  // 2 min for builds
    );
    gates.push(tscResult);
    
    if (!tscResult.pass) {
      blockedBy.push('TypeScript compilation errors');
    }
  } else {
    gates.push({
      name: 'typescript',
      pass: true,
      output: 'Skipped (no tsconfig.json)',
      duration: 0,
      skipped: true,
    });
  }
  
  // 2. Lint
  if (hasScript(projectPath, 'lint')) {
    const lintCommand = autoFix 
      ? `${pm} run lint -- --fix 2>&1 || ${pm} run lint 2>&1`
      : `${pm} run lint 2>&1`;
    
    const lintResult = runGate('lint', lintCommand, projectPath);
    gates.push(lintResult);
    
    if (!lintResult.pass) {
      blockedBy.push('Lint errors');
    }
  } else {
    gates.push({
      name: 'lint',
      pass: true,
      output: 'Skipped (no lint script)',
      duration: 0,
      skipped: true,
    });
  }
  
  // 3. Tests
  if (hasScript(projectPath, 'test')) {
    const testResult = runGate(
      'test',
      `${pm} test 2>&1`,
      projectPath,
      180000  // 3 min for tests
    );
    gates.push(testResult);
    
    if (!testResult.pass) {
      blockedBy.push('Tests failing');
    }
  } else {
    gates.push({
      name: 'test',
      pass: true,
      output: 'Skipped (no test script)',
      duration: 0,
      skipped: true,
    });
  }
  
  // 4. Type Check (separate from build for faster feedback)
  if (hasScript(projectPath, 'typecheck') || hasScript(projectPath, 'type-check')) {
    const script = hasScript(projectPath, 'typecheck') ? 'typecheck' : 'type-check';
    const typeResult = runGate('typecheck', `${pm} run ${script} 2>&1`, projectPath);
    gates.push(typeResult);
    
    if (!typeResult.pass) {
      blockedBy.push('Type errors');
    }
  }
  
  // Calculate results
  const passedGates = gates.filter(g => g.pass);
  const failedGates = gates.filter(g => !g.pass && !g.skipped);
  const allPass = failedGates.length === 0;
  
  // Determine if we can advance
  // Only strict for BUILD -> SHIP transition
  const state = loadState(projectPath);
  const isPreShip = state.current.phase === 'BUILD' && 
                    'step' in state.current && 
                    ['TEST', 'DEBUG'].includes(state.current.step);
  
  const canAdvance = allPass || !isPreShip;
  
  const summary = allPass
    ? `All gates pass (${passedGates.length}/${gates.length})`
    : `${failedGates.length} gates failing: ${blockedBy.join(', ')}`;
  
  return {
    allPass,
    gates,
    canAdvance,
    blockedBy,
    summary,
  };
}

// ============================================================================
// ENFORCED PHASE ADVANCEMENT
// ============================================================================

export function enforceGatesAndAdvance(input: EnforceGatesInput): {
  success: boolean;
  newPhase: Phase;
  validation: ValidationResult;
  message: string;
} {
  const projectPath = sanitizePath(input.projectPath || process.cwd());
  const { targetPhase, targetStep, force } = input;
  
  // First, validate gates
  const validation = validateGates({ projectPath });
  
  // Check if we need to block
  const isAdvancingToShipOrGrow = ['SHIP', 'GROW'].includes(targetPhase.toUpperCase());
  const shouldBlock = isAdvancingToShipOrGrow && !validation.allPass && !force;
  
  if (shouldBlock) {
    return {
      success: false,
      newPhase: loadState(projectPath).current,
      validation,
      message: `Cannot advance to ${targetPhase}. Gates failing: ${validation.blockedBy.join(', ')}`,
    };
  }
  
  // Advance phase
  const state = loadState(projectPath);
  state.history.push(state.current);
  
  let newPhase: Phase;
  const upperPhase = targetPhase.toUpperCase();
  const upperStep = targetStep.toUpperCase();
  
  switch (upperPhase) {
    case 'PLAN':
    case 'PLAN':
      newPhase = { phase: 'PLAN', step: upperStep as any };
      break;
    case 'BUILD':
      newPhase = { phase: 'BUILD', step: upperStep as any };
      break;
    case 'SHIP':
      newPhase = { phase: 'SHIP', step: upperStep as any };
      break;
    case 'GROW':
      newPhase = { phase: 'GROW', step: upperStep as any };
      break;
    default:
      newPhase = { phase: 'IDLE' };
  }
  
  state.current = newPhase;
  saveState(projectPath, state);
  
  logger.info('Phase advanced with gate validation', {
    to: newPhase,
    gatesPass: validation.allPass,
    forced: force,
  });
  
  const message = validation.allPass
    ? `Advanced to ${targetPhase}:${targetStep}. All gates passing.`
    : `Advanced to ${targetPhase}:${targetStep} (forced). Warning: ${validation.blockedBy.join(', ')}`;
  
  return {
    success: true,
    newPhase,
    validation,
    message,
  };
}
