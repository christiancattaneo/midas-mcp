/**
 * Deterministic Phase Detection
 * 
 * This module detects the current development phase based on artifacts and file
 * existence, NOT AI inference. This provides consistent, reproducible results.
 * 
 * Phase detection rules:
 * 
 * PLAN phase:
 *   - IDEA: No planning docs exist
 *   - RESEARCH: Only partial ideas documented
 *   - BRAINLIFT: brainlift.md missing or incomplete
 *   - PRD: prd.md missing or incomplete  
 *   - GAMEPLAN: gameplan.md missing or incomplete
 * 
 * BUILD phase:
 *   - RULES: .cursorrules missing
 *   - INDEX/READ/RESEARCH: Early development, few source files
 *   - IMPLEMENT: Active development, gameplan tasks in progress
 *   - TEST: Tests exist but may be failing
 *   - DEBUG: Gates failing, errors present
 * 
 * SHIP phase:
 *   - REVIEW: All gates pass, preparing for release
 *   - DEPLOY: Version bumped, deploying
 *   - MONITOR: Deployed, watching
 * 
 * GROW phase:
 *   - DONE: Project shipped and live
 */

import { existsSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import type { Phase, PlanStep, BuildStep, ShipStep, GrowStep } from './state/phase.js';
import { discoverDocsSync } from './docs-discovery.js';
import { getGatesStatus } from './tracker.js';
import { getGameplanProgress } from './gameplan-tracker.js';
import { sanitizePath, isShellSafe } from './security.js';

export interface DetectionResult {
  phase: Phase;
  confidence: number; // 0-100, based on artifact clarity
  reason: string;
  artifacts: string[]; // Which artifacts influenced this detection
}

/**
 * Detect current phase from artifacts only - no AI calls
 */
export function detectPhaseFromArtifacts(projectPath: string): DetectionResult {
  const safePath = sanitizePath(projectPath);
  
  // Check planning docs
  const docs = discoverDocsSync(safePath);
  const hasBrainlift = !!docs.brainlift;
  const hasPrd = !!docs.prd;
  const hasGameplan = !!docs.gameplan;
  const hasCursorrules = existsSync(join(safePath, '.cursorrules'));
  
  // Check source files
  const hasSrc = existsSync(join(safePath, 'src'));
  const srcFileCount = hasSrc ? countFiles(join(safePath, 'src')) : 0;
  
  // Check tests
  const hasTests = existsSync(join(safePath, 'src', 'tests')) || 
                   existsSync(join(safePath, 'tests')) ||
                   existsSync(join(safePath, '__tests__'));
  
  // Check gates
  const gates = getGatesStatus(safePath);
  
  // Check git for version/deploy signals
  const gitSignals = getGitSignals(safePath);
  
  // Check gameplan progress
  const gameplan = getGameplanProgress(safePath);
  
  // Decision tree (order matters - most specific first)
  
  // GROW: Deployed and live
  if (gitSignals.hasVersionTag && gitSignals.recentPublish) {
    return {
      phase: { phase: 'GROW', step: 'DONE' as GrowStep },
      confidence: 90,
      reason: 'Project has version tags and recent publish commits',
      artifacts: ['git tags', 'publish commits'],
    };
  }
  
  // SHIP: Gates pass, preparing for release
  if (gates.allPass && hasGameplan && gameplan.actual >= 80) {
    if (gitSignals.hasVersionBump) {
      return {
        phase: { phase: 'SHIP', step: 'DEPLOY' as ShipStep },
        confidence: 85,
        reason: 'Version bumped, ready to deploy',
        artifacts: ['package.json version', 'passing gates'],
      };
    }
    return {
      phase: { phase: 'SHIP', step: 'REVIEW' as ShipStep },
      confidence: 80,
      reason: 'All gates pass, gameplan mostly complete',
      artifacts: ['gates', 'gameplan progress'],
    };
  }
  
  // BUILD: Active development
  if (hasCursorrules && hasSrc) {
    // DEBUG: Gates failing
    if (gates.failing.length > 0) {
      return {
        phase: { phase: 'BUILD', step: 'DEBUG' as BuildStep },
        confidence: 85,
        reason: `Gates failing: ${gates.failing.join(', ')}`,
        artifacts: ['gates status'],
      };
    }
    
    // TEST: Tests exist, running verification
    if (hasTests && gates.allPass) {
      return {
        phase: { phase: 'BUILD', step: 'TEST' as BuildStep },
        confidence: 75,
        reason: 'Tests present and passing, verifying',
        artifacts: ['tests', 'gates'],
      };
    }
    
    // IMPLEMENT: Actively coding
    if (srcFileCount > 5) {
      return {
        phase: { phase: 'BUILD', step: 'IMPLEMENT' as BuildStep },
        confidence: 70,
        reason: 'Active development with source files',
        artifacts: ['src files', '.cursorrules'],
      };
    }
    
    // INDEX/READ: Early development
    return {
      phase: { phase: 'BUILD', step: 'INDEX' as BuildStep },
      confidence: 65,
      reason: 'Project initialized, exploring codebase',
      artifacts: ['.cursorrules'],
    };
  }
  
  // BUILD:RULES - Need to set up conventions
  if (hasGameplan && !hasCursorrules) {
    return {
      phase: { phase: 'BUILD', step: 'RULES' as BuildStep },
      confidence: 80,
      reason: 'Gameplan exists but .cursorrules missing',
      artifacts: ['gameplan.md'],
    };
  }
  
  // PLAN phase - determine which step based on docs
  if (!hasBrainlift) {
    if (!docs.brainlift && !docs.prd && !docs.gameplan) {
      return {
        phase: { phase: 'PLAN', step: 'IDEA' as PlanStep },
        confidence: 90,
        reason: 'No planning docs exist',
        artifacts: [],
      };
    }
    return {
      phase: { phase: 'PLAN', step: 'BRAINLIFT' as PlanStep },
      confidence: 80,
      reason: 'brainlift.md missing',
      artifacts: [],
    };
  }
  
  if (!hasPrd) {
    return {
      phase: { phase: 'PLAN', step: 'PRD' as PlanStep },
      confidence: 80,
      reason: 'prd.md missing',
      artifacts: ['brainlift.md'],
    };
  }
  
  if (!hasGameplan) {
    return {
      phase: { phase: 'PLAN', step: 'GAMEPLAN' as PlanStep },
      confidence: 80,
      reason: 'gameplan.md missing',
      artifacts: ['brainlift.md', 'prd.md'],
    };
  }
  
  // All planning docs exist but no .cursorrules - ready to build
  return {
    phase: { phase: 'BUILD', step: 'RULES' as BuildStep },
    confidence: 85,
    reason: 'All planning docs complete, ready to start building',
    artifacts: ['brainlift.md', 'prd.md', 'gameplan.md'],
  };
}

/**
 * Count files in a directory recursively
 */
function countFiles(dir: string, depth = 0): number {
  if (depth > 5 || !existsSync(dir)) return 0;
  
  let count = 0;
  const ignore = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__'];
  
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ignore.includes(entry.name) || entry.name.startsWith('.')) continue;
      
      if (entry.isDirectory()) {
        count += countFiles(join(dir, entry.name), depth + 1);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js') || 
                 entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx')) {
        count++;
      }
    }
  } catch {
    // Ignore errors
  }
  
  return count;
}

