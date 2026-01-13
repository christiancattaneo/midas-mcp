import { createInterface } from 'readline';
import { watch, existsSync } from 'fs';
import { join } from 'path';
import { loadState, saveState, type Phase, type EagleSightStep, type BuildStep } from './state/phase.js';
import { checkDocs } from './tools/docs.js';
import { exec } from 'child_process';

// ANSI codes
const ESC = '\x1b';
const reset = `${ESC}[0m`;
const bold = `${ESC}[1m`;
const dim = `${ESC}[2m`;
const green = `${ESC}[32m`;
const yellow = `${ESC}[33m`;
const blue = `${ESC}[34m`;
const cyan = `${ESC}[36m`;
const white = `${ESC}[37m`;
const bgBlue = `${ESC}[44m`;
const clearScreen = `${ESC}[2J${ESC}[H`;

// Prompts for each step
const STEP_PROMPTS: Record<string, { action: string; prompt: string }> = {
  // Eagle Sight
  'EAGLE_SIGHT:IDEA': {
    action: 'Define your core idea',
    prompt: `I'm starting a new project. Help me clarify:
1. What problem am I solving?
2. Who is it for?
3. Why now?

Ask me clarifying questions before we proceed.`,
  },
  'EAGLE_SIGHT:RESEARCH': {
    action: 'Research the landscape',
    prompt: `Research the landscape for my project idea.
Find:
1. Existing solutions
2. What they do well
3. What they miss
4. Technical approaches used

Summarize findings.`,
  },
  'EAGLE_SIGHT:BRAINLIFT': {
    action: 'Fill out docs/brainlift.md',
    prompt: `Review my brainlift.md and help me strengthen it.
Ask me questions to extract:
1. Contrarian insights I have
2. Domain knowledge AI lacks
3. Hard-won lessons from experience
4. Current context you might miss`,
  },
  'EAGLE_SIGHT:PRD': {
    action: 'Fill out docs/prd.md',
    prompt: `Review my PRD and help me improve it.
Check for:
1. Clear goals
2. Explicit non-goals
3. Complete user stories
4. Technical requirements
5. Success metrics

Ask clarifying questions.`,
  },
  'EAGLE_SIGHT:GAMEPLAN': {
    action: 'Fill out docs/gameplan.md',
    prompt: `Review my gameplan and help me refine it.
Verify:
1. Tech stack justified
2. Phases are logical
3. Tasks are specific
4. Risks identified

Suggest improvements.`,
  },
  // Build
  'BUILD:RULES_LOADED': {
    action: 'Load user rules',
    prompt: `Read and understand user rules.
Research each for complete understanding.
Ask me any clarifying questions.
Make todos of all tasks.
Don't start yet.`,
  },
  'BUILD:CODEBASE_INDEXED': {
    action: 'Index the codebase',
    prompt: `Index this codebase structure.
Understand the architecture.
Note key files and patterns.
Summarize what you find.`,
  },
  'BUILD:FILES_READ': {
    action: 'Read relevant files',
    prompt: `Read the files relevant to my current task.
Understand the implementation details.
Note patterns to follow.
Identify integration points.`,
  },
  'BUILD:RESEARCHING': {
    action: 'Research docs and APIs',
    prompt: `Research the documentation for the libraries/APIs I'm using.
Find:
1. Best practices
2. Common pitfalls
3. Code examples
4. Security considerations`,
  },
  'BUILD:IMPLEMENTING': {
    action: 'Write code with tests',
    prompt: `Continue todos, do each comprehensively.
Write the test file FIRST.
Then implement to make tests pass.
Each function should do ONE thing.
Run tests after each file.`,
  },
  'BUILD:TESTING': {
    action: 'Run and fix tests',
    prompt: `Run all tests.
Fix any failures.
Add edge case tests.
Verify no regressions.
Commit when green.`,
  },
  'BUILD:DEBUGGING': {
    action: 'Debug with Tornado cycle',
    prompt: `I'm stuck on a bug. Help me with the Tornado cycle:
1. RESEARCH: Look up relevant docs
2. LOGS: Add strategic console.logs
3. TESTS: Write test to reproduce

Let's start with research.`,
  },
  // Idle/Shipped
  'IDLE': {
    action: 'Start a new project',
    prompt: `I want to start a new project.
Help me through Eagle Sight:
1. Clarify my idea
2. Research landscape
3. Document my brainlift
4. Write the PRD
5. Create the gameplan`,
  },
  'SHIPPED': {
    action: 'Run production audit',
    prompt: `My project is shipped. Run a production readiness audit.
Check all 12 ingredients:
1-4: Core (Frontend, Backend, Database, Auth)
5-7: Power (APIs, State, Design)
8-10: Protection (Testing, Security, Errors)
11-12: Mastery (Git, Deployment)`,
  },
};

