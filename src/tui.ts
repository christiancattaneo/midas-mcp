import { watch, existsSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { loadState, saveState, type Phase, type EagleSightStep, type BuildStep } from './state/phase.js';
import { checkDocs } from './tools/docs.js';
import { loadConfig, hasApiKey, ensureApiKey, getApiKey } from './config.js';
import { logEvent, watchEvents, getRecentEvents } from './events.js';
import { 
  isCursorAvailable, 
  watchConversations, 
  getLatestConversation,
  extractMidasToolCalls,
  getConversationSummary,
  type CursorConversation,
  type ChatMessage 
} from './cursor.js';
import { analyzeCodebase, generateSmartPrompt } from './ai.js';

// ANSI codes
const ESC = '\x1b';
const reset = `${ESC}[0m`;
const bold = `${ESC}[1m`;
const dim = `${ESC}[2m`;
const green = `${ESC}[32m`;
const yellow = `${ESC}[33m`;
const blue = `${ESC}[34m`;
const cyan = `${ESC}[36m`;
const magenta = `${ESC}[35m`;
const white = `${ESC}[37m`;
const clearScreen = `${ESC}[2J${ESC}[H`;

// Prompts for each step
const STEP_PROMPTS: Record<string, { action: string; prompt: string }> = {
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
Find existing solutions, what they do well, what they miss.
Summarize findings.`,
  },
  'EAGLE_SIGHT:BRAINLIFT': {
    action: 'Fill out docs/brainlift.md',
    prompt: `Review my brainlift.md and help me strengthen it.
Ask me questions to extract my unique insights and domain knowledge.`,
  },
  'EAGLE_SIGHT:PRD': {
    action: 'Fill out docs/prd.md',
    prompt: `Review my PRD and help me improve it.
Check for clear goals, non-goals, user stories, and requirements.`,
  },
  'EAGLE_SIGHT:GAMEPLAN': {
    action: 'Fill out docs/gameplan.md',
    prompt: `Review my gameplan and help me refine it.
Verify tech stack, phases, tasks, and risk mitigation.`,
  },
  'BUILD:RULES_LOADED': {
    action: 'Load user rules',
    prompt: `Read and understand user rules.
Ask clarifying questions. Make todos. Don't start yet.`,
  },
  'BUILD:CODEBASE_INDEXED': {
    action: 'Index the codebase',
    prompt: `Index this codebase. Understand the architecture.
Note key files and patterns. Summarize what you find.`,
  },
  'BUILD:FILES_READ': {
    action: 'Read relevant files',
    prompt: `Read the files relevant to my current task.
Note patterns to follow and integration points.`,
  },
  'BUILD:RESEARCHING': {
    action: 'Research docs and APIs',
    prompt: `Research documentation for the libraries/APIs I'm using.
Find best practices, pitfalls, and examples.`,
  },
  'BUILD:IMPLEMENTING': {
    action: 'Write code with tests',
    prompt: `Continue todos. Write test file FIRST.
Then implement to make tests pass. Run tests after each file.`,
  },
  'BUILD:TESTING': {
    action: 'Run and fix tests',
    prompt: `Run all tests. Fix failures. Add edge case tests.
Commit when green.`,
  },
  'BUILD:DEBUGGING': {
    action: 'Debug with Tornado cycle',
    prompt: `I'm stuck on a bug. Help with Tornado cycle:
1. RESEARCH docs  2. Add LOGS  3. Write TESTS
Start with research.`,
  },
  'IDLE': {
    action: 'Start a new project',
    prompt: `I want to start a new project.
Help me through Eagle Sight: Idea → Research → Brainlift → PRD → Gameplan`,
  },
  'SHIPPED': {
    action: 'Run production audit',
    prompt: `Project shipped. Run production readiness audit.
Check all 12 ingredients.`,
  },
};

function getPhaseKey(phase: Phase): string {
  if (phase.phase === 'IDLE' || phase.phase === 'SHIPPED') return phase.phase;
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

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 3) + '...';
}

interface TUIState {
  phase: Phase;
  message: string;
  cursorConnected: boolean;
  lastChatSummary: string;
  recentToolCalls: string[];
  smartPrompt: string | null;
  hasApiKey: boolean;
  isAnalyzing: boolean;
}

