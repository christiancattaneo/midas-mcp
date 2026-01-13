import { exec } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { loadState, saveState, type Phase, PHASE_INFO } from './state/phase.js';
import { hasApiKey, ensureApiKey } from './config.js';
import { logEvent, watchEvents, type MidasEvent } from './events.js';
import { analyzeProject, analyzeResponse, type ProjectAnalysis } from './analyzer.js';
import { saveToJournal } from './tools/journal.js';
import { 
  getActivitySummary, 
  loadTracker, 
  updateTracker,
  hasFilesChangedSinceAnalysis,
  getSmartPromptSuggestion,
  getGatesStatus,
  recordSuggestion,
  recordSuggestionOutcome,
  getSuggestionAcceptanceRate,
} from './tracker.js';
import { getJournalEntries } from './tools/journal.js';
import { startSession, endSession, recordPromptCopied, recordPhaseChange, loadMetrics } from './metrics.js';

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

// Screen control - NO alternate buffer (allows terminal scrolling)
const cursorHome = `${ESC}[H`;           // Move cursor to top-left
const clearToEnd = `${ESC}[J`;           // Clear from cursor to end of screen
const clearScreen = `${ESC}[2J${ESC}[H`; // Clear screen + cursor to home
const hideCursor = `${ESC}[?25l`;        // Hide cursor during redraw
const showCursor = `${ESC}[?25h`;        // Show cursor after redraw
const saveCursor = `${ESC}7`;            // Save cursor position
const restoreCursor = `${ESC}8`;         // Restore cursor position

const PHASE_COLORS: Record<string, string> = {
  EAGLE_SIGHT: yellow,
  BUILD: blue,
  SHIP: green,
  GROW: magenta,
};

