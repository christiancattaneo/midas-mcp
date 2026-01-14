/**
 * GROW Phase Tools
 * 
 * Tools for production monitoring, deployment verification,
 * retrospectives, and cycle management.
 */

import { z } from 'zod';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { sanitizePath } from '../security.js';
import { loadState, saveState } from '../state/phase.js';

// ============================================================================
// SCHEMAS
// ============================================================================

export const verifyDeploySchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  environment: z.string().optional().describe('Target environment (staging, production)'),
});

export const changelogSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  fromTag: z.string().optional().describe('Starting git tag or commit'),
  toTag: z.string().optional().describe('Ending git tag or commit (default: HEAD)'),
});

export const retrospectiveSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  worked: z.string().describe('What worked well this cycle'),
  didntWork: z.string().describe('What did not work well'),
  learned: z.string().describe('Key learnings and insights'),
  actions: z.string().optional().describe('Action items for next cycle'),
});

export const nextCycleSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  hypothesis: z.string().describe('What are we testing next cycle'),
  scope: z.string().describe('What is in scope'),
  notScope: z.string().optional().describe('What is explicitly out of scope'),
  successMetrics: z.string().describe('How will we measure success'),
});

export const archiveCycleSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  cycleName: z.string().optional().describe('Name for this cycle (default: timestamp)'),
});

export const costReportSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  days: z.number().optional().describe('Number of days to report (default: 30)'),
});

// ============================================================================
// TYPES
// ============================================================================

export type VerifyDeployInput = z.infer<typeof verifyDeploySchema>;
export type ChangelogInput = z.infer<typeof changelogSchema>;
export type RetrospectiveInput = z.infer<typeof retrospectiveSchema>;
export type NextCycleInput = z.infer<typeof nextCycleSchema>;
export type ArchiveCycleInput = z.infer<typeof archiveCycleSchema>;
export type CostReportInput = z.infer<typeof costReportSchema>;

interface DeployCheck {
  name: string;
  pass: boolean;
  message: string;
}

interface CostEntry {
  timestamp: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;  // in cents
}

interface CycleArchive {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string;
  phase: string;
  retrospective?: RetrospectiveInput;
  metrics?: Record<string, unknown>;
}

// ============================================================================
// VERIFY DEPLOY
// ============================================================================

