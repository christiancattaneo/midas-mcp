import { exec } from 'child_process';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';

// Debug logging for animation issues
let debugLogPath: string | null = null;
function debugLog(msg: string): void {
  if (!debugLogPath) return;
  try {
    appendFileSync(debugLogPath, `${Date.now()} | ${msg}\n`);
  } catch { /* ignore */ }
}
import { loadState, saveState, setPhase, type Phase, PHASE_INFO, getGraduationChecklist, formatGraduationChecklist } from './state/phase.js';
import { hasApiKey, ensureApiKey, getSkillLevel } from './config.js';
import { logEvent, watchEvents, type MidasEvent } from './events.js';
import { analyzeProject, analyzeProjectStreaming, analyzeResponse, type ProjectAnalysis, type AnalysisProgress } from './analyzer.js';
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
  checkIfStuck,
  formatDuration,
} from './tracker.js';
import { getJournalEntries } from './tools/journal.js';
import { showExample } from './tools/examples.js';
import { checkScopeCreep, type ScopeMetrics } from './tools/scope.js';
import { getHotfixStatus } from './tools/hotfix.js';
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

### Phase Transitions - YOU handle these automatically:
- When a phase is complete, call \`midas_advance_phase\` to move forward
- Use \`midas_verify\` to check gates (build, test, lint) before advancing
- If gates fail, fix the issues before advancing
- Never ask the user to "advance me" - YOU have the tools to do it

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

// Session starter prompt - simplified, no longer asks user to call tools manually
// The TUI calls analyzeProject directly, and Cursor should auto-call tools via MIDAS_USER_RULES
function getSessionStarterPrompt(projectPath: string): string {
  const journalEntries = getJournalEntries({ projectPath, limit: 3 });
  const hasJournal = journalEntries.length > 0;
  
  // Give a simple, actionable prompt instead of tool-call instructions
  if (hasJournal) {
    return `Continue where we left off. I have ${journalEntries.length} journal entries with context from previous sessions.`;
  }
  return `Let's get started! Press [p] to analyze the project and get your first suggested action.`;
}

// Copy User Rules to clipboard for pasting into Cursor Settings
function copyUserRules(): Promise<void> {
  return copyToClipboard(MIDAS_USER_RULES);
}