function drawUI(state: TUIState, projectPath: string): string {
  const { phase, cursorConnected, lastChatSummary, recentToolCalls, smartPrompt, hasApiKey: hasKey } = state;
  const lines: string[] = [];
  const width = 60;
  
  const hLine = '═'.repeat(width - 2);
  const hLineLight = '─'.repeat(width - 4);
  
  // Header
  lines.push(`${cyan}╔${hLine}╗${reset}`);
  const statusIcon = cursorConnected ? `${green}●${reset}` : `${dim}○${reset}`;
  const aiIcon = hasKey ? `${magenta}AI${reset}` : `${dim}--${reset}`;
  lines.push(`${cyan}║${reset}  ${bold}${white}MIDAS${reset} ${dim}- Elite Vibecoding Coach${reset}    ${statusIcon} Cursor  ${aiIcon}  ${cyan}║${reset}`);
  lines.push(`${cyan}╠${hLine}╣${reset}`);

  // Cursor chat activity
  if (cursorConnected && lastChatSummary) {
    lines.push(`${cyan}║${reset}  ${dim}Last chat:${reset} ${truncate(lastChatSummary, width - 16)}${' '.repeat(Math.max(0, width - 16 - Math.min(lastChatSummary.length, width - 16)))}${cyan}║${reset}`);
    if (recentToolCalls.length > 0) {
      const tools = recentToolCalls.slice(0, 3).join(', ');
      lines.push(`${cyan}║${reset}  ${dim}Tools used:${reset} ${magenta}${truncate(tools, width - 17)}${reset}${' '.repeat(Math.max(0, width - 17 - Math.min(tools.length, width - 17)))}${cyan}║${reset}`);
    }
    lines.push(`${cyan}╠${hLine}╣${reset}`);
  }

  lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);

  // Phase display
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
      let line: string;
      if (i < currentIdx) {
        line = `  ${green}✓${reset} ${dim}${step}${reset}`;
      } else if (i === currentIdx) {
        line = `  ${yellow}→${reset} ${bold}${step}${reset} ${dim}(current)${reset}`;
      } else {
        line = `  ${dim}○ ${step}${reset}`;
      }
      const padding = width - 6 - step.length - (i === currentIdx ? 10 : 0);
      lines.push(`${cyan}║${reset}${line}${' '.repeat(Math.max(0, padding))}${cyan}║${reset}`);
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
      let line: string;
      if (i < currentIdx) {
        line = `  ${green}✓${reset} ${dim}${label}${reset}`;
      } else if (i === currentIdx) {
        line = `  ${blue}→${reset} ${bold}${label}${reset} ${dim}(current)${reset}`;
      } else {
        line = `  ${dim}○ ${label}${reset}`;
      }
      const padding = width - 6 - label.length - (i === currentIdx ? 10 : 0);
      lines.push(`${cyan}║${reset}${line}${' '.repeat(Math.max(0, padding))}${cyan}║${reset}`);
    }
  } else if (phase.phase === 'SHIPPED') {
    lines.push(`${cyan}║${reset}  ${green}${bold}SHIPPED${reset}  ${progressBar(1, 1)}${' '.repeat(width - 38)}${cyan}║${reset}`);
    lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
    lines.push(`${cyan}║${reset}  ${green}✓${reset} Project complete!${' '.repeat(width - 23)}${cyan}║${reset}`);
  }

  lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
  lines.push(`${cyan}╠${hLine}╣${reset}`);
  
  // Get prompt
  const key = getPhaseKey(phase);
  const stepData = STEP_PROMPTS[key] || { action: 'Continue', prompt: 'What would you like to do?' };
  const promptToShow = smartPrompt || stepData.prompt;
  
  lines.push(`${cyan}║${reset}  ${bold}NEXT:${reset} ${stepData.action}${' '.repeat(Math.max(0, width - 10 - stepData.action.length))}${cyan}║${reset}`);
  
  if (smartPrompt) {
    lines.push(`${cyan}║${reset}  ${magenta}✨ AI-generated prompt${reset}${' '.repeat(width - 27)}${cyan}║${reset}`);
  }
  
  lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
  lines.push(`${cyan}║${reset}  ${dim}Paste this in Cursor:${reset}${' '.repeat(width - 26)}${cyan}║${reset}`);
  lines.push(`${cyan}║${reset}  ${dim}┌${hLineLight}┐${reset}  ${cyan}║${reset}`);
  
  // Wrap prompt text
  const promptLines = promptToShow.split('\n');
  for (const pLine of promptLines.slice(0, 5)) {
    const truncated = pLine.slice(0, width - 10);
    const padding = width - 8 - truncated.length;
    lines.push(`${cyan}║${reset}  ${dim}│${reset} ${truncated}${' '.repeat(Math.max(0, padding))}${dim}│${reset}  ${cyan}║${reset}`);
  }
  if (promptLines.length > 5) {
    lines.push(`${cyan}║${reset}  ${dim}│ ...${' '.repeat(width - 13)}│${reset}  ${cyan}║${reset}`);
  }
  
  lines.push(`${cyan}║${reset}  ${dim}└${hLineLight}┘${reset}  ${cyan}║${reset}`);
  lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
  lines.push(`${cyan}╠${hLine}╣${reset}`);
  lines.push(`${cyan}║${reset}  ${dim}[c]${reset} Copy  ${dim}[n]${reset} Next  ${dim}[b]${reset} Back  ${dim}[a]${reset} AI prompt  ${dim}[q]${reset} Quit  ${cyan}║${reset}`);
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
  logEvent(projectPath, { type: 'phase_changed', phase: state.current.phase, step: 'step' in state.current ? state.current.step : undefined });
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
  
  // Check for API key on first run
  await ensureApiKey();
  
  // Set up raw mode
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  const stateData = loadState(projectPath);
  
  const tuiState: TUIState = {
    phase: stateData.current,
    message: '',
    cursorConnected: isCursorAvailable(),
    lastChatSummary: '',
    recentToolCalls: [],
    smartPrompt: null,
    hasApiKey: hasApiKey(),
    isAnalyzing: false,
  };

  const render = () => {
    console.log(clearScreen);
    console.log(drawUI(tuiState, projectPath));
    if (tuiState.message) {
      console.log(`\n  ${tuiState.message}`);
      tuiState.message = '';
    }
  };

  render();

  // Watch Cursor conversations
  let stopWatchingCursor: (() => void) | null = null;
  if (tuiState.cursorConnected) {
    stopWatchingCursor = watchConversations((conv) => {
      tuiState.lastChatSummary = getConversationSummary(conv);
      tuiState.recentToolCalls = extractMidasToolCalls(conv.messages);
      
      // Log midas tool usage
      for (const tool of tuiState.recentToolCalls) {
        logEvent(projectPath, { type: 'tool_called', tool });
      }
      
      render();
    });
  }

  // Watch for docs changes
  const docsPath = join(projectPath, 'docs');
  let watcher: ReturnType<typeof watch> | null = null;
  if (existsSync(docsPath)) {
    watcher = watch(docsPath, { recursive: true }, () => {
      const docs = checkDocs({ projectPath });
      if (docs.ready && tuiState.phase.phase === 'EAGLE_SIGHT') {
        tuiState.message = `${green}✓${reset} Docs complete! Press [n] to start BUILD.`;
        render();
      }
    });
  }

  process.stdin.on('data', async (key: string) => {
    if (key === 'q' || key === '\u0003') {
      console.log(clearScreen);
      console.log(`\n  ${cyan}Midas${reset} signing off. Happy vibecoding!\n`);
      watcher?.close();
      stopWatchingCursor?.();
      process.exit(0);
    }

    if (key === 'c') {
      const stepKey = getPhaseKey(tuiState.phase);
      const prompt = tuiState.smartPrompt || STEP_PROMPTS[stepKey]?.prompt || '';
      try {
        await copyToClipboard(prompt);
        tuiState.message = `${green}✓${reset} Prompt copied to clipboard!`;
        logEvent(projectPath, { type: 'prompt_copied', message: prompt.slice(0, 100) });
      } catch {
        tuiState.message = `${yellow}!${reset} Could not copy. Manually copy the prompt.`;
      }
      render();
    }

    if (key === 'n') {
      tuiState.phase = advancePhase(projectPath);
      tuiState.smartPrompt = null;
      tuiState.message = `${green}→${reset} Advanced to next step`;
      render();
    }

    if (key === 'b') {
      tuiState.phase = goBackPhase(projectPath);
      tuiState.smartPrompt = null;
      tuiState.message = `${yellow}←${reset} Went back one step`;
      render();
    }

    if (key === 'a') {
      if (!tuiState.hasApiKey) {
        tuiState.message = `${yellow}!${reset} No API key. Add to ~/.midas/config.json`;
        render();
        return;
      }
      
      tuiState.message = `${magenta}⟳${reset} Generating AI prompt...`;
      tuiState.isAnalyzing = true;
      render();
      
      try {
        const phaseStr = tuiState.phase.phase;
        const stepStr = 'step' in tuiState.phase ? tuiState.phase.step : '';
        const smart = await generateSmartPrompt(projectPath, phaseStr, stepStr);
        if (smart) {
          tuiState.smartPrompt = smart;
          tuiState.message = `${green}✓${reset} AI prompt generated! Press [c] to copy.`;
        } else {
          tuiState.message = `${yellow}!${reset} Could not generate. Using default prompt.`;
        }
      } catch (err) {
        tuiState.message = `${yellow}!${reset} AI error. Using default prompt.`;
      }
      tuiState.isAnalyzing = false;
      render();
    }

    if (key === 'r') {
      const stateData = loadState(projectPath);
      tuiState.phase = stateData.current;
      tuiState.message = `${blue}↻${reset} Refreshed`;
      render();
    }
  });
}