function getPhaseKey(phase: Phase): string {
  if (phase.phase === 'IDLE' || phase.phase === 'SHIPPED') {
    return phase.phase;
  }
  return `${phase.phase}:${phase.step}`;
}

function progressBar(current: number, total: number, width = 20): string {
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  return `${green}${'█'.repeat(filled)}${dim}${'░'.repeat(empty)}${reset}`;
}

function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = exec('pbcopy', (err) => {
      if (err) reject(err);
      else resolve();
    });
    proc.stdin?.write(text);
    proc.stdin?.end();
  });
}

function drawUI(phase: Phase, projectPath: string): string {
  const lines: string[] = [];
  const width = 54;
  
  const hLine = '═'.repeat(width - 2);
  const hLineLight = '─'.repeat(width - 4);
  
  lines.push(`${cyan}╔${hLine}╗${reset}`);
  lines.push(`${cyan}║${reset}  ${bold}${white}MIDAS${reset} ${dim}- Elite Vibecoding Coach${reset}${' '.repeat(width - 36)}${cyan}║${reset}`);
  lines.push(`${cyan}╠${hLine}╣${reset}`);
  lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);

  if (phase.phase === 'IDLE') {
    lines.push(`${cyan}║${reset}  ${dim}No project initialized${reset}${' '.repeat(width - 27)}${cyan}║${reset}`);
    lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
    lines.push(`${cyan}║${reset}  Run: ${yellow}npx midas-mcp init <name>${reset}${' '.repeat(width - 35)}${cyan}║${reset}`);
  } else if (phase.phase === 'EAGLE_SIGHT') {
    const steps: EagleSightStep[] = ['IDEA', 'RESEARCH', 'BRAINLIFT', 'PRD', 'GAMEPLAN'];
    const currentIdx = steps.indexOf(phase.step);
    const progress = currentIdx + 1;
    
    lines.push(`${cyan}║${reset}  ${yellow}${bold}EAGLE SIGHT${reset}  ${progressBar(progress, 5)}  ${progress}/5${' '.repeat(width - 44)}${cyan}║${reset}`);
    lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      let icon: string, label: string;
      if (i < currentIdx) {
        icon = `${green}✓${reset}`;
        label = `${dim}${step}${reset}`;
      } else if (i === currentIdx) {
        icon = `${yellow}→${reset}`;
        label = `${bold}${step}${reset} ${dim}(current)${reset}`;
      } else {
        icon = `${dim}○${reset}`;
        label = `${dim}${step}${reset}`;
      }
      const padding = width - 8 - step.length - (i === currentIdx ? 10 : 0);
      lines.push(`${cyan}║${reset}  ${icon} ${label}${' '.repeat(Math.max(0, padding))}${cyan}║${reset}`);
    }
  } else if (phase.phase === 'BUILD') {
    const steps: BuildStep[] = ['RULES_LOADED', 'CODEBASE_INDEXED', 'FILES_READ', 'RESEARCHING', 'IMPLEMENTING', 'TESTING', 'DEBUGGING'];
    const labels: Record<BuildStep, string> = {
      RULES_LOADED: 'Load Rules',
      CODEBASE_INDEXED: 'Index Codebase',
      FILES_READ: 'Read Files',
      RESEARCHING: 'Research',
      IMPLEMENTING: 'Implement',
      TESTING: 'Test',
      DEBUGGING: 'Debug',
    };
    const currentIdx = steps.indexOf(phase.step);
    const progress = currentIdx + 1;
    
    lines.push(`${cyan}║${reset}  ${blue}${bold}BUILD${reset}  ${progressBar(progress, 7)}  ${progress}/7${' '.repeat(width - 38)}${cyan}║${reset}`);
    lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const label = labels[step];
      let icon: string, text: string;
      if (i < currentIdx) {
        icon = `${green}✓${reset}`;
        text = `${dim}${label}${reset}`;
      } else if (i === currentIdx) {
        icon = `${blue}→${reset}`;
        text = `${bold}${label}${reset} ${dim}(current)${reset}`;
      } else {
        icon = `${dim}○${reset}`;
        text = `${dim}${label}${reset}`;
      }
      const padding = width - 8 - label.length - (i === currentIdx ? 10 : 0);
      lines.push(`${cyan}║${reset}  ${icon} ${text}${' '.repeat(Math.max(0, padding))}${cyan}║${reset}`);
    }
  } else if (phase.phase === 'SHIPPED') {
    lines.push(`${cyan}║${reset}  ${green}${bold}SHIPPED${reset}  ${progressBar(1, 1)}${' '.repeat(width - 40)}${cyan}║${reset}`);
    lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
    lines.push(`${cyan}║${reset}  ${green}✓${reset} Project complete!${' '.repeat(width - 23)}${cyan}║${reset}`);
  }

  lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
  lines.push(`${cyan}╠${hLine}╣${reset}`);
  
  // Get current prompt
  const key = getPhaseKey(phase);
  const stepData = STEP_PROMPTS[key] || { action: 'Continue', prompt: 'What would you like to do?' };
  
  lines.push(`${cyan}║${reset}  ${bold}NEXT:${reset} ${stepData.action}${' '.repeat(Math.max(0, width - 10 - stepData.action.length))}${cyan}║${reset}`);
  lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
  lines.push(`${cyan}║${reset}  ${dim}Paste this in Cursor:${reset}${' '.repeat(width - 26)}${cyan}║${reset}`);
  lines.push(`${cyan}║${reset}  ${dim}┌${hLineLight}┐${reset}  ${cyan}║${reset}`);
  
  // Wrap prompt text
  const promptLines = stepData.prompt.split('\n');
  for (const pLine of promptLines.slice(0, 4)) {
    const truncated = pLine.slice(0, width - 10);
    const padding = width - 8 - truncated.length;
    lines.push(`${cyan}║${reset}  ${dim}│${reset} ${truncated}${' '.repeat(Math.max(0, padding))}${dim}│${reset}  ${cyan}║${reset}`);
  }
  if (promptLines.length > 4) {
    lines.push(`${cyan}║${reset}  ${dim}│ ...${' '.repeat(width - 13)}│${reset}  ${cyan}║${reset}`);
  }
  
  lines.push(`${cyan}║${reset}  ${dim}└${hLineLight}┘${reset}  ${cyan}║${reset}`);
  lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
  lines.push(`${cyan}╠${hLine}╣${reset}`);
  lines.push(`${cyan}║${reset}  ${dim}[c]${reset} Copy prompt  ${dim}[n]${reset} Next step  ${dim}[b]${reset} Back  ${dim}[q]${reset} Quit  ${cyan}║${reset}`);
  lines.push(`${cyan}╚${hLine}╝${reset}`);

  return lines.join('\n');
}

