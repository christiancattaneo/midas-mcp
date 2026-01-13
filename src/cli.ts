import { loadState, type Phase } from './state/phase.js';
import { startProject } from './tools/phase.js';
import { audit } from './tools/audit.js';
import { checkDocs } from './tools/docs.js';

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
  npx midas-mcp              Start MCP server (for Cursor)
  npx midas-mcp status       Show current phase and progress
  npx midas-mcp init <name>  Initialize new project with Eagle Sight
  npx midas-mcp audit        Audit project against 12 ingredients
  npx midas-mcp docs         Check Eagle Sight docs completeness
  npx midas-mcp help         Show this help

${bold}The Two Phases:${reset}
  ${yellow}EAGLE SIGHT${reset}  Plan before building (Idea → Research → Brainlift → PRD → Gameplan)
  ${blue}BUILD${reset}        Execute with the 7-step process

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

  if (phase.phase === 'EAGLE_SIGHT') {
    const steps = ['IDEA', 'RESEARCH', 'BRAINLIFT', 'PRD', 'GAMEPLAN'];
    const currentIdx = steps.indexOf(phase.step);
    const progress = currentIdx + 1;

    console.log(box(
      `${yellow}${bold}EAGLE SIGHT${reset}  ${progressBar(progress, 5)}  ${progress}/5`
    ));
    console.log('');

    steps.forEach((step, i) => {
      if (i < currentIdx) {
        console.log(`  ${green}✓${reset} ${dim}${step}${reset}`);
      } else if (i === currentIdx) {
        console.log(`  ${yellow}→${reset} ${bold}${step}${reset} ${dim}(current)${reset}`);
      } else {
        console.log(`  ${dim}○ ${step}${reset}`);
      }
    });

    console.log('');
    const nextActions: Record<string, string> = {
      IDEA: 'Define your core idea. What problem are you solving?',
      RESEARCH: 'Scan the landscape. What already exists?',
      BRAINLIFT: 'Fill out docs/brainlift.md with YOUR unique insights',
      PRD: 'Fill out docs/prd.md with requirements',
      GAMEPLAN: 'Fill out docs/gameplan.md with your build plan',
    };
    console.log(`  ${bold}Next:${reset} ${nextActions[phase.step]}\n`);
    return;
  }

  if (phase.phase === 'BUILD') {
    const steps = ['RULES_LOADED', 'CODEBASE_INDEXED', 'FILES_READ', 'RESEARCHING', 'IMPLEMENTING', 'TESTING', 'DEBUGGING'];
    const currentIdx = steps.indexOf(phase.step);
    const progress = currentIdx + 1;

    console.log(box(
      `${blue}${bold}BUILD${reset}  ${progressBar(progress, 7)}  ${progress}/7`
    ));
    console.log('');

    const stepLabels: Record<string, string> = {
      RULES_LOADED: 'Load Rules',
      CODEBASE_INDEXED: 'Index Codebase',
      FILES_READ: 'Read Files',
      RESEARCHING: 'Research',
      IMPLEMENTING: 'Implement',
      TESTING: 'Test',
      DEBUGGING: 'Debug',
    };

    steps.forEach((step, i) => {
      const label = stepLabels[step];
      if (i < currentIdx) {
        console.log(`  ${green}✓${reset} ${dim}${label}${reset}`);
      } else if (i === currentIdx) {
        console.log(`  ${blue}→${reset} ${bold}${label}${reset} ${dim}(current)${reset}`);
      } else {
        console.log(`  ${dim}○ ${label}${reset}`);
      }
    });

    console.log('');
    return;
  }

  if (phase.phase === 'SHIPPED') {
    console.log(box(`${green}${bold}SHIPPED${reset}  ${progressBar(1, 1)}  Done!`));
    console.log(`\n  Run ${cyan}npx midas-mcp audit${reset} to check production readiness.\n`);
  }
}

export function runInit(projectName: string): void {
  if (!projectName) {
    console.log(`\n  ${yellow}Usage:${reset} npx midas-mcp init <project-name>\n`);
    return;
  }

  const result = startProject({ projectName, projectPath: process.cwd() });

  console.log('');
  console.log(box(`${green}${bold}✓ Project Initialized${reset}`));
  console.log('');
  console.log(`  ${bold}${projectName}${reset} is ready for Eagle Sight.\n`);
  console.log('  Created:');
  console.log(`    ${dim}docs/brainlift.md${reset}  - Your unique insights`);
  console.log(`    ${dim}docs/prd.md${reset}        - Requirements`);
  console.log(`    ${dim}docs/gameplan.md${reset}   - Build plan`);
  console.log('');
  console.log(`  ${bold}Next:${reset} Fill out ${cyan}docs/brainlift.md${reset}`);
  console.log(`        Then run ${cyan}npx midas-mcp status${reset}\n`);
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
      const icon = score.exists ? `${green}✓${reset}` : `${dim}○${reset}`;
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
  console.log(box(`${bold}EAGLE SIGHT DOCS${reset}`));
  console.log('');

  const docs = [
    { name: 'brainlift.md', status: result.brainlift },
    { name: 'prd.md', status: result.prd },
    { name: 'gameplan.md', status: result.gameplan },
  ];

  for (const doc of docs) {
    if (!doc.status.exists) {
      console.log(`  ${dim}○${reset} ${dim}${doc.name}${reset} - not found`);
    } else if (!doc.status.complete) {
      console.log(`  ${yellow}◐${reset} ${doc.name} - incomplete`);
      for (const issue of doc.status.issues) {
        console.log(`      ${dim}${issue}${reset}`);
      }
    } else {
      console.log(`  ${green}✓${reset} ${doc.name}`);
    }
  }

  console.log('');
  if (result.ready) {
    console.log(`  ${green}${bold}Ready for BUILD phase!${reset}\n`);
  } else {
    console.log(`  ${yellow}Complete the docs to proceed to BUILD.${reset}\n`);
  }
}

export function runCLI(args: string[]): boolean {
  const command = args[0];

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      return true;

    case 'status':
      showStatus();
      return true;

    case 'init':
      runInit(args[1]);
      return true;

    case 'audit':
      runAudit();
      return true;

    case 'docs':
      runDocsCheck();
      return true;

    default:
      return false; // Not a CLI command, start MCP server
  }
}