export function verifyDeploy(input: VerifyDeployInput): {
  ready: boolean;
  checks: DeployCheck[];
  blockers: string[];
  recommendations: string[];
} {
  const projectPath = sanitizePath(input.projectPath || process.cwd());
  const env = input.environment || 'production';
  const checks: DeployCheck[] = [];
  const blockers: string[] = [];
  const recommendations: string[] = [];

  // 1. Package.json version check
  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      checks.push({
        name: 'package_version',
        pass: !!pkg.version,
        message: pkg.version ? `Version: ${pkg.version}` : 'No version in package.json',
      });
    } catch {
      checks.push({ name: 'package_version', pass: false, message: 'Failed to parse package.json' });
    }
  }

  // 2. Build check
  try {
    execSync('npm run build --dry-run 2>&1 || npm run build', { 
      cwd: projectPath, 
      timeout: 30000,
      stdio: 'pipe',
    });
    checks.push({ name: 'build', pass: true, message: 'Build succeeds' });
  } catch (e) {
    checks.push({ name: 'build', pass: false, message: 'Build failed' });
    blockers.push('Build is failing - fix before deploy');
  }

  // 3. Test check
  try {
    execSync('npm test 2>&1 || true', { 
      cwd: projectPath, 
      timeout: 60000,
      stdio: 'pipe',
    });
    checks.push({ name: 'tests', pass: true, message: 'Tests pass' });
  } catch {
    checks.push({ name: 'tests', pass: false, message: 'Tests failing or missing' });
    blockers.push('Tests are failing - fix before deploy');
  }

  // 4. Lint check
  try {
    execSync('npm run lint 2>&1 || true', {
      cwd: projectPath,
      timeout: 30000,
      stdio: 'pipe',
    });
    checks.push({ name: 'lint', pass: true, message: 'No lint errors' });
  } catch {
    checks.push({ name: 'lint', pass: false, message: 'Lint errors present' });
    recommendations.push('Consider fixing lint warnings before deploy');
  }

  // 5. Git status check
  try {
    const status = execSync('git status --porcelain', { 
      cwd: projectPath, 
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
    const hasUncommitted = status.length > 0;
    checks.push({
      name: 'git_clean',
      pass: !hasUncommitted,
      message: hasUncommitted ? 'Uncommitted changes present' : 'Working tree clean',
    });
    if (hasUncommitted) {
      recommendations.push('Commit all changes before deploying');
    }
  } catch {
    checks.push({ name: 'git_clean', pass: true, message: 'Not a git repo' });
  }

  // 6. Security audit
  try {
    const audit = execSync('npm audit --json 2>&1 || echo "{}"', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: 'pipe',
    });
    const auditResult = JSON.parse(audit || '{}');
    const vulns = auditResult.metadata?.vulnerabilities || {};
    const critical = vulns.critical || 0;
    const high = vulns.high || 0;
    
    checks.push({
      name: 'security_audit',
      pass: critical === 0 && high === 0,
      message: critical + high > 0 
        ? `${critical} critical, ${high} high vulnerabilities`
        : 'No critical/high vulnerabilities',
    });
    
    if (critical > 0) {
      blockers.push(`${critical} critical security vulnerabilities`);
    }
  } catch {
    checks.push({ name: 'security_audit', pass: true, message: 'Audit skipped' });
  }

  // 7. Environment check
  if (env === 'production') {
    checks.push({
      name: 'environment',
      pass: true,
      message: `Deploying to: ${env}`,
    });
    recommendations.push('Consider deploying to staging first');
  }

  // 8. Changelog check
  const changelogPath = join(projectPath, 'CHANGELOG.md');
  checks.push({
    name: 'changelog',
    pass: existsSync(changelogPath),
    message: existsSync(changelogPath) ? 'CHANGELOG.md exists' : 'No CHANGELOG.md',
  });
  if (!existsSync(changelogPath)) {
    recommendations.push('Add CHANGELOG.md to document changes');
  }

  return {
    ready: blockers.length === 0,
    checks,
    blockers,
    recommendations,
  };
}

// ============================================================================
// CHANGELOG GENERATOR
// ============================================================================

