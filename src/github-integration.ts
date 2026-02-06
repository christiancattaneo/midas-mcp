/**
 * GitHub Integration for Midas
 * 
 * Integrates with Claude Code's --from-pr flag for PR-based automation.
 * 
 * Features:
 * - Process PRs with Midas methodology context
 * - Run verification gates on PR code
 * - Add PR review comments based on phase
 * - Auto-update gameplan based on merged PRs
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { detectPhaseFromArtifacts } from './phase-detector.js';
import { PILOT_RESULT_SCHEMA, type StructuredPilotResult } from './pilot.js';
import { sanitizePath } from './security.js';

export interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
  url: string;
}

export interface PRReviewResult {
  success: boolean;
  phase: string;
  comments: string[];
  gatesPass: boolean;
  recommendation: 'approve' | 'request_changes' | 'comment';
}

/**
 * Parse a GitHub PR URL into components
 */
export function parsePRUrl(url: string): PRContext | null {
  // Match: https://github.com/owner/repo/pull/123
  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
  if (!match) return null;
  
  return {
    owner: match[1],
    repo: match[2],
    prNumber: parseInt(match[3], 10),
    url,
  };
}

/**
 * Review a PR using Claude Code's --from-pr flag with Midas methodology
 */
export async function reviewPR(
  prUrl: string,
  projectPath: string = process.cwd()
): Promise<PRReviewResult> {
  const safePath = sanitizePath(projectPath);
  const pr = parsePRUrl(prUrl);
  
  if (!pr) {
    return {
      success: false,
      phase: 'unknown',
      comments: ['Invalid PR URL format'],
      gatesPass: false,
      recommendation: 'comment',
    };
  }
  
  // Detect current phase
  const detection = detectPhaseFromArtifacts(safePath);
  const phase = detection.phase.phase === 'IDLE' 
    ? 'PLAN' 
    : detection.phase.phase;
  
  // Build review prompt based on phase
  const reviewPrompt = buildReviewPrompt(phase, pr);
  
  return new Promise((resolve) => {
    const args = [
      '--from-pr', prUrl,
      '-p', reviewPrompt,
      '--output-format', 'json',
      '--json-schema', JSON.stringify(PR_REVIEW_SCHEMA),
      '--max-turns', '5',
    ];
    
    let output = '';
    let stderr = '';
    
    const proc = spawn('claude', args, {
      cwd: safePath,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });
    
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    
    proc.on('error', () => {
      resolve({
        success: false,
        phase,
        comments: ['Failed to spawn claude CLI'],
        gatesPass: false,
        recommendation: 'comment',
      });
    });
    
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({
          success: false,
          phase,
          comments: [`Review failed with exit code ${code}`],
          gatesPass: false,
          recommendation: 'comment',
        });
        return;
      }
      
      try {
        const result = JSON.parse(output) as PRReviewOutput;
        resolve({
          success: true,
          phase,
          comments: result.comments || [],
          gatesPass: result.gatesPass ?? false,
          recommendation: result.recommendation || 'comment',
        });
      } catch {
        resolve({
          success: true,
          phase,
          comments: [output.slice(0, 500)],
          gatesPass: false,
          recommendation: 'comment',
        });
      }
    });
  });
}

/**
 * Build a phase-appropriate review prompt
 */
function buildReviewPrompt(phase: string, pr: PRContext): string {
  const basePrompt = `Review this PR (#${pr.prNumber}) using the Midas Golden Code methodology.

Current project phase: ${phase}

Review criteria:`;

  const phasePrompts: Record<string, string> = {
    PLAN: `
- Does this PR add/update planning documents?
- Is the PRD or gameplan being properly structured?
- Are requirements clearly defined?
- Check for scope creep against the PRD.`,

    BUILD: `
- Does the code follow the project's .cursorrules conventions?
- Are there tests for new functionality?
- Is error handling implemented properly?
- Check for common issues: hardcoded secrets, console.log, TODO comments
- Verify the implementation matches the gameplan task.`,

    SHIP: `
- Are all verification gates passing (build, test, lint)?
- Is the code production-ready (no debug code, proper logging)?
- Are there security concerns (secrets, injection, auth)?
- Is the version appropriately bumped?
- Is documentation updated?`,

    GROW: `
- Does this PR address user feedback?
- Are metrics/monitoring properly integrated?
- Does it maintain backward compatibility?
- Is the change documented for users?`,
  };

  return basePrompt + (phasePrompts[phase] || phasePrompts.BUILD) + `

Respond with:
1. List of specific comments/issues found
2. Whether this would pass gates (build/test/lint)
3. Your recommendation: approve, request_changes, or comment`;
}

/**
 * JSON Schema for structured PR review output
 */
const PR_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    comments: {
      type: 'array',
      items: { type: 'string' },
      description: 'Specific review comments or issues found',
    },
    gatesPass: {
      type: 'boolean',
      description: 'Whether this PR would pass build/test/lint gates',
    },
    recommendation: {
      type: 'string',
      enum: ['approve', 'request_changes', 'comment'],
      description: 'Overall review recommendation',
    },
    summary: {
      type: 'string',
      description: 'Brief summary of the review',
    },
  },
  required: ['comments', 'gatesPass', 'recommendation'],
} as const;

interface PRReviewOutput {
  comments?: string[];
  gatesPass?: boolean;
  recommendation?: 'approve' | 'request_changes' | 'comment';
  summary?: string;
}

/**
 * CLI handler for: midas pr <url>
 */
export async function runPRReview(args: string[]): Promise<void> {
  const prUrl = args[0];
  
  if (!prUrl) {
    console.log('\n  Usage: midas pr <github-pr-url>');
    console.log('  Example: midas pr https://github.com/owner/repo/pull/123\n');
    return;
  }
  
  console.log('\n  Reviewing PR with Midas methodology...\n');
  
  const result = await reviewPR(prUrl);
  
  const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
  };
  
  // Display result
  console.log(`  ${colors.bold}Phase:${colors.reset} ${result.phase}`);
  console.log(`  ${colors.bold}Gates:${colors.reset} ${result.gatesPass ? colors.green + 'PASS' : colors.red + 'FAIL'}${colors.reset}`);
  
  const recColors: Record<string, string> = {
    approve: colors.green,
    request_changes: colors.red,
    comment: colors.yellow,
  };
  console.log(`  ${colors.bold}Recommendation:${colors.reset} ${recColors[result.recommendation]}${result.recommendation}${colors.reset}`);
  
  if (result.comments.length > 0) {
    console.log(`\n  ${colors.bold}Comments:${colors.reset}`);
    for (const comment of result.comments) {
      console.log(`    ${colors.dim}-${colors.reset} ${comment}`);
    }
  }
  
  console.log('');
}