interface TUIState {
  analysis: ProjectAnalysis | null;
  isAnalyzing: boolean;
  analysisProgress: AnalysisProgress | null;  // Real-time streaming progress
  analysisStartTime: number | null;           // For accurate elapsed time display
  activitySummary: string;
  recentToolCalls: string[];
  recentEvents: MidasEvent[];
  message: string;
  hasApiKey: boolean;
  showingSessionStart: boolean;
  showingRejectionInput: boolean;
  showingHelp: boolean;       // Show help screen
  showingInfo: boolean;       // Show info screen (tech stack, gates, stats)
  showingHistory: boolean;    // Show completed items history
  beginnerMode: boolean;      // Simplified display for new users
  sessionStarterPrompt: string;
  sessionId: string;
  sessionStreak: number;
  smartSuggestion: ReturnType<typeof getSmartPromptSuggestion> | null;
  gatesStatus: ReturnType<typeof getGatesStatus> | null;
  filesChanged: boolean;
  suggestionAcceptanceRate: number;
  scopeDrift: ScopeMetrics | null;
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
 * Get the 'why' explanation for the current phase and step
 */
function getStepWhy(phase: Phase): string | null {
  if (phase.phase === 'IDLE') return null;
  
  const phaseInfo = PHASE_INFO[phase.phase];
  if (!phaseInfo) return null;
  
  const stepInfo = (phaseInfo.steps as Record<string, { why?: string }>)?.[phase.step];
  return stepInfo?.why || phaseInfo.why || null;
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
 * Truncates if text exceeds width
 */
function padRight(text: string, width: number): string {
  const visible = visibleWidth(text);
  if (visible > width) {
    // Need to truncate - strip ANSI, truncate, add ellipsis
    const stripped = stripAnsi(text);
    return stripped.slice(0, width - 3) + '...';
  }
  if (visible === width) return text;
  return text + ' '.repeat(width - visible);
}

/**
 * Truncate text with ANSI-aware width calculation
 */
function truncateText(text: string, maxWidth: number): string {
  const visible = visibleWidth(text);
  if (visible <= maxWidth) return text;
  const stripped = stripAnsi(text);
  return stripped.slice(0, maxWidth - 3) + '...';
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

function drawUI(state: TUIState, projectPath: string): string {
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
  
  // Header - minimal
  lines.push(`${cyan}╔${hLine}╗${reset}`);
  const title = `${bold}${white}MIDAS${reset}`;
  const status = `${dim}MCP${reset}`;
  const titleWidth = visibleWidth(title);
  const statusWidth = visibleWidth(status);
  const headerPadding = Math.max(1, I - titleWidth - statusWidth);
  lines.push(row(`${title}${' '.repeat(headerPadding)}${status}`));
  lines.push(`${cyan}╠${hLine}╣${reset}`);
  
  // Show session starter - ultra minimal
  if (state.showingSessionStart) {
    lines.push(emptyRow());
    lines.push(emptyRow());
    lines.push(row(`${cyan}PLAN${reset} → ${blue}BUILD${reset} → ${green}SHIP${reset} → ${magenta}GROW${reset}`));
    lines.push(emptyRow());
    lines.push(row(`${dim}Press${reset} ${bold}Enter${reset} ${dim}to start${reset}`));
    lines.push(emptyRow());
    lines.push(emptyRow());
    
    lines.push(`${cyan}╠${hLine}╣${reset}`);
    lines.push(row(`${bold}Enter${reset} Start  ${dim}[?]${reset} Help  ${dim}[q]${reset} Quit`));
    lines.push(`${cyan}╚${hLine}╝${reset}`);
    return lines.join('\n');
  }

  // Consistency check: validate all row content fits
  // The row() function now truncates automatically via padRight()

  // Help screen
  if (state.showingHelp) {
    lines.push(emptyRow());
    lines.push(row(`${bold}${cyan}HELP - Keyboard Shortcuts${reset}`));
    lines.push(emptyRow());
    lines.push(row(`${dim}Core:${reset}`));
    lines.push(row(`  ${bold}[c]${reset} Copy        Copy prompt to clipboard`));
    lines.push(row(`  ${bold}[r]${reset} Analyze     Re-analyze project`));
    lines.push(row(`  ${bold}[x]${reset} Decline     Skip suggestion with feedback`));
    lines.push(emptyRow());
    lines.push(row(`${dim}Info:${reset}`));
    lines.push(row(`  ${bold}[i]${reset} Info        Tech stack, gates, stats`));
    lines.push(row(`  ${bold}[h]${reset} History     View completed items`));
    lines.push(row(`  ${bold}[e]${reset} Example     Show example for current step`));
    lines.push(emptyRow());
    lines.push(row(`${dim}Advanced:${reset}`));
    lines.push(row(`  ${bold}[v]${reset} Verify      Run build/test/lint gates`));
    lines.push(row(`  ${bold}[d]${reset} Docs        Validate planning documents`));
    lines.push(row(`  ${bold}[a]${reset} Add Rules   Add .cursorrules to project`));
    lines.push(row(`  ${bold}[f]${reset} Hotfix      Toggle hotfix mode`));
    lines.push(emptyRow());
    lines.push(row(`${dim}Exit:${reset}`));
    lines.push(row(`  ${bold}[q]${reset} Quit        Exit Midas TUI`));
    lines.push(emptyRow());
    lines.push(`${cyan}╠${hLine}╣${reset}`);
    lines.push(row(`${dim}Press any key to close${reset}`));
    lines.push(`${cyan}╚${hLine}╝${reset}`);
    return lines.join('\n');
  }

  // Info screen - tech stack, gates, stats
  if (state.showingInfo) {
    const a = state.analysis;
    lines.push(emptyRow());
    lines.push(row(`${bold}${cyan}PROJECT INFO${reset}`));
    lines.push(emptyRow());
    
    if (a?.techStack && a.techStack.length > 0) {
      lines.push(row(`${dim}Tech Stack:${reset}`));
      const stack = a.techStack.slice(0, 8).join(' · ');
      lines.push(row(`  ${stack}`));
      lines.push(emptyRow());
    }
    
    // Gates status
    if (state.gatesStatus) {
      const gs = state.gatesStatus;
      if (gs.allPass) {
        lines.push(row(`${green}[GATES]${reset} All passing (build, tests, lint)`));
      } else if (gs.failing.length > 0) {
        lines.push(row(`${red}[GATES]${reset} Failing: ${gs.failing.join(', ')}`));
      }
      if (gs.stale) {
        lines.push(row(`${dim}Last run: ${gs.stale ? 'stale' : 'fresh'}${reset}`));
      }
      lines.push(emptyRow());
    }
    
    // Skill level
    const skillLevel = getSkillLevel() || 'intermediate';
    lines.push(row(`${dim}Skill Level:${reset} ${skillLevel} (press 'l' to change)`));
    
    // Acceptance rate
    if (state.suggestionAcceptanceRate > 0) {
      lines.push(row(`${dim}Suggestion Acceptance:${reset} ${state.suggestionAcceptanceRate}%`));
    }
    
    // Streak
    if (state.sessionStreak > 0) {
      lines.push(row(`${dim}Streak:${reset} ${state.sessionStreak} days`));
    }
    
    lines.push(emptyRow());
    lines.push(`${cyan}╠${hLine}╣${reset}`);
    lines.push(row(`${dim}Press any key to close${reset}`));
    lines.push(`${cyan}╚${hLine}╝${reset}`);
    return lines.join('\n');
  }

  // History screen - completed items
  if (state.showingHistory) {
    const a = state.analysis;
    lines.push(emptyRow());
    lines.push(row(`${bold}${cyan}COMPLETED${reset}`));
    lines.push(emptyRow());
    
    if (a?.whatsDone && a.whatsDone.length > 0) {
      for (const done of a.whatsDone.slice(0, 10)) {
        const t = done.length > I - 4 ? done.slice(0, I - 7) + '...' : done;
        lines.push(row(`${green}[x]${reset} ${t}`));
      }
      if (a.whatsDone.length > 10) {
        lines.push(row(`${dim}... and ${a.whatsDone.length - 10} more${reset}`));
      }
    } else {
      lines.push(row(`${dim}No completed items yet.${reset}`));
    }
    
    lines.push(emptyRow());
    lines.push(`${cyan}╠${hLine}╣${reset}`);
    lines.push(row(`${dim}Press any key to close${reset}`));
    lines.push(`${cyan}╚${hLine}╝${reset}`);
    return lines.join('\n');
  }

  // GRADUATION SCREEN - Show when in GROW phase
  if (state.analysis?.currentPhase?.phase === 'GROW') {
    lines.push(emptyRow());
    
    // Celebration header
    lines.push(row(`${bold}${green}YOU SHIPPED!${reset}`));
    lines.push(emptyRow());
    
    // Phase completion bar - all done
    lines.push(row(`${green}[x]${reset} Plan  ${green}[x]${reset} Build  ${green}[x]${reset} Ship  ${green}[x]${reset} ${bold}DONE${reset}`));
    lines.push(emptyRow());
    
    lines.push(`${cyan}╠${hLine}╣${reset}`);
    lines.push(row(`${bold}Now grow your project:${reset}`));
    lines.push(emptyRow());
    
    // Show the 8-step graduation checklist
    const checklist = getGraduationChecklist();
    for (let i = 0; i < checklist.length; i++) {
      const item = checklist[i];
      lines.push(row(`${yellow}${i + 1}.${reset} ${bold}${item.name.toUpperCase()}${reset} - ${item.action}`));
    }
    
    lines.push(emptyRow());
    lines.push(`${cyan}╠${hLine}╣${reset}`);
    lines.push(row(`${dim}Ready for v2? Start a new development cycle.${reset}`));
    lines.push(emptyRow());
    
    // Menu bar for graduation screen
    lines.push(`${cyan}╠${hLine}╣${reset}`);
    lines.push(row(`${dim}[n]${reset} New Cycle  ${dim}[c]${reset} Copy Checklist  ${dim}[i]${reset} Info  ${dim}[?]${reset} Help  ${dim}[q]${reset} Quit`));
    lines.push(`${cyan}╚${hLine}╝${reset}`);
    return lines.join('\n');
  }

  if (state.isAnalyzing) {
    lines.push(emptyRow());
    
    // Show real streaming progress with stages
    const progress = state.analysisProgress;
    // Calculate elapsed time fresh each render (not from progress object which freezes between chunks)
    const elapsedMs = state.analysisStartTime ? Date.now() - state.analysisStartTime : 0;
    const elapsed = `${(elapsedMs / 1000).toFixed(1)}s`;
    
    // Spinner frames
    const spinners = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const spinnerFrame = spinners[Math.floor(Date.now() / 100) % spinners.length];
    
    // Stage indicators: done [✓], current [○], pending [ ]
    const stageCheck = (done: boolean, current: boolean) => 
      done ? `${green}[✓]${reset}` : current ? `${yellow}[${spinnerFrame}]${reset}` : `${dim}[ ]${reset}`;
    
    const stages = ['gathering', 'connecting', 'thinking', 'streaming', 'parsing'];
    const currentIdx = progress ? stages.indexOf(progress.stage) : 0;
    
    // Header with elapsed time
    lines.push(row(`${bold}Analyzing project${reset} ${dim}${elapsed}${reset}`));
    lines.push(emptyRow());
    
    // Progress stages with checkmarks
    lines.push(row(`${stageCheck(currentIdx > 0, currentIdx === 0)} Read files and context`));
    lines.push(row(`${stageCheck(currentIdx > 1, currentIdx === 1)} Connect to AI`));
    lines.push(row(`${stageCheck(currentIdx > 2, currentIdx === 2)} Extended thinking`));
    lines.push(row(`${stageCheck(currentIdx > 3, currentIdx === 3)} Receive response`));
    lines.push(row(`${stageCheck(currentIdx > 4, currentIdx === 4)} Parse results`));
    
    lines.push(emptyRow());
    
    // Show streaming details
    if (progress?.stage === 'streaming' && progress.tokensReceived) {
      lines.push(row(`${dim}${progress.tokensReceived} tokens received${reset}`));
      
      // Try to show partial results from streamed content
      if (progress.partialContent) {
        // Look for early JSON fields
        const phaseMatch = progress.partialContent.match(/"phase"\s*:\s*"([^"]+)"/);
        const summaryMatch = progress.partialContent.match(/"summary"\s*:\s*"([^"]{10,60})/);
        const techMatch = progress.partialContent.match(/"techStack"\s*:\s*\[([^\]]{5,50})/);
        
        if (phaseMatch) {
          lines.push(row(`${green}→${reset} Phase: ${bold}${phaseMatch[1]}${reset}`));
        }
        if (techMatch) {
          const techs = techMatch[1].replace(/"/g, '').split(',').slice(0, 3).join(', ');
          lines.push(row(`${green}→${reset} Tech: ${techs}`));
        }
        if (summaryMatch) {
          const summary = summaryMatch[1].slice(0, 40) + '...';
          lines.push(row(`${green}→${reset} ${dim}${summary}${reset}`));
        }
      }
    } else if (progress?.stage === 'thinking') {
      lines.push(row(`${dim}AI is reasoning about your project...${reset}`));
    } else if (progress?.stage === 'gathering') {
      lines.push(row(`${dim}Reading codebase, docs, journal...${reset}`));
    }
    
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

  // Phase lifecycle bar (no project summary - keep it clean)
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
  
  // Show step progress bar within current phase (visual aesthetic - keep)
  if (a.currentPhase.phase !== 'IDLE') {
    const phaseInfo = PHASE_INFO[a.currentPhase.phase];
    const steps = Object.keys(phaseInfo.steps);
    const currentStepIdx = steps.indexOf(a.currentPhase.step);
    const progress = Math.round(((currentStepIdx + 1) / steps.length) * 100);
    
    // Visual progress bar: [████░░░░░░] 40%
    const barWidth = 20;
    const filled = Math.round((progress / 100) * barWidth);
    const empty = barWidth - filled;
    const progressBar = `${green}${'█'.repeat(filled)}${reset}${dim}${'░'.repeat(empty)}${reset}`;
    lines.push(row(`[${progressBar}] ${progress}%`));
  }
  lines.push(emptyRow());

  lines.push(`${cyan}╠${hLine}╣${reset}`);

  // Show brief "why" for current step
  const stepWhy = getStepWhy(a.currentPhase);
  if (stepWhy) {
    const whyText = truncate(stepWhy, I - 2);
    lines.push(row(`${dim}${whyText}${reset}`));
    lines.push(emptyRow());
  }

  // What's next (wrapped)
  const nextLines = wrapText(a.whatsNext, I - 6);
  lines.push(row(`${bold}${yellow}DO:${reset} ${nextLines[0]}`));
  for (let i = 1; i < nextLines.length; i++) {
    lines.push(row(`    ${nextLines[i]}`));
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

  // Only show warnings - keep main view clean
  
  // Gates: only show if FAILING
  if (state.gatesStatus && state.gatesStatus.failing.length > 0) {
    lines.push(row(`${red}[GATES]${reset} Failing: ${state.gatesStatus.failing.join(', ')}`));
  }
  
  // Stuck: show if no progress for 2+ hours
  const stuckInfo = checkIfStuck(projectPath);
  if (stuckInfo?.isStuck) {
    lines.push(row(`${red}[STUCK]${reset} No progress for ${formatDuration(stuckInfo.timeSinceProgress)}`));
  }
  
  // Scope drift: only show if severe (>100%)
  if (state.scopeDrift && state.scopeDrift.driftPercentage > 100) {
    lines.push(row(`${red}[SCOPE +${state.scopeDrift.driftPercentage}%]${reset} Consider splitting or deferring`));
  }

  // Files changed: subtle reminder
  if (state.filesChanged) {
    lines.push(row(`${dim}Files changed - press [r] to refresh${reset}`));
  }

  lines.push(emptyRow());
  lines.push(`${cyan}╠${hLine}╣${reset}`);
  // Minimal menu - fits in one row
  lines.push(row(`${dim}[c]${reset} Copy  ${dim}[x]${reset} Skip  ${dim}[r]${reset} Refresh  ${dim}[i]${reset} Info  ${dim}[?]${reset} Help  ${dim}[q]${reset} Quit`));
  lines.push(`${cyan}╚${hLine}╝${reset}`);

  return lines.join('\n');
}

export async function runInteractive(): Promise<void> {
  const projectPath = process.cwd();
  
  // Set up debug logging
  const midasDir = join(projectPath, '.midas');
  if (!existsSync(midasDir)) {
    mkdirSync(midasDir, { recursive: true });
  }
  debugLogPath = join(midasDir, 'tui-debug.log');
  // Clear previous log
  try {
    appendFileSync(debugLogPath, `\n=== TUI Session Started ${new Date().toISOString()} ===\n`);
  } catch { /* ignore */ }
  
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
    analysisProgress: null,    // Real-time streaming progress
    analysisStartTime: null,   // For accurate elapsed time display
    activitySummary: getActivitySummary(projectPath),
    recentToolCalls: [],
    recentEvents: [],
    message: '',
    hasApiKey: hasApiKey(),
    showingSessionStart: true, // Start with session starter prompt
    showingRejectionInput: false,
    showingHelp: false,
    showingInfo: false,        // Toggle with 'i' key
    showingHistory: false,     // Toggle with 'h' key
    beginnerMode: false,       // Toggle with 'b' key
    sessionStarterPrompt: getSessionStarterPrompt(projectPath),
    sessionId,
    sessionStreak: metrics.currentStreak,
    smartSuggestion: null,
    gatesStatus: null,
    filesChanged: false,
    suggestionAcceptanceRate: getSuggestionAcceptanceRate(projectPath),
    scopeDrift: checkScopeCreep({ projectPath }),
  };

  let renderCount = 0;
  const render = () => {
    renderCount++;
    const stage = tuiState.analysisProgress?.stage || 'none';
    debugLog(`render #${renderCount} stage=${stage} isAnalyzing=${tuiState.isAnalyzing}`);
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
      debugLog(`render ERROR: ${error}`);
      // Attempt recovery
      process.stdout.write(clearScreen + showCursor);
      console.error('Render error:', error);
    }
  };
  
  // Reset state to recover from bad state
  const resetState = () => {
    tuiState.analysis = null;
    tuiState.isAnalyzing = false;
    tuiState.analysisStartTime = null;
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
    tuiState.analysisProgress = null;
    tuiState.analysisStartTime = Date.now();  // Track start time for accurate elapsed display
    render();
    
    // Set up progress update interval for spinner animation
    let intervalCount = 0;
    const progressInterval = setInterval(() => {
      intervalCount++;
      if (tuiState.isAnalyzing) {
        debugLog(`interval #${intervalCount} firing, calling render`);
        render();
      } else {
        debugLog(`interval #${intervalCount} skipped, isAnalyzing=false`);
      }
    }, 100);  // Update every 100ms for smooth spinner
    
    // Timeout protection for analysis (90 seconds max)
    const ANALYSIS_TIMEOUT = 90000;
    let timeoutId: NodeJS.Timeout | null = null;
    
    try {
      // Use streaming analysis with progress callback
      debugLog('Starting analyzeProjectStreaming');
      const analysisPromise = analyzeProjectStreaming(projectPath, (progress) => {
        debugLog(`progress callback: stage=${progress.stage} tokens=${progress.tokensReceived || 0}`);
        tuiState.analysisProgress = progress;
        // render() is called by the interval
      });
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Analysis timeout')), ANALYSIS_TIMEOUT);
      });
      
      tuiState.analysis = await Promise.race([analysisPromise, timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);
      
      // Save phase to state and check for milestones
      if (tuiState.analysis.currentPhase) {
        const state = loadState(projectPath);
        const previousPhase = state.current;
        state.current = tuiState.analysis.currentPhase;
        saveState(projectPath, state);
        
        // Check for phase completion milestone
        const newPhase = tuiState.analysis.currentPhase;
        if ('phase' in previousPhase && 'phase' in newPhase) {
          if (previousPhase.phase !== newPhase.phase) {
            // Phase changed - show milestone message
            const milestones: Record<string, string> = {
              'PLAN': `${green}MILESTONE${reset} Planning complete. Ready to build!`,
              'BUILD': `${green}MILESTONE${reset} Build complete. Time to ship!`,
              'SHIP': `${green}MILESTONE${reset} Shipped! Now collect feedback and grow.`,
              'GROW': `${green}MILESTONE${reset} Growth cycle started. Monitor and iterate.`,
            };
            const milestone = milestones[newPhase.phase];
            if (milestone) {
              tuiState.message = milestone;
              recordPhaseChange(projectPath, newPhase);
            }
          }
        }
      }
      
      // NOTE: Removed sync gate verification here - it used execSync which blocked
      // the event loop and froze the spinner. Gates are run on-demand via 'g' key.
      debugLog('Analysis promise resolved, skipping sync verify');
      
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
      if (timeoutId) clearTimeout(timeoutId);
      let msg = 'Analysis failed. Check API key.';
      if (error instanceof Error) {
        if (error.message === 'Analysis timeout') {
          msg = 'Analysis timed out. Project may be too large.';
        } else if (error.message.includes('Rate limited')) {
          msg = 'Rate limited. Wait a moment and try again.';
        } else if (error.message.includes('Invalid API key')) {
          msg = 'Invalid API key. Check ~/.midas/config.json';
        } else if (error.message.includes('overloaded')) {
          msg = 'API overloaded. Try again in a few seconds.';
        } else {
          // Show the actual error for debugging
          msg = error.message.slice(0, 60);
        }
      }
      tuiState.message = `${red}!${reset} ${msg}`;
    }
    
    debugLog(`Analysis complete, clearing interval after ${intervalCount} intervals`);
    clearInterval(progressInterval);
    tuiState.isAnalyzing = false;
    tuiState.analysisProgress = null;
    tuiState.analysisStartTime = null;
    render();
  };

