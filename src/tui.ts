import { exec } from 'child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { loadState, saveState, type Phase, PHASE_INFO } from './state/phase.js';
import { hasApiKey, ensureApiKey } from './config.js';
import { logEvent, watchEvents, type MidasEvent } from './events.js';
import { analyzeProject, type ProjectAnalysis } from './analyzer.js';
import { getActivitySummary, loadTracker, updateTracker } from './tracker.js';
import { getJournalEntries } from './tools/journal.js';

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
const red = `${ESC}[31m`;
const clearScreen = `${ESC}[2J${ESC}[H`;

const PHASE_COLORS: Record<string, string> = {
  EAGLE_SIGHT: yellow,
  BUILD: blue,
  SHIP: green,
  GROW: magenta,
};

// The Midas rules to add to .cursorrules
const MIDAS_CURSORRULES = `
# Golden Code Methodology (via Midas MCP)

## AUTOMATIC BEHAVIOR - Do these without being asked:

### On EVERY new chat session:
1. Call \`midas_journal_list\` to load context from previous sessions
2. Call \`midas_analyze\` to understand current project phase
3. Follow the suggested approach from the analysis

### After EVERY significant code change:
1. Call \`midas_journal_save\` with title describing what was done
2. Include the full conversation in the journal entry

### Before EVERY implementation:
1. Call \`midas_suggest_prompt\` to get phase-appropriate guidance
2. Follow the Golden Code methodology for current phase

## When Things Go Wrong:
- **Stuck/confused**: Call \`midas_tornado\` for Research + Logs + Tests cycle
- **Output doesn't fit**: Call \`midas_horizon\` to expand context
- **Retry after error**: Call \`midas_oneshot\` to construct better retry

## The 7-Step BUILD Cycle:
RULES → INDEX → READ → RESEARCH → IMPLEMENT → TEST → DEBUG
Always complete earlier steps before jumping to implementation.
`;

// Session starter prompt
function getSessionStarterPrompt(projectPath: string): string {
  const journalEntries = getJournalEntries({ projectPath, limit: 3 });
  const hasJournal = journalEntries.length > 0;
  
  if (hasJournal) {
    return `Before we begin, please call midas_journal_list to load context from my previous ${journalEntries.length} journal entries, then call midas_analyze to understand where we are in the project.`;
  }
  return `Before we begin, please call midas_analyze to understand where we are in the project and what to do next.`;
}

// Check if .cursorrules has Midas content
function hasMidasRules(projectPath: string): boolean {
  const rulesPath = join(projectPath, '.cursorrules');
  if (!existsSync(rulesPath)) return false;
  const content = readFileSync(rulesPath, 'utf-8');
  return content.includes('midas_analyze') || content.includes('Golden Code');
}

// Add Midas rules to .cursorrules
function addMidasRules(projectPath: string): void {
  const rulesPath = join(projectPath, '.cursorrules');
  if (existsSync(rulesPath)) {
    appendFileSync(rulesPath, '\n' + MIDAS_CURSORRULES);
  } else {
    writeFileSync(rulesPath, MIDAS_CURSORRULES.trim());
  }
}