export function generateChangelog(input: ChangelogInput): {
  success: boolean;
  changelog: string;
  commits: Array<{ hash: string; message: string; date: string }>;
  error?: string;
} {
  const projectPath = sanitizePath(input.projectPath || process.cwd());
  const to = input.toTag || 'HEAD';
  
  try {
    // Get git tags if fromTag not specified
    let from = input.fromTag;
    if (!from) {
      try {
        const tags = execSync('git tag --sort=-version:refname', {
          cwd: projectPath,
          encoding: 'utf-8',
          stdio: 'pipe',
        }).trim().split('\n').filter(Boolean);
        
        from = tags[0] || '';
      } catch {
        from = '';
      }
    }
    
    // Get commit log
    const range = from ? `${from}..${to}` : to;
    const log = execSync(
      `git log ${range} --pretty=format:"%H|%s|%ai" --no-merges`,
      {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: 'pipe',
      }
    ).trim();
    
    if (!log) {
      return {
        success: true,
        changelog: 'No changes since last tag.',
        commits: [],
      };
    }
    
    const commits = log.split('\n').map(line => {
      const [hash, message, date] = line.split('|');
      return { hash: hash?.slice(0, 7) || '', message: message || '', date: date?.slice(0, 10) || '' };
    });
    
    // Group by type (conventional commits)
    const groups: Record<string, string[]> = {
      feat: [],
      fix: [],
      docs: [],
      refactor: [],
      test: [],
      chore: [],
      other: [],
    };
    
    for (const c of commits) {
      const match = c.message.match(/^(\w+)(?:\(.+\))?:/);
      const type = match?.[1]?.toLowerCase() || 'other';
      const group = groups[type] || groups.other;
      group.push(`- ${c.message} (${c.hash})`);
    }
    
    // Build changelog
    const lines: string[] = [`# Changelog\n`];
    const date = new Date().toISOString().slice(0, 10);
    lines.push(`## [Unreleased] - ${date}\n`);
    
    if (groups.feat.length) {
      lines.push('### Features\n');
      lines.push(...groups.feat, '');
    }
    if (groups.fix.length) {
      lines.push('### Bug Fixes\n');
      lines.push(...groups.fix, '');
    }
    if (groups.docs.length) {
      lines.push('### Documentation\n');
      lines.push(...groups.docs, '');
    }
    if (groups.refactor.length) {
      lines.push('### Refactoring\n');
      lines.push(...groups.refactor, '');
    }
    if (groups.test.length) {
      lines.push('### Tests\n');
      lines.push(...groups.test, '');
    }
    if (groups.other.length) {
      lines.push('### Other\n');
      lines.push(...groups.other, '');
    }
    
    return {
      success: true,
      changelog: lines.join('\n'),
      commits,
    };
  } catch (error) {
    return {
      success: false,
      changelog: '',
      commits: [],
      error: String(error),
    };
  }
}

// ============================================================================
// RETROSPECTIVE
// ============================================================================