function advancePhase(projectPath: string): Phase {
  const state = loadState(projectPath);
  const phase = state.current;

  if (phase.phase === 'IDLE') {
    state.current = { phase: 'EAGLE_SIGHT', step: 'IDEA' };
  } else if (phase.phase === 'EAGLE_SIGHT') {
    const steps: EagleSightStep[] = ['IDEA', 'RESEARCH', 'BRAINLIFT', 'PRD', 'GAMEPLAN'];
    const idx = steps.indexOf(phase.step);
    if (idx < steps.length - 1) {
      state.current = { phase: 'EAGLE_SIGHT', step: steps[idx + 1] };
    } else {
      state.current = { phase: 'BUILD', step: 'RULES_LOADED' };
    }
  } else if (phase.phase === 'BUILD') {
    const steps: BuildStep[] = ['RULES_LOADED', 'CODEBASE_INDEXED', 'FILES_READ', 'RESEARCHING', 'IMPLEMENTING', 'TESTING', 'DEBUGGING'];
    const idx = steps.indexOf(phase.step);
    if (idx < steps.length - 1) {
      state.current = { phase: 'BUILD', step: steps[idx + 1] };
    } else {
      state.current = { phase: 'SHIPPED' };
    }
  }

  saveState(projectPath, state);
  return state.current;
}

