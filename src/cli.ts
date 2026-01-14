import { loadState, type Phase } from './state/phase.js';
import { startProject } from './tools/phase.js';
import { audit } from './tools/audit.js';
import { checkDocs } from './tools/docs.js';
import { loadMetrics } from './metrics.js';

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
  npx midas-mcp              Interactive coach (recommended)
  npx midas-mcp status       Show current phase and progress
  npx midas-mcp metrics      Show session metrics and statistics
  npx midas-mcp init <name>  Initialize new project with Plan phase
  npx midas-mcp init -f      First-time setup with tutorial
  npx midas-mcp init -e      Analyze existing project and infer phase
  npx midas-mcp audit        Audit project against 12 ingredients
  npx midas-mcp docs         Check planning docs completeness
  npx midas-mcp server       Start MCP server (for Cursor integration)
  npx midas-mcp help         Show this help

${bold}The Four Phases:${reset}
  ${yellow}PLAN${reset}         Plan before building (Idea → Research → Brainlift → PRD → Gameplan)
  ${blue}BUILD${reset}        Execute with the 7-step process
  ${green}SHIP${reset}         Deploy to production (Review → Deploy → Monitor)
  ${cyan}GROW${reset}         Iterate and improve (Feedback → Analyze → Iterate)

${bold}Learn more:${reset}
  https://github.com/christiancattaneo/midas-mcp
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
    EAGLE_SIGHT: {
      color: yellow,
      steps: ['IDEA', 'RESEARCH', 'BRAINLIFT', 'PRD', 'GAMEPLAN'],
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
  console.log(`    ${dim}docs/brainlift.md${reset}  - Your unique insights`);
  console.log(`    ${dim}docs/prd.md${reset}        - Requirements`);
  console.log(`    ${dim}docs/gameplan.md${reset}   - Build plan`);
  console.log('');
  console.log(`  ${bold}Next:${reset} Fill out ${cyan}docs/brainlift.md${reset}`);
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
  console.log(`           Write a ${bold}Brainlift${reset} (your unique insights),`);
  console.log(`           ${bold}PRD${reset} (requirements), and ${bold}Gameplan${reset} (tasks).`);
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
  console.log(`  2. Fill out ${cyan}docs/brainlift.md${reset} with your unique insights`);
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
  const { existsSync, readdirSync } = require('fs');
  const { join } = require('path');
  
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
  
  // Infer phase
  let inferredPhase = 'IDLE';
  let inferredStep = '';
  
  if (!hasPackageJson && !hasSrc) {
    inferredPhase = 'PLAN';
    inferredStep = 'IDEA';
  } else if (hasSrc && !hasTests) {
    inferredPhase = 'BUILD';
    inferredStep = 'TEST';
  } else if (hasSrc && hasTests) {
    // Check git for version tags
    if (hasGit) {
      try {
        const { execSync } = require('child_process');
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
      const { setPhase } = require('./state/phase.js');
      setPhase(cwd, { phase: inferredPhase as 'EAGLE_SIGHT' | 'BUILD' | 'SHIP' | 'GROW', step: inferredStep });
      console.log(`  ${green}[x]${reset} Set phase to ${inferredPhase}:${inferredStep}`);
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
    { name: 'brainlift.md', status: result.brainlift },
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

export function runCLI(args: string[]): 'interactive' | 'server' | 'handled' {
  const command = args[0];

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      return 'handled';

    case 'status':
      showStatus();
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