  const promptForRejectionReason = async (): Promise<string> => {
    const TIMEOUT_MS = 30000; // 30 second timeout (reduced)
    
    return new Promise((resolve) => {
      console.log(`\n  ${yellow}Why are you declining this suggestion?${reset}`);
      console.log(`  ${dim}(Press Enter to skip, or type reason + Enter)${reset}\n`);
      
      // Exit raw mode for line input
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false, // Prevent readline from messing with terminal
      });
      
      let resolved = false;
      
      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        rl.removeAllListeners();
        rl.close();
        // Restore raw mode after cleanup
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
          process.stdin.resume();
        }
      };
      
      // Timeout protection
      const timeout = setTimeout(() => {
        cleanup();
        resolve('');
      }, TIMEOUT_MS);
      
      rl.once('line', (answer) => {
        clearTimeout(timeout);
        cleanup();
        resolve(answer.trim());
      });
      
      rl.once('close', () => {
        clearTimeout(timeout);
        if (!resolved) {
          cleanup();
          resolve('');
        }
      });
      
      rl.once('error', () => {
        clearTimeout(timeout);
        cleanup();
        resolve('');
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
        terminal: false, // Prevent readline from messing with terminal
      });
      
      const lines: string[] = [];
      let emptyLineCount = 0;
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;
      
      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        if (timeoutId) clearTimeout(timeoutId);
        rl.removeAllListeners();
        rl.close();
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
          process.stdin.resume();
        }
        process.stdout.write(clearScreen);
      };
      
      // Timeout protection - auto-cancel after 2 minutes
      timeoutId = setTimeout(() => {
        cleanup();
        resolve(null);
      }, TIMEOUT_MS);
      
      const finishInput = () => {
        cleanup();
        
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
        if (resolved) return;
        
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
      
      rl.once('close', () => {
        if (!resolved) {
          cleanup();
          resolve(null);
        }
      });
      
      rl.once('error', () => {
        cleanup();
        resolve(null);
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
        render();
      }
    }
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

      // Modal screens - any key closes them
      if (tuiState.showingHelp) {
        tuiState.showingHelp = false;
        render();
        return;
      }
      
      if (tuiState.showingInfo) {
        tuiState.showingInfo = false;
        render();
        return;
      }
      
      if (tuiState.showingHistory) {
        tuiState.showingHistory = false;
        render();
        return;
      }

      // Session start screen handling
      if (tuiState.showingSessionStart) {
        if (key === '\r' || key === '\n') {
          // Enter to start
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
        
        if (key === '?') {
          tuiState.showingHelp = true;
          render();
          return;
        }
        
        return; // Ignore other keys on session start screen
      }

    if (key === 'c') {
      // In GROW phase, copy the graduation checklist
      if (tuiState.analysis?.currentPhase?.phase === 'GROW') {
        try {
          const checklist = formatGraduationChecklist();
          await copyToClipboard(checklist);
          tuiState.message = `${green}OK${reset} Graduation checklist copied!`;
          logEvent(projectPath, { type: 'prompt_copied', message: 'Graduation checklist copied' });
        } catch {
          tuiState.message = `${yellow}!${reset} Could not copy.`;
        }
        render();
        return;
      }
      
      // Normal mode: copy suggested prompt
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
    
    if (key === 'n') {
      // Start a new development cycle (return to PLAN → IDEA)
      if (tuiState.analysis?.currentPhase?.phase === 'GROW') {
        try {
          // Save current cycle to journal
          const journalTitle = 'Cycle complete - starting v2';
          saveToJournal({
            projectPath,
            title: journalTitle,
            conversation: `Completed development cycle. Starting new cycle for v2.`,
            tags: ['cycle-complete', 'milestone'],
          });
          
          // Reset to PLAN phase
          setPhase(projectPath, { phase: 'EAGLE_SIGHT', step: 'IDEA' });
          tuiState.message = `${green}OK${reset} New cycle started! Back to PLAN phase.`;
          
          // Re-analyze to get new suggestions
          await runAnalysis();
        } catch {
          tuiState.message = `${red}!${reset} Could not start new cycle.`;
          render();
        }
      } else {
        tuiState.message = `${yellow}!${reset} Finish current phase first.`;
        render();
      }
    }

    if (key === 'r') {
      await runAnalysis();
    }

    if (key === 'e') {
      // Show example for current step
      const phase = tuiState.analysis?.currentPhase || loadState(projectPath).current;
      const step = 'step' in phase ? phase.step : 'BRAINLIFT';
      const example = showExample({ step, projectPath });
      
      // Copy example summary to clipboard, show message
      try {
        await copyToClipboard(example.content);
        tuiState.message = `${green}OK${reset} ${example.exampleFile} copied! (${example.summary.slice(0, 40)}...)`;
      } catch {
        tuiState.message = `${yellow}!${reset} Example for ${step}: see docs/examples/${example.exampleFile}`;
      }
      render();
      return;
    }

    if (key === '?') {
      // Toggle help screen
      tuiState.showingHelp = !tuiState.showingHelp;
      render();
      return;
    }

    if (key === 'b') {
      // Toggle beginner mode (simplified display)
      tuiState.beginnerMode = !tuiState.beginnerMode;
      tuiState.message = tuiState.beginnerMode 
        ? `${green}OK${reset} Beginner mode ON - simplified display`
        : `${green}OK${reset} Beginner mode OFF - full display`;
      render();
      return;
    }

    if (key === 'x') {
      // Decline/reject the current suggestion
      if (tuiState.analysis?.suggestedPrompt) {
        tuiState.showingRejectionInput = true;
        const reason = await promptForRejectionReason();
        tuiState.showingRejectionInput = false;
        
        recordSuggestionOutcome(projectPath, false, undefined, reason || undefined);
        tuiState.suggestionAcceptanceRate = getSuggestionAcceptanceRate(projectPath);
        
        logEvent(projectPath, { 
          type: 'prompt_copied', 
          message: 'Suggestion declined',
          data: { reason: reason || 'No reason given' }
        });
        
        if (reason) {
          tuiState.message = `${yellow}OK${reset} Noted: "${truncate(reason, 40)}" - re-analyzing...`;
          render();
          // Re-analyze with the feedback context
          await runAnalysis();
        } else {
          tuiState.message = `${yellow}OK${reset} Suggestion declined.`;
          render();
        }
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

    if (key === 'd') {
      // Validate planning documents
      tuiState.message = `${magenta}...${reset} Validating planning documents...`;
      render();
      
      try {
        const { validatePlanningDocs } = await import('./tools/validate-docs.js');
        const result = validatePlanningDocs({ projectPath });
        
        if (result.readyForBuild) {
          tuiState.message = `${green}OK${reset} Planning docs complete! Score: ${result.overallScore}%`;
        } else {
          const blockerText = result.blockers.slice(0, 2).join('; ');
          tuiState.message = `${yellow}!${reset} Score: ${result.overallScore}% - ${blockerText}`;
        }
        render();
      } catch (error) {
        tuiState.message = `${red}!${reset} Validation failed.`;
        render();
      }
    }

    if (key === 'l') {
      // Toggle skill level
      const { cycleSkillLevel, getSkillLevelDescription } = await import('./config.js');
      const newLevel = cycleSkillLevel();
      tuiState.message = `${green}OK${reset} Skill level: ${bold}${newLevel}${reset} - ${getSkillLevelDescription(newLevel)}`;
      render();
    }

    if (key === 'h') {
      // Show history (completed items)
      tuiState.showingHistory = true;
      render();
      return;
    }

    if (key === 'i') {
      // Show info screen (tech stack, gates, stats)
      tuiState.showingInfo = true;
      render();
      return;
    }

    if (key === 'f') {
      // Toggle hotfix mode
      const { getHotfixStatus, completeHotfix } = await import('./tools/hotfix.js');
      const status = getHotfixStatus({ projectPath });
      
      if (status.active) {
        // End hotfix mode
        const result = completeHotfix({ projectPath, summary: 'Hotfix completed via TUI' });
        tuiState.message = result.success 
          ? `${green}OK${reset} ${result.message}` 
          : `${yellow}!${reset} ${result.message}`;
        await runAnalysis();
      } else {
        // Start hotfix mode - prompt for description
        tuiState.message = `${yellow}!${reset} To start hotfix, use: midas_start_hotfix with a description`;
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

    if (key === 'P') {
      // (Advanced) Paste AI response for analysis
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
