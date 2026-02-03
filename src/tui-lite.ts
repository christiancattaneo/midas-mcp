/**
 * Midas TUI Lite
 * 
 * A simplified, passive terminal status display that:
 * - Shows current phase and progress
 * - Displays gate status (build/test/lint)
 * - Auto-refreshes on file changes
 * - Provides QR code for dashboard access
 * 
 * This replaces the complex interactive TUI. For AI interactions,
 * use Claude Code directly. For commands, use `midas` CLI.
 * 
 * Usage: midas status [--watch]
 */

import { existsSync, statSync, watch } from 'fs';
import { join } from 'path';
import { loadState, PHASE_INFO, type Phase } from './state/phase.js';
import { getGatesStatus, loadTracker } from './tracker.js';
import { calculateDeterministicProgress } from './analyzer.js';
import { getGameplanProgress } from './gameplan-tracker.js';
import { isAuthenticated, getAuthenticatedUser } from './auth.js';

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
const red = `${ESC}[31m`;
const white = `${ESC}[37m`;

const clearScreen = `${ESC}[2J${ESC}[H`;
const hideCursor = `${ESC}[?25l`;
const showCursor = `${ESC}[?25h`;

const PHASE_COLORS: Record<string, string> = {
  PLAN: yellow,
  BUILD: blue,
  SHIP: green,
  GROW: magenta,
};

interface StatusData {
  phase: Phase;
  progress: { percentage: number; label: string };
  gates: { allPass: boolean; failing: string[] };
  gameplan: { actual: number; nextSuggested: string | null };
  user: string | null;
  dashboardUrl: string;
}

function getStatusData(projectPath: string): StatusData {
  const state = loadState(projectPath);
  const progress = calculateDeterministicProgress(projectPath);
  const gates = getGatesStatus(projectPath);
  const gameplan = getGameplanProgress(projectPath);
  const user = isAuthenticated() ? (getAuthenticatedUser()?.username || null) : null;
  
  return {
    phase: state.current,
    progress: { percentage: progress.percentage, label: progress.label },
    gates: { allPass: gates.allPass, failing: gates.failing },
    gameplan: { actual: gameplan.actual, nextSuggested: gameplan.nextSuggested ?? null },
    user,
    dashboardUrl: 'https://dashboard.midasmcp.com',
  };
}

function phaseLabel(phase: Phase): string {
  if (phase.phase === 'IDLE') return `${dim}Not started${reset}`;
  const color = PHASE_COLORS[phase.phase] || white;
  return `${color}${bold}${phase.phase}${reset} → ${phase.step}`;
}

function progressBar(percentage: number, width: number = 20): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  const color = percentage >= 75 ? green : percentage >= 40 ? yellow : red;
  return `${color}${'█'.repeat(filled)}${reset}${dim}${'░'.repeat(empty)}${reset}`;
}

function gateIcon(pass: boolean | null): string {
  if (pass === true) return `${green}✓${reset}`;
  if (pass === false) return `${red}✗${reset}`;
  return `${dim}○${reset}`;
}