interface GitSignals {
  hasVersionTag: boolean;
  hasVersionBump: boolean;
  recentPublish: boolean;
}

/**
 * Get signals from git history about deployment status
 */
function getGitSignals(projectPath: string): GitSignals {
  const signals: GitSignals = {
    hasVersionTag: false,
    hasVersionBump: false,
    recentPublish: false,
  };
  
  if (!existsSync(join(projectPath, '.git')) || !isShellSafe(projectPath)) {
    return signals;
  }
  
  try {
    // Check for version tags
    const tags = execSync('git tag -l "v*"', { 
      cwd: projectPath, 
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    signals.hasVersionTag = tags.length > 0;
    
    // Check recent commits for version bump / publish
    const recentCommits = execSync('git log -10 --format=%s', {
      cwd: projectPath,
      encoding: 'utf-8', 
      timeout: 5000,
    }).toLowerCase();
    
    signals.hasVersionBump = recentCommits.includes('bump') || 
                             recentCommits.includes('version') ||
                             /\d+\.\d+\.\d+/.test(recentCommits);
    
    signals.recentPublish = recentCommits.includes('publish') ||
                            recentCommits.includes('release') ||
                            recentCommits.includes('deploy');
  } catch {
    // Ignore git errors
  }
  
  return signals;
}

/**
 * Format detection result for display
 */
export function formatDetection(result: DetectionResult): string {
  const phase = result.phase;
  const phaseStr = phase.phase === 'IDLE' ? 'IDLE' : 
                   `${phase.phase}:${phase.step}`;
  
  return `Phase: ${phaseStr} (${result.confidence}% confidence)
Reason: ${result.reason}
Artifacts: ${result.artifacts.length > 0 ? result.artifacts.join(', ') : 'none'}`;
}