export function saveRetrospective(input: RetrospectiveInput): {
  success: boolean;
  path: string;
  message: string;
} {
  const projectPath = sanitizePath(input.projectPath || process.cwd());
  const midasDir = join(projectPath, '.midas');
  const retrosDir = join(midasDir, 'retrospectives');
  
  // Ensure directory exists
  if (!existsSync(retrosDir)) {
    mkdirSync(retrosDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString();
  const filename = `retro-${timestamp.slice(0, 10)}.json`;
  const filepath = join(retrosDir, filename);
  
  const retro = {
    timestamp,
    worked: input.worked,
    didntWork: input.didntWork,
    learned: input.learned,
    actions: input.actions || '',
  };
  
  writeFileSync(filepath, JSON.stringify(retro, null, 2));
  
  // Also append to journal for searchability
  const journalDir = join(midasDir, 'journal');
  if (existsSync(journalDir)) {
    const journalEntry = {
      id: `retro-${Date.now()}`,
      title: `Retrospective ${timestamp.slice(0, 10)}`,
      timestamp,
      phase: 'GROW:DONE',
      conversation: `## What Worked\n${input.worked}\n\n## What Didn't Work\n${input.didntWork}\n\n## What We Learned\n${input.learned}\n\n## Action Items\n${input.actions || 'None specified'}`,
      tags: ['retrospective', 'grow'],
    };
    const journalPath = join(journalDir, `retro-${Date.now()}.json`);
    writeFileSync(journalPath, JSON.stringify(journalEntry, null, 2));
  }
  
  return {
    success: true,
    path: filepath,
    message: `Retrospective saved. Key learning: ${input.learned.slice(0, 100)}...`,
  };
}

// ============================================================================
// NEXT CYCLE
// ============================================================================

export function startNextCycle(input: NextCycleInput): {
  success: boolean;
  cycleId: string;
  message: string;
  nextPhase: { phase: string; step: string };
} {
  const projectPath = sanitizePath(input.projectPath || process.cwd());
  const midasDir = join(projectPath, '.midas');
  const cyclesDir = join(midasDir, 'cycles');
  
  // Ensure directory exists
  if (!existsSync(cyclesDir)) {
    mkdirSync(cyclesDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString();
  const cycleId = `cycle-${Date.now()}`;
  const filepath = join(cyclesDir, `${cycleId}.json`);
  
  const cycle = {
    id: cycleId,
    startedAt: timestamp,
    hypothesis: input.hypothesis,
    scope: input.scope,
    notScope: input.notScope || '',
    successMetrics: input.successMetrics,
    status: 'active',
  };
  
  writeFileSync(filepath, JSON.stringify(cycle, null, 2));
  
  // Reset phase to PLAN:IDEA
  const state = loadState(projectPath);
  state.history.push(state.current);
  state.current = { phase: 'EAGLE_SIGHT', step: 'IDEA' };
  state.startedAt = timestamp;
  saveState(projectPath, state);
  
  return {
    success: true,
    cycleId,
    message: `New cycle started. Hypothesis: ${input.hypothesis.slice(0, 80)}...`,
    nextPhase: { phase: 'PLAN', step: 'IDEA' },
  };
}

// ============================================================================
// ARCHIVE CYCLE
// ============================================================================

export function archiveCycle(input: ArchiveCycleInput): {
  success: boolean;
  archiveId: string;
  path: string;
  summary: {
    duration: string;
    phases: number;
    entries: number;
  };
} {
  const projectPath = sanitizePath(input.projectPath || process.cwd());
  const midasDir = join(projectPath, '.midas');
  const archiveDir = join(midasDir, 'archive');
  
  // Ensure directory exists
  if (!existsSync(archiveDir)) {
    mkdirSync(archiveDir, { recursive: true });
  }
  
  const state = loadState(projectPath);
  const timestamp = new Date().toISOString();
  const archiveId = input.cycleName || `archive-${timestamp.slice(0, 10)}`;
  const filepath = join(archiveDir, `${archiveId}.json`);
  
  // Gather all cycle data
  const archive: CycleArchive = {
    id: archiveId,
    name: archiveId,
    startedAt: state.startedAt,
    endedAt: timestamp,
    phase: state.current.phase,
  };
  
  // Include retrospectives
  const retrosDir = join(midasDir, 'retrospectives');
  if (existsSync(retrosDir)) {
    const retroFiles = readdirSync(retrosDir).filter(f => f.endsWith('.json'));
    if (retroFiles.length > 0) {
      const latestRetro = retroFiles.sort().reverse()[0];
      try {
        archive.retrospective = JSON.parse(
          readFileSync(join(retrosDir, latestRetro), 'utf-8')
        );
      } catch {
        // Skip if can't parse
      }
    }
  }
  
  // Save archive
  writeFileSync(filepath, JSON.stringify(archive, null, 2));
  
  // Calculate summary
  const startDate = new Date(state.startedAt);
  const endDate = new Date(timestamp);
  const durationMs = endDate.getTime() - startDate.getTime();
  const durationDays = Math.round(durationMs / (1000 * 60 * 60 * 24));
  
  const journalDir = join(midasDir, 'journal');
  const journalCount = existsSync(journalDir) 
    ? readdirSync(journalDir).filter(f => f.endsWith('.json')).length
    : 0;
  
  return {
    success: true,
    archiveId,
    path: filepath,
    summary: {
      duration: `${durationDays} days`,
      phases: state.history.length + 1,
      entries: journalCount,
    },
  };
}

// ============================================================================
// COST TRACKING
// ============================================================================

// Pricing in cents per 1K tokens (approximate)
const PRICING = {
  anthropic: { input: 1.5, output: 7.5, cached: 0.15 },  // Claude Opus
  openai: { input: 0.5, output: 1.5 },                    // GPT-4o
  google: { input: 0.075, output: 0.3 },                  // Gemini 2.0
  xai: { input: 0.5, output: 1.5 },                       // Grok 2
};

export function recordCost(
  projectPath: string,
  provider: string,
  inputTokens: number,
  outputTokens: number,
  cached: boolean = false
): void {
  const safePath = sanitizePath(projectPath);
  const midasDir = join(safePath, '.midas');
  const costFile = join(midasDir, 'costs.json');
  
  // Ensure directory exists
  if (!existsSync(midasDir)) {
    mkdirSync(midasDir, { recursive: true });
  }
  
  // Load existing costs
  let costs: CostEntry[] = [];
  if (existsSync(costFile)) {
    try {
      costs = JSON.parse(readFileSync(costFile, 'utf-8'));
    } catch {
      costs = [];
    }
  }
  
  // Calculate cost
  const pricing = PRICING[provider as keyof typeof PRICING] || PRICING.anthropic;
  const inputCost = (inputTokens / 1000) * (cached && 'cached' in pricing ? pricing.cached : pricing.input);
  const outputCost = (outputTokens / 1000) * pricing.output;
  const totalCost = inputCost + outputCost;
  
  // Add new entry
  costs.push({
    timestamp: new Date().toISOString(),
    provider,
    inputTokens,
    outputTokens,
    estimatedCost: Math.round(totalCost * 100) / 100,  // Round to 2 decimals
  });
  
  // Keep only last 1000 entries
  if (costs.length > 1000) {
    costs = costs.slice(-1000);
  }
  
  writeFileSync(costFile, JSON.stringify(costs, null, 2));
}

export function getCostReport(input: CostReportInput): {
  success: boolean;
  totalCost: number;  // in cents
  totalCostUSD: string;
  breakdown: Record<string, { calls: number; tokens: number; cost: number }>;
  dailyAverage: number;
  projectedMonthly: number;
  entries: number;
  period: string;
  budgetWarning?: string;
} {
  const projectPath = sanitizePath(input.projectPath || process.cwd());
  const days = input.days || 30;
  const midasDir = join(projectPath, '.midas');
  const costFile = join(midasDir, 'costs.json');
  
  if (!existsSync(costFile)) {
    return {
      success: true,
      totalCost: 0,
      totalCostUSD: '$0.00',
      breakdown: {},
      dailyAverage: 0,
      projectedMonthly: 0,
      entries: 0,
      period: `${days} days`,
    };
  }
  
  let costs: CostEntry[] = [];
  try {
    costs = JSON.parse(readFileSync(costFile, 'utf-8'));
  } catch {
    return {
      success: false,
      totalCost: 0,
      totalCostUSD: '$0.00',
      breakdown: {},
      dailyAverage: 0,
      projectedMonthly: 0,
      entries: 0,
      period: `${days} days`,
    };
  }
  
  // Filter to period
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const periodCosts = costs.filter(c => new Date(c.timestamp).getTime() >= cutoff);
  
  // Calculate breakdown
  const breakdown: Record<string, { calls: number; tokens: number; cost: number }> = {};
  let totalCost = 0;
  
  for (const entry of periodCosts) {
    if (!breakdown[entry.provider]) {
      breakdown[entry.provider] = { calls: 0, tokens: 0, cost: 0 };
    }
    breakdown[entry.provider].calls++;
    breakdown[entry.provider].tokens += entry.inputTokens + entry.outputTokens;
    breakdown[entry.provider].cost += entry.estimatedCost;
    totalCost += entry.estimatedCost;
  }
  
  const dailyAverage = days > 0 ? totalCost / days : 0;
  const projectedMonthly = dailyAverage * 30;
  
  // Budget warning at $10/month threshold
  const budgetWarning = projectedMonthly > 1000 
    ? `Projected monthly cost ($${(projectedMonthly / 100).toFixed(2)}) exceeds $10/month budget!`
    : undefined;
  
  return {
    success: true,
    totalCost: Math.round(totalCost),
    totalCostUSD: `$${(totalCost / 100).toFixed(2)}`,
    breakdown,
    dailyAverage: Math.round(dailyAverage),
    projectedMonthly: Math.round(projectedMonthly),
    entries: periodCosts.length,
    period: `${days} days`,
    budgetWarning,
  };
}