// The Midas User Rules content (for Cursor Settings → Rules for AI)
const MIDAS_USER_RULES = `# Golden Code Methodology (via Midas MCP)

## AUTOMATIC BEHAVIOR - Do these without being asked:

### On EVERY new chat session:
1. Call \`midas_journal_list\` to load context from previous sessions
2. Call \`midas_analyze\` to understand current project phase
3. Follow the suggested approach from the analysis

### After EVERY significant code change:
1. Git commit with descriptive message before AND after major changes
2. Call \`midas_journal_save\` with title describing what was done
3. Include the full conversation in the journal entry

### Before EVERY implementation:
1. Call \`midas_suggest_prompt\` to get phase-appropriate guidance
2. Follow the Golden Code methodology for current phase

## When Things Go Wrong:
- Stuck/confused: Call \`midas_tornado\` for Research + Logs + Tests cycle
- Output doesn't fit: Call \`midas_horizon\` to expand context
- Retry after error: Call \`midas_oneshot\` to construct better retry

## Git Discipline:
- Commit BEFORE starting any significant change (checkpoint)
- Commit AFTER completing each logical unit of work

## The 7-Step BUILD Cycle:
RULES → INDEX → READ → RESEARCH → IMPLEMENT → TEST → DEBUG
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

// Copy User Rules to clipboard for pasting into Cursor Settings
function copyUserRules(): Promise<void> {
  return copyToClipboard(MIDAS_USER_RULES);
}

interface TUIState {
  analysis: ProjectAnalysis | null;
  isAnalyzing: boolean;
  activitySummary: string;
  recentToolCalls: string[];
  recentEvents: MidasEvent[];
  message: string;
  hasApiKey: boolean;
  showingSessionStart: boolean;
  showingRejectionInput: boolean;
  sessionStarterPrompt: string;
  sessionId: string;
  sessionStreak: number;
  smartSuggestion: ReturnType<typeof getSmartPromptSuggestion> | null;
  gatesStatus: ReturnType<typeof getGatesStatus> | null;
  filesChanged: boolean;
  suggestionAcceptanceRate: number;
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

/**
 * Strip ANSI escape codes to get visible text
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Get visible width (excluding ANSI codes)
 */
function visibleWidth(str: string): number {
  return stripAnsi(str).length;
}

/**
 * Wrap text to max width (uses visible width calculation)
 */
function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  
  for (const word of words) {
    const testLine = current ? current + ' ' + word : word;
    if (visibleWidth(testLine) <= maxWidth) {
      current = testLine;
    } else {
      if (current) lines.push(current);
      // Handle words longer than maxWidth
      if (visibleWidth(word) > maxWidth) {
        current = stripAnsi(word).slice(0, maxWidth);
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

/**
 * Pad text to exact visible width (handles ANSI codes correctly)
 */
function padRight(text: string, width: number): string {
  const visible = visibleWidth(text);
  if (visible >= width) return text;
  return text + ' '.repeat(width - visible);
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
  
  // Row with automatic padding - calculates visible width automatically
  const row = (content: string) => {
    const padded = padRight(content, I);
    return `${cyan}║${reset} ${padded} ${cyan}║${reset}`;
  };
  
  const emptyRow = () => `${cyan}║${reset}${' '.repeat(W - 2)}${cyan}║${reset}`;
  
  const lines: string[] = [];
  
  // Header with right-aligned status
  lines.push(`${cyan}╔${hLine}╗${reset}`);
  const title = `${bold}${white}MIDAS${reset} ${dim}- Golden Code Coach${reset}`;
  const streakStr = state.sessionStreak > 0 ? `${yellow}${state.sessionStreak}d${reset} ` : '';
  const apiStatus = state.hasApiKey ? `${green}OK${reset}` : `${dim}--${reset}`;
  // Activity pulse: count recent events (last 5 min)
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const recentCount = state.recentEvents.filter(e => new Date(e.timestamp).getTime() > fiveMinAgo).length;
  const activityPulse = recentCount > 0 ? `${magenta}${recentCount}${reset} ` : '';
  const statusIcons = `${activityPulse}${streakStr}${apiStatus}`;
  const titleWidth = visibleWidth(title);
  const statusWidth = visibleWidth(statusIcons);
  const headerPadding = Math.max(1, I - titleWidth - statusWidth);
  lines.push(row(`${title}${' '.repeat(headerPadding)}${statusIcons}`));
  lines.push(`${cyan}╠${hLine}╣${reset}`);
  
  // Show session starter prompt first
  if (state.showingSessionStart) {
    lines.push(emptyRow());
    lines.push(row(`${bold}${yellow}NEW SESSION${reset}`));
    lines.push(emptyRow());
    lines.push(row(`${dim}Paste this in your new Cursor chat:${reset}`));
    
    // Inner box with proper alignment
    const boxWidth = I - 4;
    const contentWidth = boxWidth - 4;
    
    const topBorder = `  ${dim}┌${'─'.repeat(boxWidth - 2)}┐${reset}`;
    lines.push(row(topBorder));
    
    const promptWrapped = wrapText(state.sessionStarterPrompt, contentWidth);
    for (const pLine of promptWrapped) {
      const paddedContent = padRight(pLine, contentWidth);
      const boxRow = `  ${dim}│${reset} ${paddedContent} ${dim}│${reset}`;
      lines.push(row(boxRow));
    }
    
    const bottomBorder = `  ${dim}└${'─'.repeat(boxWidth - 2)}┘${reset}`;
    lines.push(row(bottomBorder));
    lines.push(emptyRow());
    lines.push(row(`${dim}TIP: Add User Rules in Cursor Settings for auto-behavior${reset}`));
    lines.push(row(`${dim}Press ${bold}[u]${reset}${dim} to copy User Rules to clipboard${reset}`));
    lines.push(emptyRow());
    
    lines.push(`${cyan}╠${hLine}╣${reset}`);
    lines.push(row(`${dim}[c]${reset} Copy starter  ${dim}[u]${reset} Copy User Rules  ${dim}[p]${reset} Proceed  ${dim}[q]${reset} Quit`));
    lines.push(`${cyan}╚${hLine}╝${reset}`);
    return lines.join('\n');
  }

  if (state.isAnalyzing) {
    lines.push(emptyRow());
    lines.push(row(`${magenta}...${reset} ${bold}Analyzing project${reset}`));
    lines.push(row(`${dim}Reading codebase, chat history, docs...${reset}`));
    lines.push(emptyRow());
    lines.push(`${cyan}╚${hLine}╝${reset}`);
    return lines.join('\n');
  }

  if (!state.analysis) {
    lines.push(emptyRow());
    lines.push(row(`${yellow}!${reset} No analysis yet. Press ${bold}[r]${reset} to analyze.`));
    lines.push(emptyRow());
    lines.push(`${cyan}╠${hLine}╣${reset}`);
    lines.push(row(`${dim}[r]${reset} Analyze  ${dim}[q]${reset} Quit`));
    lines.push(`${cyan}╚${hLine}╝${reset}`);
    return lines.join('\n');
  }

  const a = state.analysis;

  // Project summary (wrapped)
  for (const line of wrapText(a.summary, I)) {
    lines.push(row(`${bold}${line}${reset}`));
  }
  if (a.techStack.length > 0) {
    const stack = a.techStack.slice(0, 5).join(' · ');
    lines.push(row(`${dim}${stack}${reset}`));
  }
  lines.push(emptyRow());

  lines.push(`${cyan}╠${hLine}╣${reset}`);

  // Phase lifecycle bar
  const phases = ['EAGLE_SIGHT', 'BUILD', 'SHIP', 'GROW'] as const;
  const currentPhaseIdx = a.currentPhase.phase === 'IDLE' ? -1 : phases.indexOf(a.currentPhase.phase as typeof phases[number]);
  
  let phaseBarText = '';
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const info = PHASE_INFO[p];
    const color = PHASE_COLORS[p];
    const sep = i < phases.length - 1 ? '  ' : '';
    if (i < currentPhaseIdx) {
      phaseBarText += `${green}[x]${reset} ${dim}${info.name}${reset}${sep}`;
    } else if (i === currentPhaseIdx) {
      phaseBarText += `${color}[>]${reset} ${bold}${info.name}${reset}${sep}`;
    } else {
      phaseBarText += `${dim}[ ] ${info.name}${reset}${sep}`;
    }
  }
  lines.push(row(phaseBarText));
  lines.push(emptyRow());

  // Current phase with confidence
  const confColor = a.confidence >= 70 ? green : a.confidence >= 40 ? yellow : red;
  lines.push(row(`${bold}PHASE:${reset} ${phaseLabel(a.currentPhase)}  ${confColor}${a.confidence}%${reset}`));
  lines.push(emptyRow());

  // What's done
  if (a.whatsDone.length > 0) {
    lines.push(row(`${dim}Completed:${reset}`));
    for (const done of a.whatsDone.slice(0, 4)) {
      const t = done.length > I - 4 ? done.slice(0, I - 7) + '...' : done;
      lines.push(row(`${green}[x]${reset} ${dim}${t}${reset}`));
    }
    lines.push(emptyRow());
  }

  lines.push(`${cyan}╠${hLine}╣${reset}`);

  // What's next (wrapped)
  const nextLines = wrapText(a.whatsNext, I - 6);
  lines.push(row(`${bold}${yellow}NEXT:${reset} ${nextLines[0]}`));
  for (let i = 1; i < nextLines.length; i++) {
    lines.push(row(`      ${nextLines[i]}`));
  }
  lines.push(emptyRow());

  // Suggested prompt - full display with inner box
  if (a.suggestedPrompt) {
    lines.push(row(`${dim}Paste this in Cursor:${reset}`));
    
    // Inner box: 2 char margin on each side, box chars take 2 more
    // Content width = I - 6 (2 margin + 1 border + 1 space on each side)
    const boxWidth = I - 4;  // Width of inner box (including its borders)
    const contentWidth = boxWidth - 4;  // Content inside │ padding │
    
    // Top border: pad to fill row
    const topBorder = `  ${dim}┌${'─'.repeat(boxWidth - 2)}┐${reset}`;
    lines.push(row(topBorder));
    
    // Show full prompt, wrapped
    const promptText = a.suggestedPrompt.replace(/\n/g, ' ');
    const promptWrapped = wrapText(promptText, contentWidth);
    for (const pLine of promptWrapped) {
      const paddedContent = padRight(pLine, contentWidth);
      const boxRow = `  ${dim}│${reset} ${paddedContent} ${dim}│${reset}`;
      lines.push(row(boxRow));
    }
    
    // Bottom border
    const bottomBorder = `  ${dim}└${'─'.repeat(boxWidth - 2)}┘${reset}`;
    lines.push(row(bottomBorder));
  }

  // Show gates status if available
  if (state.gatesStatus) {
    lines.push(emptyRow());
    const gs = state.gatesStatus;
    if (gs.allPass) {
      lines.push(row(`${green}[GATES]${reset} All passing (build, tests, lint)`));
    } else if (gs.failing.length > 0) {
      lines.push(row(`${red}[GATES]${reset} Failing: ${gs.failing.join(', ')}`));
    }
    if (gs.stale) {
      lines.push(row(`${yellow}!${reset} ${dim}Gates are stale - consider running midas_verify${reset}`));
    }
  }

  // Show if files changed since last analysis
  if (state.filesChanged) {
    lines.push(row(`${yellow}!${reset} ${dim}Files changed since analysis - press [r] to refresh${reset}`));
  }

  // Show recent MCP events (real-time from Cursor)
  if (state.recentEvents.length > 0) {
    lines.push(emptyRow());
    lines.push(row(`${dim}Recent MCP Activity:${reset}`));
    for (const evt of state.recentEvents.slice(-3)) {
      const icon = evt.type === 'tool_called' ? `${green}>${reset}` : `${dim}-${reset}`;
      const label = evt.tool || evt.type;
      const time = new Date(evt.timestamp).toLocaleTimeString().slice(0, 5);
      lines.push(row(`${icon} ${label} ${dim}(${time})${reset}`));
    }
  }

  // Show suggestion acceptance rate
  if (state.suggestionAcceptanceRate > 0) {
    lines.push(row(`${dim}Suggestion acceptance: ${state.suggestionAcceptanceRate}%${reset}`));
  }

  lines.push(emptyRow());
  lines.push(`${cyan}╠${hLine}╣${reset}`);
  lines.push(row(`${dim}[c]${reset} Copy  ${dim}[i]${reset} Input  ${dim}[r]${reset} Analyze  ${dim}[v]${reset} Verify  ${dim}[q]${reset} Quit`));
  lines.push(`${cyan}╚${hLine}╝${reset}`);

  return lines.join('\n');
}

export async function runInteractive(): Promise<void> {
  const projectPath = process.cwd();
  
  // Check for API key on first run
  await ensureApiKey();
  
  // Clear screen and save position (no alternate buffer - allows terminal scrolling)
  process.stdout.write(saveCursor + clearScreen);
  
  // Set up raw mode
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  
  // Cleanup function to restore terminal state
  const cleanup = () => {
    process.stdout.write(showCursor + '\n');
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  };
  
  // Ensure cleanup on unexpected exits
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.on('uncaughtException', (err) => {
    cleanup();
    console.error('Uncaught exception:', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    cleanup();
    console.error('Unhandled rejection:', reason);
    process.exit(1);
  });
  
  // Debounce tracking for rapid key presses
  let lastKeyTime = 0;
  const DEBOUNCE_MS = 50;

  // Start a new session for metrics tracking
  const currentPhase = loadState(projectPath).current;
  const sessionId = startSession(projectPath, currentPhase);
  const metrics = loadMetrics(projectPath);
  
  const tuiState: TUIState = {
    analysis: null,
    isAnalyzing: false,
    activitySummary: getActivitySummary(projectPath),
    recentToolCalls: [],
    recentEvents: [],
    message: '',
    hasApiKey: hasApiKey(),
    showingSessionStart: true, // Start with session starter prompt
    showingRejectionInput: false,
    sessionStarterPrompt: getSessionStarterPrompt(projectPath),
    sessionId,
    sessionStreak: metrics.currentStreak,
    smartSuggestion: null,
    gatesStatus: null,
    filesChanged: false,
    suggestionAcceptanceRate: getSuggestionAcceptanceRate(projectPath),
  };

  const render = () => {
    try {
      // Hide cursor, clear, draw, show cursor - prevents flicker
      process.stdout.write(hideCursor + clearScreen);
      process.stdout.write(drawUI(tuiState, projectPath));
      if (tuiState.message) {
        process.stdout.write(`\n  ${tuiState.message}`);
        tuiState.message = '';
      }
      process.stdout.write(showCursor);
    } catch (error) {
      // Attempt recovery
      process.stdout.write(clearScreen + showCursor);
      console.error('Render error:', error);
    }
  };
  
  // Reset state to recover from bad state
  const resetState = () => {
    tuiState.analysis = null;
    tuiState.isAnalyzing = false;
    tuiState.showingSessionStart = false;
    tuiState.showingRejectionInput = false;
    tuiState.message = `${yellow}!${reset} State reset. Press [r] to re-analyze.`;
    tuiState.filesChanged = false;
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
      
      // Get smart suggestion and gates status
      tuiState.smartSuggestion = getSmartPromptSuggestion(projectPath);
      tuiState.gatesStatus = getGatesStatus(projectPath);
      tuiState.filesChanged = false;
      tuiState.suggestionAcceptanceRate = getSuggestionAcceptanceRate(projectPath);
      
      // Record the suggestion for tracking
      if (tuiState.analysis.suggestedPrompt) {
        recordSuggestion(projectPath, tuiState.analysis.suggestedPrompt);
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

  const promptForRejectionReason = async (): Promise<string> => {
    const TIMEOUT_MS = 60000; // 60 second timeout
    
    return new Promise((resolve) => {
      console.log(`\n  ${yellow}Why are you declining this suggestion?${reset}`);
      console.log(`  ${dim}(This helps Midas learn. Press Enter to skip.)${reset}\n`);
      
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      
      // Timeout protection
      const timeout = setTimeout(() => {
        rl.close();
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
        }
        resolve(''); // Timeout = no reason given
      }, TIMEOUT_MS);
      
      rl.question('  > ', (answer) => {
        clearTimeout(timeout);
        rl.close();
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
        }
        resolve(answer.trim());
      });
    });
  };

  // Multi-line input for pasting AI responses
  const promptForResponse = async (): Promise<{ userPrompt: string; aiResponse: string } | null> => {
    const TIMEOUT_MS = 120000; // 2 minute timeout for pasting
    
    return new Promise((resolve) => {
      // Move to bottom and show input area
      process.stdout.write('\n');
      
      console.log(`\n  ${cyan}━━━ Paste AI Response ━━━${reset}`);
      console.log(`  ${dim}Paste the response, then press Enter twice to submit.${reset}\n`);
      
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      
      const lines: string[] = [];
      let emptyLineCount = 0;
      let timeoutId: NodeJS.Timeout | null = null;
      
      // Timeout protection - auto-cancel after 2 minutes
      timeoutId = setTimeout(() => {
        rl.close();
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
        }
        process.stdout.write(clearScreen);
        resolve(null);
      }, TIMEOUT_MS);
      
      const finishInput = () => {
        if (timeoutId) clearTimeout(timeoutId);
        rl.close();
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
        }
        process.stdout.write(clearScreen);
        
        // Remove trailing empty lines
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
          lines.pop();
        }
        
        const fullText = lines.join('\n');
        if (fullText.trim().length < 10) {
          resolve(null);
          return;
        }
        
        // Try to split into user prompt and AI response
        const splitPatterns = [
          /\n(?:assistant|ai|claude|cursor):\s*/i,
          /\n(?:response|answer):\s*/i,
          /\n---+\n/,
        ];
        
        let userPrompt = '';
        let aiResponse = fullText;
        
        for (const pattern of splitPatterns) {
          const match = fullText.match(pattern);
          if (match && match.index) {
            userPrompt = fullText.slice(0, match.index).trim();
            aiResponse = fullText.slice(match.index + match[0].length).trim();
            break;
          }
        }
        
        // If no split found, treat first 20% as prompt
        if (!userPrompt && fullText.length > 100) {
          const splitPoint = Math.min(500, Math.floor(fullText.length * 0.2));
          userPrompt = fullText.slice(0, splitPoint).trim();
          aiResponse = fullText.slice(splitPoint).trim();
        }
        
        resolve({ userPrompt, aiResponse });
      };
      
      rl.on('line', (line) => {
        // Check for double Enter (two empty lines in a row)
        if (line.trim() === '') {
          emptyLineCount++;
          if (emptyLineCount >= 2 && lines.length > 0) {
            finishInput();
            return;
          }
        } else {
          emptyLineCount = 0;
        }
        
        // Also support "END" for those who prefer explicit termination
        if (line.trim().toUpperCase() === 'END' && lines.length > 0) {
          finishInput();
          return;
        }
        
        lines.push(line);
      });
      
      rl.on('close', () => {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
        }
        // Don't clear here - finishInput handles it
      });
    });
  };

  render();

  // Don't auto-analyze - show session starter first
  // User can press [p] to proceed and trigger analysis

  // Watch for activity updates (poll tracker every 5s)
  const activityInterval = setInterval(() => {
    const newSummary = getActivitySummary(projectPath);
    if (newSummary !== tuiState.activitySummary) {
      tuiState.activitySummary = newSummary;
      const tracker = loadTracker(projectPath);
      tuiState.recentToolCalls = tracker.recentToolCalls.slice(0, 5).map(t => t.tool);
      render();
    }
    
    // Check if files changed since last analysis
    if (!tuiState.filesChanged && tuiState.analysis) {
      tuiState.filesChanged = hasFilesChangedSinceAnalysis(projectPath);
      if (tuiState.filesChanged) {
        tuiState.message = `${yellow}!${reset} Files changed. Press [r] to re-analyze.`;
        render();
      }
    }
    
    // Update gates status
    tuiState.gatesStatus = getGatesStatus(projectPath);
  }, 5000);

  // REAL-TIME: Watch for MCP events (tool calls from Cursor)
  const stopWatchingEvents = watchEvents(projectPath, (newEvents) => {
    tuiState.recentEvents = [...tuiState.recentEvents, ...newEvents].slice(-10);
    
    // Show notification for tool calls
    const toolEvents = newEvents.filter(e => e.type === 'tool_called');
    if (toolEvents.length > 0) {
      const lastTool = toolEvents[toolEvents.length - 1];
      tuiState.message = `${green}>${reset} Cursor called ${bold}${lastTool.tool}${reset}`;
      
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
    // Debounce rapid key presses
    const now = Date.now();
    if (now - lastKeyTime < DEBOUNCE_MS) return;
    lastKeyTime = now;
    
    try {
      // Shift+R for hard reset (recovery from bad state)
      if (key === 'R') {
        resetState();
        render();
        return;
      }
      
      if (key === 'q' || key === '\u0003') {
        // End session and save metrics
        const endPhase = tuiState.analysis?.currentPhase || { phase: 'IDLE' as const };
        endSession(projectPath, tuiState.sessionId, endPhase);
        
        clearInterval(activityInterval);
        stopWatchingEvents();
        cleanup();  // Restore terminal state
        console.log(`\n  ${cyan}Midas${reset} signing off. Session saved. Happy vibecoding!\n`);
        process.exit(0);
      }

      // Session start screen handling
      if (tuiState.showingSessionStart) {
      if (key === 'c') {
        try {
          await copyToClipboard(tuiState.sessionStarterPrompt);
          tuiState.message = `${green}OK${reset} Session starter copied! Paste it in your new Cursor chat.`;
        } catch {
          tuiState.message = `${yellow}!${reset} Could not copy.`;
        }
        render();
        return;
      }
      
      if (key === 'p') {
        tuiState.showingSessionStart = false;
        render();
        if (tuiState.hasApiKey) {
          await runAnalysis();
        }
        return;
      }
      
      if (key === 'u') {
        try {
          await copyUserRules();
          tuiState.message = `${green}OK${reset} User Rules copied! Paste in Cursor Settings -> Rules for AI`;
        } catch {
          tuiState.message = `${yellow}!${reset} Could not copy.`;
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
          tuiState.message = `${green}OK${reset} Prompt copied to clipboard!`;
          logEvent(projectPath, { type: 'prompt_copied', message: tuiState.analysis.suggestedPrompt.slice(0, 100) });
          recordPromptCopied(projectPath, tuiState.sessionId);
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

    if (key === 'x') {
      // Decline/reject the current suggestion
      if (tuiState.analysis?.suggestedPrompt) {
        tuiState.showingRejectionInput = true;
        const reason = await promptForRejectionReason();
        tuiState.showingRejectionInput = false;
        
        recordSuggestionOutcome(projectPath, false, undefined, reason || undefined);
        tuiState.suggestionAcceptanceRate = getSuggestionAcceptanceRate(projectPath);
        
        if (reason) {
          tuiState.message = `${yellow}OK${reset} Noted: "${truncate(reason, 40)}" - will learn from this.`;
        } else {
          tuiState.message = `${yellow}OK${reset} Suggestion declined.`;
        }
        
        logEvent(projectPath, { 
          type: 'prompt_copied', 
          message: 'Suggestion declined',
          data: { reason: reason || 'No reason given' }
        });
        
        render();
      } else {
        tuiState.message = `${yellow}!${reset} No suggestion to decline.`;
        render();
      }
    }

    if (key === 'v') {
      // Run verification gates
      tuiState.message = `${magenta}...${reset} Running verification gates (build, test, lint)...`;
      render();
      
      try {
        const { verify } = await import('./tools/verify.js');
        const result = verify({ projectPath });
        
        tuiState.gatesStatus = getGatesStatus(projectPath);
        
        if (result.allPass) {
          tuiState.message = `${green}OK${reset} All gates pass!${result.autoAdvanced ? ` Auto-advanced to ${result.autoAdvanced.to}` : ''}`;
          // Re-analyze to get new suggestions
          await runAnalysis();
        } else {
          tuiState.message = `${red}!${reset} Failing: ${result.failing.join(', ')}`;
          render();
        }
      } catch (error) {
        tuiState.message = `${red}!${reset} Verification failed.`;
        render();
      }
    }

    if (key === 'a') {
      // Add .cursorrules to project
      try {
        const { writeCursorRules, detectTechStack } = await import('./techstack.js');
        const projectName = projectPath.split('/').pop() || 'project';
        const result = writeCursorRules(projectPath, projectName);
        
        if (result.success) {
          const stack = detectTechStack(projectPath);
          tuiState.message = `${green}OK${reset} Created .cursorrules for ${stack.language}${stack.framework ? `/${stack.framework}` : ''}`;
        } else {
          tuiState.message = `${red}!${reset} Failed to create .cursorrules`;
        }
      } catch (error) {
        tuiState.message = `${red}!${reset} Error creating .cursorrules`;
      }
      render();
    }

    if (key === 'i') {
      // Input/paste AI response for analysis
      const exchange = await promptForResponse();
      
      if (!exchange) {
        tuiState.message = `${yellow}!${reset} No response pasted.`;
        render();
        return;
      }
      
      tuiState.message = `${magenta}...${reset} Analyzing response...`;
      render();
      
      try {
        // Analyze the pasted response
        const analysis = await analyzeResponse(projectPath, exchange.userPrompt, exchange.aiResponse);
        
        // Auto-save to journal
        const journalTitle = analysis.summary.slice(0, 80);
        saveToJournal({
          projectPath,
          title: journalTitle,
          conversation: `USER:\n${exchange.userPrompt}\n\nAI:\n${exchange.aiResponse}`,
          tags: analysis.taskComplete ? ['completed'] : ['in-progress'],
        });
        
        // Record any errors to error memory
        if (analysis.errors.length > 0) {
          const { recordError } = await import('./tracker.js');
          for (const err of analysis.errors) {
            recordError(projectPath, err, undefined, undefined);
          }
        }
        
        // Log event
        logEvent(projectPath, {
          type: 'ai_suggestion',
          message: `Analyzed: ${analysis.summary}`,
          data: { 
            accomplished: analysis.accomplished.length,
            errors: analysis.errors.length,
            taskComplete: analysis.taskComplete,
          },
        });
        
        // Update analysis with new suggested prompt
        if (tuiState.analysis) {
          tuiState.analysis.suggestedPrompt = analysis.suggestedNextPrompt;
          tuiState.analysis.whatsNext = analysis.suggestedNextPrompt;
        }
        
        // Show summary
        const accomplishedCount = analysis.accomplished.length;
        const errorsCount = analysis.errors.length;
        let statusMsg = `${green}OK${reset} Analyzed: ${analysis.summary.slice(0, 40)}`;
        if (accomplishedCount > 0) statusMsg += ` | ${green}${accomplishedCount} done${reset}`;
        if (errorsCount > 0) statusMsg += ` | ${red}${errorsCount} errors${reset}`;
        
        tuiState.message = statusMsg;
        tuiState.filesChanged = true;  // Trigger refresh prompt
        
        // Re-analyze if task complete or errors found
        if (analysis.taskComplete || analysis.shouldAdvancePhase) {
          await runAnalysis();
        } else {
          render();
        }
        
      } catch (error) {
        tuiState.message = `${red}!${reset} Failed to analyze response.`;
        render();
      }
    }
    } catch (error) {
      // Global error handler for key processing
      tuiState.message = `${red}!${reset} Error processing key. Press Shift+R to reset.`;
      try { render(); } catch { /* ignore render errors */ }
    }
  });
}