interface TUIState {
  analysis: ProjectAnalysis | null;
  isAnalyzing: boolean;
  activitySummary: string;
  recentToolCalls: string[];
  recentEvents: MidasEvent[];
  message: string;
  hasApiKey: boolean;
  hasMidasRules: boolean;
  showingSessionStart: boolean;
  sessionStarterPrompt: string;
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

function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  
  for (const word of words) {
    if (current.length + word.length + 1 <= maxWidth) {
      current += (current ? ' ' : '') + word;
    } else {
      if (current) lines.push(current);
      current = word.length > maxWidth ? word.slice(0, maxWidth) : word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function pad(text: string, width: number): string {
  const len = text.length;
  if (len >= width) return text;
  return text + ' '.repeat(width - len);
}

function phaseLabel(phase: Phase): string {
  if (phase.phase === 'IDLE') return 'Not started';
  const info = PHASE_INFO[phase.phase];
  const color = PHASE_COLORS[phase.phase] || white;
  return `${color}${info.name}${reset} → ${phase.step}`;
}

function phaseLabelSimple(phase: Phase): string {
  if (phase.phase === 'IDLE') return 'Not started';
  const info = PHASE_INFO[phase.phase];
  return `${info.name} → ${phase.step}`;
}

function drawUI(state: TUIState, _projectPath: string): string {
  const W = 70; // total width
  const I = W - 4; // inner content width (between ║ and ║)
  
  const hLine = '═'.repeat(W - 2);
  const hLineLight = '─'.repeat(I);
  
  const row = (content: string, visibleLen: number) => {
    const padding = ' '.repeat(Math.max(0, I - visibleLen));
    return `${cyan}║${reset}  ${content}${padding}${cyan}║${reset}`;
  };
  
  const emptyRow = () => `${cyan}║${reset}${' '.repeat(W - 2)}${cyan}║${reset}`;
  
  const lines: string[] = [];
  
  // Header
  lines.push(`${cyan}╔${hLine}╗${reset}`);
  const statusIcons = `${state.hasApiKey ? `${green}●${reset}AI` : `${dim}○${reset}--`} ${state.hasMidasRules ? `${green}●${reset}Rules` : `${yellow}○${reset}Rules`}`;
  lines.push(row(`${bold}${white}MIDAS${reset} ${dim}- Golden Code Coach${reset}            ${statusIcons}`, I));
  lines.push(`${cyan}╠${hLine}╣${reset}`);
  
  // Show session starter prompt first
  if (state.showingSessionStart) {
    lines.push(emptyRow());
    lines.push(row(`${bold}${yellow}★ NEW SESSION${reset}`, 14));
    lines.push(emptyRow());
    lines.push(row(`${dim}Paste this in your new Cursor chat:${reset}`, 36));
    lines.push(`${cyan}║${reset}  ${dim}┌${hLineLight}┐${reset}${cyan}║${reset}`);
    
    const promptWrapped = wrapText(state.sessionStarterPrompt, I - 4);
    for (const pLine of promptWrapped) {
      lines.push(`${cyan}║${reset}  ${dim}│${reset} ${pad(pLine, I - 4)}${dim}│${reset}${cyan}║${reset}`);
    }
    
    lines.push(`${cyan}║${reset}  ${dim}└${hLineLight}┘${reset}${cyan}║${reset}`);
    lines.push(emptyRow());
    
    if (!state.hasMidasRules) {
      lines.push(row(`${yellow}!${reset} No Midas rules in .cursorrules`, 32));
      lines.push(row(`${dim}Press ${bold}[a]${reset}${dim} to add Golden Code rules${reset}`, 35));
      lines.push(emptyRow());
    }
    
    lines.push(`${cyan}╠${hLine}╣${reset}`);
    lines.push(row(`${dim}[c]${reset} Copy starter  ${dim}[s]${reset} Skip  ${dim}[a]${reset} Add rules  ${dim}[q]${reset} Quit`, 50));
    lines.push(`${cyan}╚${hLine}╝${reset}`);
    return lines.join('\n');
  }

  if (state.isAnalyzing) {
    lines.push(emptyRow());
    lines.push(row(`${magenta}⟳${reset} ${bold}Analyzing project...${reset}`, 23));
    lines.push(row(`${dim}Reading codebase, chat history, docs...${reset}`, 40));
    lines.push(emptyRow());
    lines.push(`${cyan}╚${hLine}╝${reset}`);
    return lines.join('\n');
  }

  if (!state.analysis) {
    lines.push(emptyRow());
    lines.push(row(`${yellow}!${reset} No analysis yet. Press ${bold}[r]${reset} to analyze.`, 44));
    lines.push(emptyRow());
    lines.push(`${cyan}╠${hLine}╣${reset}`);
    lines.push(row(`${dim}[r]${reset} Analyze  ${dim}[q]${reset} Quit`, 22));
    lines.push(`${cyan}╚${hLine}╝${reset}`);
    return lines.join('\n');
  }

  const a = state.analysis;

  // Project summary (wrapped)
  for (const line of wrapText(a.summary, I)) {
    lines.push(row(`${bold}${line}${reset}`, line.length));
  }
  if (a.techStack.length > 0) {
    const stack = a.techStack.slice(0, 5).join(' · ');
    lines.push(row(`${dim}${stack}${reset}`, stack.length));
  }
  lines.push(emptyRow());

  lines.push(`${cyan}╠${hLine}╣${reset}`);

  // Phase lifecycle bar
  const phases = ['EAGLE_SIGHT', 'BUILD', 'SHIP', 'GROW'] as const;
  const currentPhaseIdx = a.currentPhase.phase === 'IDLE' ? -1 : phases.indexOf(a.currentPhase.phase as typeof phases[number]);
  
  let phaseBarText = '';
  let phaseBarLen = 0;
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const info = PHASE_INFO[p];
    const color = PHASE_COLORS[p];
    const sep = i < phases.length - 1 ? '  ' : '';
    if (i < currentPhaseIdx) {
      phaseBarText += `${green}✓${reset} ${dim}${info.name}${reset}${sep}`;
    } else if (i === currentPhaseIdx) {
      phaseBarText += `${color}●${reset} ${bold}${info.name}${reset}${sep}`;
    } else {
      phaseBarText += `${dim}○ ${info.name}${reset}${sep}`;
    }
    phaseBarLen += 2 + info.name.length + sep.length;
  }
  lines.push(row(phaseBarText, phaseBarLen));
  lines.push(emptyRow());

  // Current phase with confidence
  const confColor = a.confidence >= 70 ? green : a.confidence >= 40 ? yellow : red;
  const phaseStr = phaseLabelSimple(a.currentPhase);
  lines.push(row(`${bold}PHASE:${reset} ${phaseLabel(a.currentPhase)}  ${confColor}${a.confidence}%${reset}`, 8 + phaseStr.length + 2 + String(a.confidence).length + 1));
  lines.push(emptyRow());

  // What's done
  if (a.whatsDone.length > 0) {
    lines.push(row(`${dim}Completed:${reset}`, 10));
    for (const done of a.whatsDone.slice(0, 4)) {
      const t = done.length > I - 4 ? done.slice(0, I - 7) + '...' : done;
      lines.push(row(`${green}✓${reset} ${dim}${t}${reset}`, 2 + t.length));
    }
    lines.push(emptyRow());
  }

  lines.push(`${cyan}╠${hLine}╣${reset}`);

  // What's next (wrapped)
  const nextLines = wrapText(a.whatsNext, I - 6);
  lines.push(row(`${bold}${yellow}NEXT:${reset} ${nextLines[0]}`, 6 + nextLines[0].length));
  for (let i = 1; i < nextLines.length; i++) {
    lines.push(row(`      ${nextLines[i]}`, 6 + nextLines[i].length));
  }
  lines.push(emptyRow());

  // Suggested prompt - full display
  if (a.suggestedPrompt) {
    lines.push(row(`${dim}Paste this in Cursor:${reset}`, 21));
    lines.push(`${cyan}║${reset}  ${dim}┌${hLineLight}┐${reset}${cyan}║${reset}`);
    
    // Show full prompt, wrapped
    const promptText = a.suggestedPrompt.replace(/\n/g, ' ');
    const promptWrapped = wrapText(promptText, I - 4);
    for (const pLine of promptWrapped) {
      lines.push(`${cyan}║${reset}  ${dim}│${reset} ${pad(pLine, I - 4)}${dim}│${reset}${cyan}║${reset}`);
    }
    
    lines.push(`${cyan}║${reset}  ${dim}└${hLineLight}┘${reset}${cyan}║${reset}`);
  }

  // Show recent MCP events (real-time from Cursor)
  if (state.recentEvents.length > 0) {
    lines.push(emptyRow());
    lines.push(row(`${dim}Recent MCP Activity:${reset}`, 20));
    for (const evt of state.recentEvents.slice(-3)) {
      const icon = evt.type === 'tool_called' ? `${green}⚡${reset}` : `${dim}○${reset}`;
      const label = evt.tool || evt.type;
      const time = new Date(evt.timestamp).toLocaleTimeString().slice(0, 5);
      lines.push(row(`${icon} ${label} ${dim}(${time})${reset}`, 3 + label.length + 2 + time.length + 2));
    }
  }

  lines.push(emptyRow());
  lines.push(`${cyan}╠${hLine}╣${reset}`);
  lines.push(row(`${dim}[c]${reset} Copy prompt  ${dim}[r]${reset} Re-analyze  ${dim}[q]${reset} Quit`, 43));
  lines.push(`${cyan}╚${hLine}╝${reset}`);

  return lines.join('\n');
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

  const tuiState: TUIState = {
    analysis: null,
    isAnalyzing: false,
    activitySummary: getActivitySummary(projectPath),
    recentToolCalls: [],
    recentEvents: [],
    message: '',
    hasApiKey: hasApiKey(),
    hasMidasRules: hasMidasRules(projectPath),
    showingSessionStart: true, // Start with session starter prompt
    sessionStarterPrompt: getSessionStarterPrompt(projectPath),
  };

  const render = () => {
    console.log(clearScreen);
    console.log(drawUI(tuiState, projectPath));
    if (tuiState.message) {
      console.log(`\n  ${tuiState.message}`);
      tuiState.message = '';
    }
  };

  const runAnalysis = async () => {
    if (!tuiState.hasApiKey) {
      tuiState.message = `${red}!${reset} No API key. Add to ~/.midas/config.json`;
      render();
      return;
    }
    
    tuiState.isAnalyzing = true;
    render();
    
    try {
      tuiState.analysis = await analyzeProject(projectPath);
      
      // Save phase to state
      if (tuiState.analysis.currentPhase) {
        const state = loadState(projectPath);
        state.current = tuiState.analysis.currentPhase;
        saveState(projectPath, state);
      }
      
      logEvent(projectPath, { 
        type: 'ai_suggestion', 
        message: tuiState.analysis.summary,
        data: { phase: tuiState.analysis.currentPhase }
      });
      
    } catch (error) {
      tuiState.message = `${red}!${reset} Analysis failed. Check API key.`;
    }
    
    tuiState.isAnalyzing = false;
    render();
  };

  render();

  // Don't auto-analyze - show session starter first
  // User can press [s] to skip and trigger analysis

  // Watch for activity updates (poll tracker every 5s)
  const activityInterval = setInterval(() => {
    const newSummary = getActivitySummary(projectPath);
    if (newSummary !== tuiState.activitySummary) {
      tuiState.activitySummary = newSummary;
      const tracker = loadTracker(projectPath);
      tuiState.recentToolCalls = tracker.recentToolCalls.slice(0, 5).map(t => t.tool);
      render();
    }
  }, 5000);

  // REAL-TIME: Watch for MCP events (tool calls from Cursor)
  const stopWatchingEvents = watchEvents(projectPath, (newEvents) => {
    tuiState.recentEvents = [...tuiState.recentEvents, ...newEvents].slice(-10);
    
    // Show notification for tool calls
    const toolEvents = newEvents.filter(e => e.type === 'tool_called');
    if (toolEvents.length > 0) {
      const lastTool = toolEvents[toolEvents.length - 1];
      tuiState.message = `${green}⚡${reset} Cursor called ${bold}${lastTool.tool}${reset}`;
      
      // Auto-refresh analysis after certain tools
      const refreshTools = ['midas_journal_save', 'midas_set_phase', 'midas_advance_phase'];
      if (refreshTools.includes(lastTool.tool || '')) {
        runAnalysis();
      } else {
        render();
      }
    }
  });

  process.stdin.on('data', async (key: string) => {
    if (key === 'q' || key === '\u0003') {
      console.log(clearScreen);
      console.log(`\n  ${cyan}Midas${reset} signing off. Happy vibecoding!\n`);
      clearInterval(activityInterval);
      stopWatchingEvents();
      process.exit(0);
    }

    // Session start screen handling
    if (tuiState.showingSessionStart) {
      if (key === 'c') {
        try {
          await copyToClipboard(tuiState.sessionStarterPrompt);
          tuiState.message = `${green}✓${reset} Session starter copied! Paste it in your new Cursor chat.`;
        } catch {
          tuiState.message = `${yellow}!${reset} Could not copy.`;
        }
        render();
        return;
      }
      
      if (key === 's') {
        tuiState.showingSessionStart = false;
        render();
        if (tuiState.hasApiKey) {
          await runAnalysis();
        }
        return;
      }
      
      if (key === 'a') {
        if (!tuiState.hasMidasRules) {
          addMidasRules(projectPath);
          tuiState.hasMidasRules = true;
          tuiState.message = `${green}✓${reset} Added Golden Code rules to .cursorrules`;
        } else {
          tuiState.message = `${dim}Already has Midas rules${reset}`;
        }
        render();
        return;
      }
      
      return; // Ignore other keys on session start screen
    }

    if (key === 'c') {
      if (tuiState.analysis?.suggestedPrompt) {
        try {
          await copyToClipboard(tuiState.analysis.suggestedPrompt);
          tuiState.message = `${green}✓${reset} Prompt copied to clipboard!`;
          logEvent(projectPath, { type: 'prompt_copied', message: tuiState.analysis.suggestedPrompt.slice(0, 100) });
        } catch {
          tuiState.message = `${yellow}!${reset} Could not copy.`;
        }
      } else {
        tuiState.message = `${yellow}!${reset} No prompt to copy.`;
      }
      render();
    }

    if (key === 'r') {
      await runAnalysis();
    }
  });
}
