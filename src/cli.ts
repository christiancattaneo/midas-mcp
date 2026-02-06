import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { loadState, setPhase, type Phase } from './state/phase.js';
import { startProject } from './tools/phase.js';
import { audit } from './tools/audit.js';
import { checkDocs } from './tools/docs.js';
import { loadMetrics } from './metrics.js';
import { getWeeklySummary } from './tracker.js';
import { login, logout, isAuthenticated, loadAuth } from './auth.js';
import { runSync, isCloudConfigured } from './cloud.js';
import { runPilotCLI } from './pilot.js';
import { runStatusDisplay, printStatus } from './tui-lite.js';
import { runPRReview } from './github-integration.js';
import { 
  checkSetupStatus, 
  isClaudeCodeInstalled, 
  isClaudeCodeAuthenticated,
  getInstallInstructions,
  getAuthInstructions,
  testClaudeCodeConnection
} from './claude-code.js';

// ANSI colors
const reset = '\x1b[0m';
const bold = '\x1b[1m';
const dim = '\x1b[2m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const blue = '\x1b[34m';
const cyan = '\x1b[36m';
const white = '\x1b[37m';

function box(content: string, width = 50): string {
  const lines = content.split('\n');
  const top = `┌${'─'.repeat(width - 2)}┐`;
  const bottom = `└${'─'.repeat(width - 2)}┘`;
  const padded = lines.map(l => {
    const stripped = l.replace(/\x1b\[[0-9;]*m/g, '');
    const padding = width - 4 - stripped.length;
    return `│ ${l}${' '.repeat(Math.max(0, padding))} │`;
  });
  return [top, ...padded, bottom].join('\n');
}

function progressBar(current: number, total: number, width = 20): string {
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  return `${green}${'█'.repeat(filled)}${dim}${'░'.repeat(empty)}${reset}`;
}

export function showHelp(): void {
  console.log(`
${bold}${cyan}MIDAS${reset} - Everything you vibecode turns to gold

${bold}Usage:${reset}
  midas run                One command to rule them all (setup + login + sync + watch)
  midas start              Alias for 'run'
  midas setup              Check Claude Code + Midas setup status
  midas                    Interactive coach (recommended)
  midas status             Show current phase and progress
  midas metrics            Show session metrics and statistics
  midas init <name>        Initialize new project with Plan phase
  midas init -f            First-time setup with tutorial
  midas init -e            Analyze existing project and infer phase
  midas audit              Audit project against 12 ingredients
  midas docs               Check planning docs completeness
  midas weekly             Show weekly summary of suggestion patterns
  midas server             Start MCP server (for Cursor integration)
  midas help               Show this help

${bold}Claude Code Integration:${reset}
  midas plugin             Install Skills+Hooks for Claude Code

${bold}Cloud Dashboard:${reset}
  midas login              Login with GitHub (for cloud dashboard)
  midas logout             Logout from GitHub
  midas sync               Sync project state to cloud dashboard
  midas whoami             Show current authenticated user

${bold}Automation:${reset}
  midas watch              Watch for commands from dashboard and execute
  midas pilot "prompt"     Execute a single prompt via Claude Code CLI
  midas pr <url>           Review a GitHub PR with Midas methodology

${bold}The Four Phases:${reset}
  ${yellow}PLAN${reset}         Plan before building (Idea → Research → PRD → Gameplan)
  ${blue}BUILD${reset}        Execute with the 7-step process
  ${green}SHIP${reset}         Deploy to production (Review → Deploy → Monitor)
  ${cyan}GROW${reset}         Iterate and improve (Feedback → Analyze → Iterate)

${bold}Learn more:${reset}
  https://github.com/christiancattaneo/midas-mcp
  https://midasmcp.com/dashboard (cloud dashboard)
`);
}

export function showStatus(): void {
  const state = loadState(process.cwd());
  const phase = state.current;

  console.log('');

  if (phase.phase === 'IDLE') {
    console.log(box(`${dim}IDLE${reset} - No project started`));
    console.log(`\n  Run: ${cyan}npx midas-mcp init <project-name>${reset}\n`);
    return;
  }

  const phaseConfig: Record<string, { color: string; steps: string[]; labels?: Record<string, string> }> = {
    PLAN: {
      color: yellow,
      steps: ['IDEA', 'RESEARCH', 'PRD', 'GAMEPLAN'],
    },
    BUILD: {
      color: blue,
      steps: ['RULES', 'INDEX', 'READ', 'RESEARCH', 'IMPLEMENT', 'TEST', 'DEBUG'],
      labels: { RULES: 'Rules', INDEX: 'Index', READ: 'Read', RESEARCH: 'Research', IMPLEMENT: 'Implement', TEST: 'Test', DEBUG: 'Debug' },
    },
    SHIP: {
      color: green,
      steps: ['REVIEW', 'DEPLOY', 'MONITOR'],
      labels: { REVIEW: 'Review', DEPLOY: 'Deploy', MONITOR: 'Monitor' },
    },
    GROW: {
      color: '\x1b[35m', // magenta
      steps: ['FEEDBACK', 'ANALYZE', 'ITERATE'],
      labels: { FEEDBACK: 'Feedback', ANALYZE: 'Analyze', ITERATE: 'Iterate' },
    },
  };

  const config = phaseConfig[phase.phase];
  if (!config) {
    console.log(box(`${dim}Unknown phase${reset}`));
    return;
  }

  const steps = config.steps;
  const currentIdx = steps.indexOf(phase.step);
  const progress = currentIdx + 1;

  console.log(box(
    `${config.color}${bold}${phase.phase.replace('_', ' ')}${reset}  ${progressBar(progress, steps.length)}  ${progress}/${steps.length}`
  ));
  console.log('');

  steps.forEach((step, i) => {
    const label = config.labels?.[step] || step;
    if (i < currentIdx) {
      console.log(`  ${green}[x]${reset} ${dim}${label}${reset}`);
    } else if (i === currentIdx) {
      console.log(`  ${config.color}→${reset} ${bold}${label}${reset} ${dim}(current)${reset}`);
    } else {
      console.log(`  ${dim}[ ] ${label}${reset}`);
    }
  });

  console.log('');
}

export function runInit(projectName: string): void {
  if (!projectName) {
    console.log(`\n  ${yellow}Usage:${reset} npx midas-mcp init <project-name>\n`);
    return;
  }

  const result = startProject({ projectName, projectPath: process.cwd() });

  console.log('');
  console.log(box(`${green}${bold}Project Initialized${reset}`));
  console.log('');
  console.log(`  ${bold}${projectName}${reset} is ready for planning.\n`);
  console.log('  Created:');
  console.log(`    ${dim}docs/prd.md${reset}        - Requirements`);
  console.log(`    ${dim}docs/gameplan.md${reset}   - Build plan`);
  console.log('');
  console.log(`  ${bold}Next:${reset} Fill out ${cyan}docs/prd.md${reset}`);
  console.log(`        Then run ${cyan}npx midas-mcp status${reset}\n`);
}

// ============================================================================
// First-time setup - Interactive tutorial for new users
// ============================================================================

export function runFirstTimeSetup(): void {
  console.log('');
  console.log(`${bold}${cyan}╔═══════════════════════════════════════════════════════════════════╗${reset}`);
  console.log(`${bold}${cyan}║${reset}       ${bold}WELCOME TO MIDAS${reset} - ${dim}The Golden Code Methodology${reset}              ${bold}${cyan}║${reset}`);
  console.log(`${bold}${cyan}╚═══════════════════════════════════════════════════════════════════╝${reset}`);
  console.log('');
  
  // The 4 phases - explained in 60 seconds
  console.log(`${bold}THE GOLDEN CODE LIFECYCLE (60 seconds)${reset}`);
  console.log('');
  console.log(`  ${yellow}1. PLAN${reset}  ${dim}Before coding, understand what you're building.${reset}`);
  console.log(`           Write a ${bold}PRD${reset} (requirements) and ${bold}Gameplan${reset} (tasks).`);
  console.log('');
  console.log(`  ${blue}2. BUILD${reset} ${dim}Code methodically with verification.${reset}`);
  console.log(`           Rules → Index → Read → Research → Implement → Test → Debug`);
  console.log(`           ${dim}If stuck 3+ times, use Tornado: Research + Logs + Tests${reset}`);
  console.log('');
  console.log(`  ${green}3. SHIP${reset}  ${dim}Deploy with confidence.${reset}`);
  console.log(`           Review code, deploy safely, set up monitoring.`);
  console.log('');
  console.log(`  ${cyan}4. GROW${reset}  ${dim}Learn and iterate.${reset}`);
  console.log(`           Collect feedback, triage issues, plan next cycle.`);
  console.log('');
  
  // Key tools
  console.log(`${bold}KEY TOOLS${reset}`);
  console.log('');
  console.log(`  ${dim}[TUI]${reset}      Run ${cyan}npx midas-mcp${reset} for interactive coaching`);
  console.log(`  ${dim}[Journal]${reset}  Save conversations with ${cyan}midas_journal_save${reset}`);
  console.log(`  ${dim}[Verify]${reset}   Check gates with ${cyan}midas_verify${reset} (build, test, lint)`);
  console.log(`  ${dim}[Hotfix]${reset}   Emergency mode with ${cyan}midas_start_hotfix${reset}`);
  console.log('');
  
  // Quick start
  console.log(`${bold}QUICK START${reset}`);
  console.log('');
  console.log(`  1. Run ${cyan}npx midas-mcp init MyProject${reset}`);
  console.log(`  2. Fill out ${cyan}docs/prd.md${reset} with your requirements`);
  console.log(`  3. Run ${cyan}npx midas-mcp${reset} to start the interactive coach`);
  console.log('');
  
  // Links
  console.log(`${bold}LEARN MORE${reset}`);
  console.log('');
  console.log(`  ${dim}Docs:${reset}  https://github.com/christiancattaneo/midas-mcp`);
  console.log(`  ${dim}Why:${reset}   See ${cyan}docs/WHY.md${reset} for methodology rationale`);
  console.log('');
}

// ============================================================================
// Existing project setup - Analyze and infer phase
// ============================================================================

export function runExistingProjectSetup(): void {
  const cwd = process.cwd();
  const projectName = cwd.split('/').pop() || 'project';
  
  console.log('');
  console.log(box(`${cyan}${bold}Analyzing Existing Project${reset}`));
  console.log('');
  console.log(`  ${dim}Scanning ${projectName}...${reset}`);
  
  // Check for existing code, tests, docs
  const hasPackageJson = existsSync(join(cwd, 'package.json'));
  const hasSrc = existsSync(join(cwd, 'src'));
  const hasTests = existsSync(join(cwd, 'src', 'tests')) || existsSync(join(cwd, 'tests'));
  const hasGit = existsSync(join(cwd, '.git'));
  const hasMidas = existsSync(join(cwd, '.midas'));
  const hasDocs = existsSync(join(cwd, 'docs'));
  
  console.log('');
  console.log(`  ${hasPackageJson ? green + '[x]' : yellow + '[ ]'} ${reset}package.json`);
  console.log(`  ${hasSrc ? green + '[x]' : yellow + '[ ]'} ${reset}src/ directory`);
  console.log(`  ${hasTests ? green + '[x]' : yellow + '[ ]'} ${reset}tests`);
  console.log(`  ${hasGit ? green + '[x]' : yellow + '[ ]'} ${reset}git repository`);
  console.log(`  ${hasMidas ? green + '[x]' : dim + '[ ]'} ${reset}.midas/ state`);
  console.log(`  ${hasDocs ? green + '[x]' : dim + '[ ]'} ${reset}docs/ directory`);
  console.log('');
  
  // Infer phase (using internal phase names)
  let inferredPhase: 'IDLE' | 'PLAN' | 'BUILD' | 'SHIP' | 'GROW' = 'IDLE';
  let inferredStep: string = '';
  
  if (!hasPackageJson && !hasSrc) {
    inferredPhase = 'PLAN';  // User-facing name is "PLAN"
    inferredStep = 'IDEA';
  } else if (hasSrc && !hasTests) {
    inferredPhase = 'BUILD';
    inferredStep = 'TEST';
  } else if (hasSrc && hasTests) {
    // Check git for version tags
    if (hasGit) {
      try {
        const tags = execSync('git tag -l "v*"', { encoding: 'utf-8', cwd });
        if (tags.trim()) {
          inferredPhase = 'GROW';
          inferredStep = 'MONITOR';
        } else {
          inferredPhase = 'SHIP';
          inferredStep = 'REVIEW';
        }
      } catch {
        inferredPhase = 'SHIP';
        inferredStep = 'REVIEW';
      }
    } else {
      inferredPhase = 'SHIP';
      inferredStep = 'REVIEW';
    }
  }
  
  console.log(`  ${bold}Inferred Phase:${reset} ${inferredPhase}${inferredStep ? ':' + inferredStep : ''}`);
  console.log('');
  
  // Initialize if not already done
  if (!hasMidas) {
    const result = startProject({ projectName, projectPath: cwd });
    console.log(`  ${green}[x]${reset} Created .midas/ state directory`);
    
    // Set the inferred phase
    if (inferredPhase !== 'IDLE') {
      // Build the Phase object with proper typing
      type ValidPhase = 'PLAN' | 'BUILD' | 'SHIP' | 'GROW';
      const phaseObj = { phase: inferredPhase as ValidPhase, step: inferredStep } as Phase;
      setPhase(cwd, phaseObj);
      const displayPhase = inferredPhase === 'PLAN' ? 'PLAN' : inferredPhase;
      console.log(`  ${green}[x]${reset} Set phase to ${displayPhase}:${inferredStep}`);
    }
  }
  
  if (!hasDocs) {
    console.log('');
    console.log(`  ${yellow}!${reset} No docs/ folder found.`);
    console.log(`    Consider adding planning docs to capture project context.`);
    console.log(`    Run ${cyan}npx midas-mcp init ${projectName}${reset} to create templates.`);
  }
  
  console.log('');
  console.log(`  ${bold}Next:${reset} Run ${cyan}npx midas-mcp${reset} to start the interactive coach`);
  console.log('');
}

export function runAudit(): void {
  const result = audit({ projectPath: process.cwd() });

  console.log('');
  console.log(box(`${bold}12 INGREDIENTS AUDIT${reset}  Score: ${result.overall}%`));
  console.log('');

  const categories = [
    { name: 'CORE', items: ['1-frontend', '2-backend', '3-database', '4-authentication'] },
    { name: 'POWER', items: ['5-api-integrations', '6-state-management', '7-design-ux'] },
    { name: 'PROTECTION', items: ['8-testing', '9-security', '10-error-handling'] },
    { name: 'MASTERY', items: ['11-version-control', '12-deployment'] },
  ];

  for (const cat of categories) {
    console.log(`  ${dim}${cat.name}${reset}`);
    for (const item of cat.items) {
      const score = result.scores[item];
      const num = item.split('-')[0];
      const name = item.split('-').slice(1).join(' ');
      const icon = score.exists ? `${green}[x]${reset}` : `${dim}[ ]${reset}`;
      const label = score.exists ? name : `${dim}${name}${reset}`;
      console.log(`    ${icon} ${num}. ${label}`);
    }
    console.log('');
  }

  const levelColors: Record<string, string> = {
    functional: yellow,
    integrated: blue,
    protected: cyan,
    production: green,
  };
  const color = levelColors[result.level] || white;
  console.log(`  Level: ${color}${bold}${result.level.toUpperCase()}${reset}\n`);
}

export function runDocsCheck(): void {
  const result = checkDocs({ projectPath: process.cwd() });

  console.log('');
  console.log(box(`${bold}PLANNING DOCS${reset}`));
  console.log('');

  const docs = [
    { name: 'prd.md', status: result.prd },
    { name: 'gameplan.md', status: result.gameplan },
  ];

  for (const doc of docs) {
    if (!doc.status.exists) {
      console.log(`  ${dim}[ ]${reset} ${dim}${doc.name}${reset} - not found`);
    } else if (!doc.status.complete) {
      console.log(`  ${yellow}◐${reset} ${doc.name} - incomplete`);
      for (const issue of doc.status.issues) {
        console.log(`      ${dim}${issue}${reset}`);
      }
    } else {
      console.log(`  ${green}[x]${reset} ${doc.name}`);
    }
  }

  console.log('');
  if (result.ready) {
    console.log(`  ${green}${bold}Ready for BUILD phase!${reset}\n`);
  } else {
    console.log(`  ${yellow}Complete the docs to proceed to BUILD.${reset}\n`);
  }
}

export function showMetrics(): void {
  const projectPath = process.cwd();
  const m = loadMetrics(projectPath);
  
  console.log(`\n${bold}${cyan}MIDAS METRICS${reset}\n`);
  
  if (m.totalSessions === 0) {
    console.log(`  ${dim}No sessions recorded yet.${reset}`);
    console.log(`  ${dim}Run 'midas-mcp' to start your first session.${reset}\n`);
    return;
  }
  
  // Summary stats
  console.log(box([
    `${bold}Sessions${reset}`,
    `  Total: ${m.totalSessions}`,
    `  Streak: ${m.currentStreak} day${m.currentStreak !== 1 ? 's' : ''}`,
    `  Avg length: ${m.averageSessionMinutes} min`,
    '',
    `${bold}Activity${reset}`,
    `  Tool calls: ${m.totalToolCalls}`,
    `  Tornado cycles: ${m.totalTornadoCycles}`,
    `  Journals saved: ${m.totalJournalsSaved}`,
  ].join('\n'), 40));
  
  // Phase history
  if (m.phaseHistory.length > 0) {
    console.log(`\n${bold}Phase Journey:${reset}`);
    const recent = m.phaseHistory.slice(-5);
    for (const p of recent) {
      const duration = p.duration ? ` (${p.duration} min)` : ' (current)';
      const date = new Date(p.enteredAt).toLocaleDateString();
      console.log(`  ${dim}${date}${reset} ${p.phase}${dim}${duration}${reset}`);
    }
  }
  
  // Recent sessions
  if (m.sessions.length > 0) {
    console.log(`\n${bold}Recent Sessions:${reset}`);
    const recent = m.sessions.slice(-3);
    for (const s of recent) {
      const date = new Date(s.startTime).toLocaleDateString();
      const time = new Date(s.startTime).toLocaleTimeString().slice(0, 5);
      const duration = s.endTime 
        ? Math.round((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000)
        : 0;
      console.log(`  ${dim}${date} ${time}${reset} - ${s.toolCalls} tools, ${duration}min`);
    }
  }
  
  console.log('');
}

export function showWhoami(): void {
  if (!isAuthenticated()) {
    console.log(`\n  ${dim}Not logged in${reset}`);
    console.log(`  Run: ${cyan}npx midas-mcp login${reset}\n`);
    return;
  }
  
  const auth = loadAuth();
  console.log(`\n  ${bold}Logged in as:${reset} @${green}${auth.githubUsername}${reset}`);
  console.log(`  ${dim}User ID:${reset} ${auth.githubUserId}`);
  console.log(`  ${dim}Authenticated:${reset} ${auth.authenticatedAt}`);
  
  if (isCloudConfigured()) {
    console.log(`  ${dim}Cloud sync:${reset} ${green}configured${reset}`);
  } else {
    console.log(`  ${dim}Cloud sync:${reset} ${yellow}not configured${reset}`);
  }
  console.log('');
}

export function showWeeklySummary(): void {
  const projectPath = process.cwd();
  const summary = getWeeklySummary(projectPath);
  
  console.log(`\n${bold}${cyan}WEEKLY SUMMARY${reset}\n`);
  
  if (summary.totalSuggestions === 0) {
    console.log(`  ${dim}No suggestions recorded this week.${reset}`);
    console.log(`  ${dim}Run 'midas-mcp' and analyze your project to get started.${reset}\n`);
    return;
  }
  
  // Stats
  console.log(box([
    `${bold}Suggestions${reset}`,
    `  Total: ${summary.totalSuggestions}`,
    `  Accepted: ${green}${summary.accepted}${reset}`,
    `  Declined: ${summary.declined > 0 ? yellow : dim}${summary.declined}${reset}`,
    `  Rate: ${summary.acceptanceRate >= 70 ? green : summary.acceptanceRate >= 50 ? yellow : dim}${summary.acceptanceRate}%${reset}`,
  ].join('\n'), 40));
  
  // Decline reasons
  if (summary.topDeclineReasons.length > 0) {
    console.log(`\n${bold}Top Decline Reasons:${reset}`);
    for (const reason of summary.topDeclineReasons) {
      console.log(`  ${dim}-${reset} ${reason}`);
    }
  }
  
  // Patterns to avoid
  if (summary.patternsToAvoid.length > 0) {
    console.log(`\n${bold}Patterns to Improve:${reset}`);
    for (const pattern of summary.patternsToAvoid) {
      console.log(`  ${yellow}!${reset} ${pattern}`);
    }
  }
  
  console.log('');
}

/**
 * Install Claude Code plugin (Skills + Hooks + Agents)
 * Copies .claude/ directory from the midas-mcp package to user's project
 */
async function installClaudePlugin(): Promise<void> {
  const targetDir = join(process.cwd(), '.claude');
  
  // Check if .claude already exists
  if (existsSync(targetDir)) {
    console.log(`\n  ${yellow}!${reset} .claude/ already exists in this project.`);
    console.log(`    To reinstall, remove .claude/ first.\n`);
    return;
  }
  
  // Find source .claude directory (in midas-mcp package)
  const packageRoot = join(import.meta.url.replace('file://', ''), '..', '..');
  const sourceDir = join(packageRoot, '.claude');
  
  // Copy recursively
  const { cpSync } = await import('fs');
  
  try {
    cpSync(sourceDir, targetDir, { recursive: true });
    
    console.log(`\n  ${green}[x]${reset} Installed Claude Code plugin to .claude/`);
    console.log('');
    console.log(`  ${bold}What's installed:${reset}`);
    console.log(`    ${dim}skills/${reset}    12 phase-specific prompts (auto-trigger)`);
    console.log(`    ${dim}agents/${reset}    3 specialized subagents`);
    console.log(`    ${dim}hooks/${reset}     Gate enforcement and verification`);
    console.log('');
    console.log(`  ${bold}Usage:${reset}`);
    console.log(`    ${cyan}/midas-coach${reset}     Get methodology guidance`);
    console.log(`    ${cyan}/tornado-debug${reset}   Systematic debugging`);
    console.log(`    ${cyan}/midas-verifier${reset}  Check build/test/lint gates`);
    console.log('');
    console.log(`  See ${cyan}.claude/PLUGIN.md${reset} for full documentation.\n`);
  } catch (err) {
    console.log(`\n  \x1b[31m!\x1b[0m Failed to install plugin.`);
    console.log(`    Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    console.log(`    Try: ${cyan}npx midas-mcp init${reset} instead.\n`);
  }
}

/**
 * Unified start command - does everything in one go:
 * 1. Checks/prompts for login
 * 2. Installs Claude plugin if missing
 * 3. Syncs to cloud
 * 4. Starts pilot in watch mode
 */
async function runStart(): Promise<void> {
  const projectPath = process.cwd();
  const red = '\x1b[31m';
  
  console.log(`\n${bold}${cyan}MIDAS${reset} - Starting up...\n`);
  
  // Step 0: Check Claude Code installation and auth
  console.log(`  ${dim}Checking Claude Code...${reset}`);
  
  if (!isClaudeCodeInstalled()) {
    const install = getInstallInstructions();
    console.log(`\n  ${red}✗${reset} Claude Code is not installed\n`);
    console.log(`  ${bold}Midas requires Claude Code to execute AI prompts.${reset}`);
    console.log(`  Claude Code is free and uses your Claude.ai subscription.\n`);
    console.log(`  ${bold}To install (${install.platform}):${reset}`);
    console.log(`  ${cyan}${install.command}${reset}\n`);
    console.log(`  After installing, run ${bold}midas run${reset} again.\n`);
    console.log(`  ${dim}Learn more: https://docs.anthropic.com/en/docs/claude-code/setup${reset}\n`);
    return;
  }
  
  console.log(`  ${green}✓${reset} Claude Code installed`);
  
  if (!isClaudeCodeAuthenticated()) {
    const auth = getAuthInstructions();
    console.log(`  ${yellow}!${reset} Claude Code not authenticated\n`);
    console.log(`  ${bold}You need to log in to Claude.ai to use Claude Code.${reset}\n`);
    console.log(`  ${bold}Steps:${reset}`);
    auth.steps.forEach((step, i) => {
      console.log(`    ${i + 1}. ${step}`);
    });
    console.log(`\n  ${bold}Run this command to authenticate:${reset}`);
    console.log(`  ${cyan}${auth.command}${reset}\n`);
    return;
  }
  
  console.log(`  ${green}✓${reset} Claude Code authenticated`);
  
  // Step 1: Check Midas authentication (GitHub)
  if (!isAuthenticated()) {
    console.log(`  ${yellow}→${reset} Not logged in. Starting GitHub authentication...`);
    try {
      await login();
      console.log(`  ${green}✓${reset} Logged in successfully\n`);
    } catch (err) {
      console.log(`  ${yellow}!${reset} Login skipped (optional for local use)\n`);
    }
  } else {
    const authData = loadAuth();
    console.log(`  ${green}✓${reset} Logged in as @${authData.githubUsername}`);
  }
  
  // Step 2: Install Claude plugin if missing
  const claudeDir = join(projectPath, '.claude');
  if (!existsSync(claudeDir)) {
    console.log(`  ${yellow}→${reset} Installing Claude Code plugin...`);
    try {
      await installClaudePlugin();
    } catch {
      console.log(`  ${dim}  (plugin install skipped)${reset}`);
    }
  } else {
    console.log(`  ${green}✓${reset} Claude plugin installed`);
  }
  
  // Step 3: Initialize project if needed
  const midasDir = join(projectPath, '.midas');
  if (!existsSync(midasDir)) {
    const projectName = projectPath.split('/').pop() || 'project';
    console.log(`  ${yellow}→${reset} Initializing Midas for ${projectName}...`);
    startProject({ projectName, projectPath });
    console.log(`  ${green}✓${reset} Project initialized`);
  } else {
    console.log(`  ${green}✓${reset} Project already initialized`);
  }
  
  // Step 4: Sync to cloud (if authenticated)
  if (isAuthenticated() && isCloudConfigured()) {
    console.log(`  ${yellow}→${reset} Syncing to cloud...`);
    try {
      await runSync(projectPath);
      console.log(`  ${green}✓${reset} Synced to dashboard`);
    } catch {
      console.log(`  ${dim}  (sync skipped - cloud not configured)${reset}`);
    }
  }
  
  console.log('');
  console.log(`${bold}Ready!${reset} Starting pilot in watch mode...\n`);
  console.log(`  ${dim}Dashboard: https://dashboard.midasmcp.com${reset}`);
  console.log(`  ${dim}Press Ctrl+C to stop${reset}\n`);
  
  // Step 5: Start pilot in watch mode
  await runPilotCLI(['--watch']);
}

async function runSetup(runConnectionTest = false): Promise<void> {
  const red = '\x1b[31m';
  const { hasApiKey } = await import('./config.js');
  
  console.log(`\n${bold}${cyan}MIDAS SETUP${reset} - Check your environment\n`);
  
  // Explain hybrid architecture
  console.log(`${dim}Midas uses a hybrid architecture:${reset}`);
  console.log(`${dim}  • Claude Code (required) = executes prompts, makes code changes${reset}`);
  console.log(`${dim}  • Anthropic API (optional) = fast analysis, smart suggestions${reset}\n`);
  
  // Check Claude Code (The Hands)
  console.log(`${bold}1. Claude Code${reset} ${dim}(The Hands - executes prompts)${reset}`);
  const setupStatus = checkSetupStatus();
  
  for (const msg of setupStatus.messages) {
    console.log(`  ${msg}`);
  }
  
  if (setupStatus.actions.length > 0) {
    console.log(`\n${bold}Required Actions:${reset}`);
    for (const action of setupStatus.actions) {
      console.log(`\n  ${bold}${action.label}:${reset}`);
      console.log(`  ${cyan}${action.command}${reset}`);
      console.log(`  ${dim}${action.description}${reset}`);
    }
  }
  
  // Check Anthropic API Key (The Brain)
  console.log(`\n${bold}2. Anthropic API Key${reset} ${dim}(The Brain - smart analysis)${reset}`);
  if (hasApiKey()) {
    console.log(`  ${green}✓${reset} API key configured`);
    console.log(`  ${dim}  Smart suggestions enabled (~$0.003/analysis)${reset}`);
  } else {
    console.log(`  ${yellow}!${reset} No API key (optional but recommended)`);
    console.log(`  ${dim}  Without it, Midas uses simpler local analysis${reset}`);
    console.log(`  ${dim}  To add: Run ${cyan}midas${reset}${dim} → press ${cyan}k${reset}${dim} → enter key${reset}`);
    console.log(`  ${dim}  Get key: https://console.anthropic.com/settings/keys${reset}`);
  }
  
  // Check Midas Cloud auth
  console.log(`\n${bold}3. Midas Cloud${reset} ${dim}(Dashboard + Remote Control)${reset}`);
  if (isAuthenticated()) {
    const authData = loadAuth();
    console.log(`  ${green}✓${reset} Logged in as @${authData.githubUsername}`);
    
    if (isCloudConfigured()) {
      console.log(`  ${green}✓${reset} Cloud sync configured`);
    } else {
      console.log(`  ${yellow}!${reset} Cloud sync not configured`);
    }
  } else {
    console.log(`  ${yellow}!${reset} Not logged in (run ${cyan}midas login${reset})`);
    console.log(`  ${dim}  Enables web dashboard and mobile control${reset}`);
  }
  
  // Connection test (optional - can be slow)
  if (setupStatus.ready) {
    if (runConnectionTest) {
      console.log(`\n${bold}4. Connection Test${reset}`);
      console.log(`  ${dim}Sending test prompt to Claude Code...${reset}`);
      
      const testResult = await testClaudeCodeConnection();
      
      if (testResult.success) {
        console.log(`  ${green}✓${reset} ${testResult.message}`);
        if (testResult.latencyMs) {
          console.log(`  ${dim}  Response time: ${testResult.latencyMs}ms${reset}`);
        }
      } else {
        console.log(`  ${red}✗${reset} ${testResult.message}`);
      }
    } else if (setupStatus.status.version) {
      console.log(`\n${bold}4. Version${reset}`);
      console.log(`  ${green}✓${reset} Claude Code ${setupStatus.status.version.replace('(Claude Code)', '').trim()}`);
      console.log(`  ${dim}  Run ${cyan}midas setup --test${reset}${dim} for full connection test${reset}`);
    }
  }
  
  // Final status
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`${bold}Summary:${reset}`);
  
  const hasApi = hasApiKey();
  const hasCloud = isAuthenticated();
  
  if (setupStatus.ready && hasApi && hasCloud) {
    console.log(`  ${green}✓${reset} ${bold}Full setup complete!${reset}`);
    console.log(`  ${dim}  Run ${cyan}midas run${reset}${dim} for auto-mode with dashboard${reset}\n`);
  } else if (setupStatus.ready && hasApi) {
    console.log(`  ${green}✓${reset} Local setup complete`);
    console.log(`  ${yellow}!${reset} Cloud dashboard not configured`);
    console.log(`  ${dim}  Run ${cyan}midas login${reset}${dim} to enable remote control${reset}\n`);
  } else if (setupStatus.ready) {
    console.log(`  ${green}✓${reset} Claude Code ready (can execute prompts)`);
    console.log(`  ${yellow}!${reset} API key not set (using basic analysis)`);
    console.log(`  ${dim}  Run ${cyan}midas run${reset}${dim} to start, or add API key for better suggestions${reset}\n`);
  } else {
    console.log(`  ${red}✗${reset} Setup incomplete`);
    console.log(`  ${dim}  Install Claude Code first (see actions above)${reset}\n`);
  }
}

export function runCLI(args: string[]): 'interactive' | 'server' | 'handled' | Promise<'handled'> {
  const command = args[0];

  switch (command) {
    case 'start':
    case 'run':
      return runStart().then(() => 'handled' as const).catch(err => {
        console.error('Start failed:', err.message);
        return 'handled' as const;
      });
    
    case 'setup':
    case 'doctor':
      return runSetup(args.includes('--test')).then(() => 'handled' as const).catch(err => {
        console.error('Setup failed:', err.message);
        return 'handled' as const;
      });

    case 'help':
    case '--help':
    case '-h':
      showHelp();
      return 'handled';

    case 'status':
      // New lightweight status display
      if (args.includes('--watch') || args.includes('-w')) {
        return runStatusDisplay(process.cwd(), true).then(() => 'handled' as const).catch(err => {
          console.error('Status display failed:', err.message);
          return 'handled' as const;
        });
      }
      printStatus(process.cwd());
      return 'handled';

    case 'init':
      if (args[1] === '--first-time' || args[1] === '-f') {
        runFirstTimeSetup();
      } else if (args[1] === '--existing' || args[1] === '-e') {
        runExistingProjectSetup();
      } else {
        runInit(args[1]);
      }
      return 'handled';

    case 'audit':
      runAudit();
      return 'handled';

    case 'docs':
      runDocsCheck();
      return 'handled';

    case 'metrics':
      showMetrics();
      return 'handled';

    case 'weekly':
      showWeeklySummary();
      return 'handled';

    case 'login':
      // Async command - return promise so main() waits
      return login().then(() => 'handled' as const).catch(err => {
        console.error('Login failed:', err.message);
        return 'handled' as const;
      });

    case 'logout':
      logout();
      return 'handled';

    case 'sync':
      return runSync(process.cwd()).then(() => 'handled' as const).catch(err => {
        console.error('Sync failed:', err.message);
        return 'handled' as const;
      });

    case 'whoami':
      showWhoami();
      return 'handled';

    case 'pilot':
    case 'watch':
      return runPilotCLI(args.slice(1)).then(() => 'handled' as const).catch(err => {
        console.error('Pilot failed:', err.message);
        return 'handled' as const;
      });

    case 'plugin':
      return installClaudePlugin().then(() => 'handled' as const).catch(err => {
        console.error('Plugin install failed:', err.message);
        return 'handled' as const;
      });

    case 'pr':
      return runPRReview(args.slice(1)).then(() => 'handled' as const).catch(err => {
        console.error('PR review failed:', err.message);
        return 'handled' as const;
      });

    case 'server':
      return 'server'; // Start MCP server

    case undefined:
      return 'interactive'; // No args = interactive mode

    default:
      console.log(`Unknown command: ${command}`);
      console.log('Run: npx midas-mcp help');
      return 'handled';
  }
}
