import { exec } from 'child_process';
import { loadState, saveState, type Phase, type EagleSightStep, type BuildStep } from './state/phase.js';
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

interface TUIState {
  analysis: ProjectAnalysis | null;
  isAnalyzing: boolean;
  cursorConnected: boolean;
  lastChatSummary: string;
  recentToolCalls: string[];
  message: string;
  hasApiKey: boolean;
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

function wrapText(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  
  for (const word of words) {
    if (current.length + word.length + 1 <= width) {
      current += (current ? ' ' : '') + word;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawUI(state: TUIState, projectPath: string): string {
  const lines: string[] = [];
  const width = 64;
  const innerWidth = width - 4;
  
  const hLine = '═'.repeat(width - 2);
  const hLineLight = '─'.repeat(innerWidth);
  
  // Header
  lines.push(`${cyan}╔${hLine}╗${reset}`);
  const statusIcon = state.cursorConnected ? `${green}●${reset}` : `${dim}○${reset}`;
  const aiIcon = state.hasApiKey ? `${magenta}AI${reset}` : `${red}--${reset}`;
  lines.push(`${cyan}║${reset}  ${bold}${white}MIDAS${reset} ${dim}- Elite Vibecoding Coach${reset}      ${statusIcon} Cursor  ${aiIcon}   ${cyan}║${reset}`);
  lines.push(`${cyan}╠${hLine}╣${reset}`);

  if (state.isAnalyzing) {
    lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
    lines.push(`${cyan}║${reset}  ${magenta}⟳${reset} ${bold}Analyzing project...${reset}${' '.repeat(width - 28)}${cyan}║${reset}`);
    lines.push(`${cyan}║${reset}  ${dim}Reading codebase, chat history, docs...${reset}${' '.repeat(width - 46)}${cyan}║${reset}`);
    lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
    lines.push(`${cyan}╚${hLine}╝${reset}`);
    return lines.join('\n');
  }

  if (!state.analysis) {
    lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
    lines.push(`${cyan}║${reset}  ${yellow}!${reset} No analysis yet. Press [r] to analyze.${' '.repeat(width - 47)}${cyan}║${reset}`);
    lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
    lines.push(`${cyan}╠${hLine}╣${reset}`);
    lines.push(`${cyan}║${reset}  ${dim}[r]${reset} Analyze  ${dim}[q]${reset} Quit${' '.repeat(width - 28)}${cyan}║${reset}`);
    lines.push(`${cyan}╚${hLine}╝${reset}`);
    return lines.join('\n');
  }

  const a = state.analysis;

  // Project summary
  lines.push(`${cyan}║${reset}  ${bold}${truncate(a.summary, innerWidth)}${reset}${' '.repeat(Math.max(0, innerWidth - a.summary.length))}${cyan}║${reset}`);
  if (a.techStack.length > 0) {
    const stack = a.techStack.slice(0, 4).join(' · ');
    lines.push(`${cyan}║${reset}  ${dim}${truncate(stack, innerWidth)}${reset}${' '.repeat(Math.max(0, innerWidth - stack.length))}${cyan}║${reset}`);
  }
  lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);

  // Cursor chat context
  if (state.cursorConnected && state.lastChatSummary && state.lastChatSummary !== 'Empty conversation') {
    lines.push(`${cyan}║${reset}  ${dim}Chat:${reset} ${truncate(state.lastChatSummary, innerWidth - 7)}${' '.repeat(Math.max(0, innerWidth - 7 - Math.min(state.lastChatSummary.length, innerWidth - 7)))}${cyan}║${reset}`);
    if (state.recentToolCalls.length > 0) {
      const tools = state.recentToolCalls.slice(0, 3).join(', ');
      lines.push(`${cyan}║${reset}  ${dim}Tools:${reset} ${magenta}${truncate(tools, innerWidth - 8)}${reset}${' '.repeat(Math.max(0, innerWidth - 8 - Math.min(tools.length, innerWidth - 8)))}${cyan}║${reset}`);
    }
    lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
  }

  lines.push(`${cyan}╠${hLine}╣${reset}`);

  // Current phase with confidence
  const phase = a.currentPhase;
  const confColor = a.confidence >= 70 ? green : a.confidence >= 40 ? yellow : red;
  lines.push(`${cyan}║${reset}  ${bold}PHASE:${reset} ${phaseLabel(phase)}  ${confColor}${a.confidence}% confidence${reset}${' '.repeat(Math.max(0, width - 40 - phaseLabel(phase).length))}${cyan}║${reset}`);
  lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);

  // What's done
  if (a.whatsDone.length > 0) {
    lines.push(`${cyan}║${reset}  ${dim}Completed:${reset}${' '.repeat(innerWidth - 10)}${cyan}║${reset}`);
    for (const done of a.whatsDone.slice(0, 4)) {
      lines.push(`${cyan}║${reset}  ${green}✓${reset} ${dim}${truncate(done, innerWidth - 4)}${reset}${' '.repeat(Math.max(0, innerWidth - 4 - Math.min(done.length, innerWidth - 4)))}${cyan}║${reset}`);
    }
    lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
  }

  lines.push(`${cyan}╠${hLine}╣${reset}`);

  // What's next
  lines.push(`${cyan}║${reset}  ${bold}${yellow}NEXT:${reset} ${truncate(a.whatsNext, innerWidth - 7)}${' '.repeat(Math.max(0, innerWidth - 7 - Math.min(a.whatsNext.length, innerWidth - 7)))}${cyan}║${reset}`);
  lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);

  // Suggested prompt
  if (a.suggestedPrompt) {
    lines.push(`${cyan}║${reset}  ${dim}Paste this in Cursor:${reset}${' '.repeat(innerWidth - 21)}${cyan}║${reset}`);
    lines.push(`${cyan}║${reset}  ${dim}┌${hLineLight}┐${reset}${cyan}║${reset}`);
    
    const promptLines = a.suggestedPrompt.split('\n').slice(0, 6);
    for (const pLine of promptLines) {
      const truncated = truncate(pLine, innerWidth - 4);
      lines.push(`${cyan}║${reset}  ${dim}│${reset} ${truncated}${' '.repeat(Math.max(0, innerWidth - 4 - truncated.length))}${dim}│${reset}${cyan}║${reset}`);
    }
    if (a.suggestedPrompt.split('\n').length > 6) {
      lines.push(`${cyan}║${reset}  ${dim}│ ...${' '.repeat(innerWidth - 8)}│${reset}${cyan}║${reset}`);
    }
    
    lines.push(`${cyan}║${reset}  ${dim}└${hLineLight}┘${reset}${cyan}║${reset}`);
  }

  lines.push(`${cyan}║${reset}${' '.repeat(width - 2)}${cyan}║${reset}`);
  lines.push(`${cyan}╠${hLine}╣${reset}`);
  lines.push(`${cyan}║${reset}  ${dim}[c]${reset} Copy prompt  ${dim}[r]${reset} Re-analyze  ${dim}[q]${reset} Quit${' '.repeat(width - 49)}${cyan}║${reset}`);
  lines.push(`${cyan}╚${hLine}╝${reset}`);

  return lines.join('\n');
}

function phaseLabel(phase: Phase): string {
  if (phase.phase === 'IDLE') return 'Not started';
  if (phase.phase === 'SHIPPED') return 'Shipped';
  if (phase.phase === 'EAGLE_SIGHT') return `Eagle Sight → ${phase.step}`;
  return `Build → ${phase.step}`;
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