function renderStatus(data: StatusData): string {
  const W = 60;
  const lines: string[] = [];
  
  // Header
  lines.push(`${cyan}╔${'═'.repeat(W - 2)}╗${reset}`);
  lines.push(`${cyan}║${reset} ${bold}${white}MIDAS${reset}${' '.repeat(W - 9)}${cyan}║${reset}`);
  lines.push(`${cyan}╠${'═'.repeat(W - 2)}╣${reset}`);
  
  // Phase lifecycle
  const phases = ['PLAN', 'BUILD', 'SHIP', 'GROW'] as const;
  let phaseBar = '';
  for (const p of phases) {
    const current = data.phase.phase === p;
    const done = phases.indexOf(p) < phases.indexOf(data.phase.phase as typeof phases[number]);
    const icon = done ? `${green}✓${reset}` : current ? `${PHASE_COLORS[p]}▸${reset}` : `${dim}○${reset}`;
    phaseBar += `${icon} ${current ? bold : dim}${p}${reset}  `;
  }
  lines.push(`${cyan}║${reset} ${phaseBar.trim()}${' '.repeat(Math.max(0, W - 4 - 34))}${cyan}║${reset}`);
  lines.push(`${cyan}║${reset}${' '.repeat(W - 2)}${cyan}║${reset}`);
  
  // Current phase
  const phaseText = phaseLabel(data.phase);
  const phasePad = W - 12 - (data.phase.phase === 'IDLE' ? 11 : data.phase.phase.length + data.phase.step.length + 4);
  lines.push(`${cyan}║${reset} ${bold}Phase:${reset} ${phaseText}${' '.repeat(Math.max(0, phasePad))}${cyan}║${reset}`);
  
  // Progress bar
  const bar = progressBar(data.progress.percentage);
  const pctColor = data.progress.percentage >= 75 ? green : data.progress.percentage >= 40 ? yellow : red;
  lines.push(`${cyan}║${reset} ${bar} ${pctColor}${data.progress.percentage}%${reset}${' '.repeat(Math.max(0, W - 30))}${cyan}║${reset}`);
  lines.push(`${cyan}║${reset} ${dim}${data.progress.label.slice(0, W - 6)}${reset}${' '.repeat(Math.max(0, W - 4 - data.progress.label.length))}${cyan}║${reset}`);
  
  lines.push(`${cyan}║${reset}${' '.repeat(W - 2)}${cyan}║${reset}`);
  lines.push(`${cyan}╠${'═'.repeat(W - 2)}╣${reset}`);
  
  // Gates
  const tracker = loadTracker(process.cwd());
  const gatesText = `${gateIcon(tracker.gates.compiles)} Build  ${gateIcon(tracker.gates.testsPass)} Tests  ${gateIcon(tracker.gates.lintsPass)} Lint`;
  lines.push(`${cyan}║${reset} ${bold}Gates:${reset} ${gatesText}${' '.repeat(Math.max(0, W - 38))}${cyan}║${reset}`);
  
  if (!data.gates.allPass && data.gates.failing.length > 0) {
    const failText = `${red}Failing: ${data.gates.failing.join(', ')}${reset}`;
    lines.push(`${cyan}║${reset} ${failText}${' '.repeat(Math.max(0, W - 15 - data.gates.failing.join(', ').length))}${cyan}║${reset}`);
  }
  
  lines.push(`${cyan}║${reset}${' '.repeat(W - 2)}${cyan}║${reset}`);
  
  // Next task from gameplan
  if (data.gameplan.nextSuggested) {
    lines.push(`${cyan}╠${'═'.repeat(W - 2)}╣${reset}`);
    lines.push(`${cyan}║${reset} ${bold}Next:${reset} ${dim}${data.gameplan.nextSuggested.slice(0, W - 12)}${reset}${' '.repeat(Math.max(0, W - 9 - data.gameplan.nextSuggested.length))}${cyan}║${reset}`);
    lines.push(`${cyan}║${reset}${' '.repeat(W - 2)}${cyan}║${reset}`);
  }
  
  // Footer with commands
  lines.push(`${cyan}╠${'═'.repeat(W - 2)}╣${reset}`);
  lines.push(`${cyan}║${reset} ${dim}claude${reset} for AI  ${dim}midas sync${reset} for dashboard  ${dim}Ctrl+C${reset} quit${' '.repeat(Math.max(0, W - 55))}${cyan}║${reset}`);
  
  // Dashboard link
  if (data.user) {
    lines.push(`${cyan}║${reset} ${dim}Dashboard: ${data.dashboardUrl}${reset}${' '.repeat(Math.max(0, W - 15 - data.dashboardUrl.length))}${cyan}║${reset}`);
  }
  
  lines.push(`${cyan}╚${'═'.repeat(W - 2)}╝${reset}`);
  
  return lines.join('\n');
}

/**
 * Run the lightweight status display
 */
export async function runStatusDisplay(projectPath: string, watchMode: boolean = false): Promise<void> {
  const render = () => {
    const data = getStatusData(projectPath);
    process.stdout.write(clearScreen);
    console.log(renderStatus(data));
    
    if (watchMode) {
      console.log(`\n${dim}Watching for changes...${reset}`);
    }
  };
  
  // Initial render
  render();
  
  if (!watchMode) {
    return;
  }
  
  // Watch mode - refresh on file changes
  process.stdout.write(hideCursor);
  
  const cleanup = () => {
    process.stdout.write(showCursor);
    process.exit(0);
  };
  
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  
  // Watch key directories for changes
  const watchDirs = [
    join(projectPath, 'src'),
    join(projectPath, 'docs'),
    join(projectPath, '.midas'),
  ];
  
  const watchers: ReturnType<typeof watch>[] = [];
  
  for (const dir of watchDirs) {
    if (existsSync(dir)) {
      try {
        const watcher = watch(dir, { recursive: true }, () => {
          render();
        });
        watchers.push(watcher);
      } catch {
        // Ignore watch errors
      }
    }
  }
  
  // Also poll every 5 seconds as backup
  const interval = setInterval(render, 5000);
  
  // Keep process alive
  await new Promise<never>(() => {});
}

/**
 * Print a one-shot status (non-interactive)
 */
export function printStatus(projectPath: string): void {
  const data = getStatusData(projectPath);
  console.log(renderStatus(data));
}
