import { exec } from 'child_process';
import { loadState, saveState, type Phase, PHASE_INFO } from './state/phase.js';
import { hasApiKey, ensureApiKey } from './config.js';
import { logEvent } from './events.js';
import { 
  isCursorAvailable, 
  watchConversations, 
  getConversationSummary,
  extractMidasToolCalls,
} from './cursor.js';
import { analyzeProject, type ProjectAnalysis } from './analyzer.js';

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

interface TUIState {
  analysis: ProjectAnalysis | null;
  isAnalyzing: boolean;
  cursorConnected: boolean;
  lastChatSummary: string;
  recentToolCalls: string[];
  message: string;
  hasApiKey: boolean;
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
  lines.push(row(`${bold}${white}MIDAS${reset} ${dim}- Golden Code Coach${reset}              ${state.cursorConnected ? `${green}●${reset}` : `${dim}○${reset}`} Cursor  ${state.hasApiKey ? `${magenta}AI${reset}` : `${dim}--${reset}`}`, I));
  lines.push(`${cyan}╠${hLine}╣${reset}`);

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
    cursorConnected: isCursorAvailable(),
    lastChatSummary: '',
    recentToolCalls: [],
    message: '',
    hasApiKey: hasApiKey(),
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

  // Auto-analyze on start if API key exists
  if (tuiState.hasApiKey) {
    await runAnalysis();
  }

  // Watch Cursor conversations
  let stopWatchingCursor: (() => void) | null = null;
  if (tuiState.cursorConnected) {
    stopWatchingCursor = watchConversations((conv) => {
      tuiState.lastChatSummary = getConversationSummary(conv);
      tuiState.recentToolCalls = extractMidasToolCalls(conv.messages);
      render();
    });
  }

  process.stdin.on('data', async (key: string) => {
    if (key === 'q' || key === '\u0003') {
      console.log(clearScreen);
      console.log(`\n  ${cyan}Midas${reset} signing off. Happy vibecoding!\n`);
      stopWatchingCursor?.();
      process.exit(0);
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