function goBackPhase(projectPath: string): Phase {
  const state = loadState(projectPath);
  const phase = state.current;

  if (phase.phase === 'EAGLE_SIGHT') {
    const steps: EagleSightStep[] = ['IDEA', 'RESEARCH', 'BRAINLIFT', 'PRD', 'GAMEPLAN'];
    const idx = steps.indexOf(phase.step);
    if (idx > 0) {
      state.current = { phase: 'EAGLE_SIGHT', step: steps[idx - 1] };
    }
  } else if (phase.phase === 'BUILD') {
    const steps: BuildStep[] = ['RULES_LOADED', 'CODEBASE_INDEXED', 'FILES_READ', 'RESEARCHING', 'IMPLEMENTING', 'TESTING', 'DEBUGGING'];
    const idx = steps.indexOf(phase.step);
    if (idx > 0) {
      state.current = { phase: 'BUILD', step: steps[idx - 1] };
    } else {
      state.current = { phase: 'EAGLE_SIGHT', step: 'GAMEPLAN' };
    }
  } else if (phase.phase === 'SHIPPED') {
    state.current = { phase: 'BUILD', step: 'DEBUGGING' };
  }

  saveState(projectPath, state);
  return state.current;
}

export async function runInteractive(): Promise<void> {
  const projectPath = process.cwd();
  
  // Set up raw mode for single keypress
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  let state = loadState(projectPath);
  let phase = state.current;
  let message = '';

  const render = () => {
    console.log(clearScreen);
    console.log(drawUI(phase, projectPath));
    if (message) {
      console.log(`\n  ${message}`);
      message = '';
    }
  };

  render();

  // Watch for docs changes
  const docsPath = join(projectPath, 'docs');
  let watcher: ReturnType<typeof watch> | null = null;
  if (existsSync(docsPath)) {
    watcher = watch(docsPath, { recursive: true }, () => {
      // Re-check docs completeness
      const docs = checkDocs({ projectPath });
      if (docs.ready && phase.phase === 'EAGLE_SIGHT') {
        message = `${green}✓${reset} Docs complete! Press [n] to start BUILD.`;
        render();
      }
    });
  }

  process.stdin.on('data', async (key: string) => {
    if (key === 'q' || key === '\u0003') { // q or Ctrl+C
      console.log(clearScreen);
      console.log(`\n  ${cyan}Midas${reset} signing off. Happy vibecoding!\n`);
      watcher?.close();
      process.exit(0);
    }

    if (key === 'c') {
      const stepKey = getPhaseKey(phase);
      const prompt = STEP_PROMPTS[stepKey]?.prompt || '';
      try {
        await copyToClipboard(prompt);
        message = `${green}✓${reset} Prompt copied to clipboard!`;
      } catch {
        message = `${yellow}!${reset} Could not copy. Manually copy the prompt above.`;
      }
      render();
    }

    if (key === 'n') {
      phase = advancePhase(projectPath);
      message = `${green}→${reset} Advanced to next step`;
      render();
    }

    if (key === 'b') {
      phase = goBackPhase(projectPath);
      message = `${yellow}←${reset} Went back one step`;
      render();
    }

    if (key === 'r') {
      state = loadState(projectPath);
      phase = state.current;
      message = `${blue}↻${reset} Refreshed`;
      render();
    }
  });
}
