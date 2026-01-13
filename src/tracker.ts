import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { execSync } from 'child_process';
import { loadState, saveState, type Phase } from './state/phase.js';

const MIDAS_DIR = '.midas';
const TRACKER_FILE = 'tracker.json';

export interface FileActivity {
  path: string;
  lastModified: number;
  linesChanged?: number;
}

export interface GitActivity {
  lastCommit?: string;
  lastCommitMessage?: string;
  lastCommitTime?: number;
  uncommittedChanges: number;
  branch: string;
}

export interface ToolCall {
  tool: string;
  timestamp: number;
  args?: Record<string, unknown>;
}

export interface TrackerState {
  lastUpdated: string;
  recentFiles: FileActivity[];
  recentToolCalls: ToolCall[];
  gitActivity: GitActivity | null;
  completionSignals: {
    testsExist: boolean;
    testsLastRun?: number;
    buildSucceeded?: boolean;
    docsComplete: boolean;
  };
  inferredPhase: Phase;
  confidence: number;
}

function getTrackerPath(projectPath: string): string {
  return join(projectPath, MIDAS_DIR, TRACKER_FILE);
}

function ensureDir(projectPath: string): void {
  const dir = join(projectPath, MIDAS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function loadTracker(projectPath: string): TrackerState {
  const path = getTrackerPath(projectPath);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {}
  }
  return getDefaultTracker();
}

export function saveTracker(projectPath: string, tracker: TrackerState): void {
  ensureDir(projectPath);
  tracker.lastUpdated = new Date().toISOString();
  writeFileSync(getTrackerPath(projectPath), JSON.stringify(tracker, null, 2));
}

function getDefaultTracker(): TrackerState {
  return {
    lastUpdated: new Date().toISOString(),
    recentFiles: [],
    recentToolCalls: [],
    gitActivity: null,
    completionSignals: {
      testsExist: false,
      docsComplete: false,
    },
    inferredPhase: { phase: 'IDLE' },
    confidence: 0,
  };
}

// Track when an MCP tool is called
export function trackToolCall(projectPath: string, tool: string, args?: Record<string, unknown>): void {
  const tracker = loadTracker(projectPath);
  
  tracker.recentToolCalls = [
    { tool, timestamp: Date.now(), args },
    ...tracker.recentToolCalls.slice(0, 49), // Keep last 50
  ];
  
  // Update phase based on tool calls
  updatePhaseFromToolCalls(tracker);
  
  saveTracker(projectPath, tracker);
}

// Scan for recently modified files
export function scanRecentFiles(projectPath: string, since?: number): FileActivity[] {
  const cutoff = since || Date.now() - 3600000; // Last hour by default
  const files: FileActivity[] = [];
  const ignore = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.midas'];
  
  function scan(dir: string, depth = 0): void {
    if (depth > 4 || files.length >= 100) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || ignore.includes(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(path, depth + 1);
        } else {
          try {
            const stat = statSync(path);
            if (stat.mtimeMs > cutoff) {
              files.push({
                path: relative(projectPath, path),
                lastModified: stat.mtimeMs,
              });
            }
          } catch {}
        }
      }
    } catch {}
  }
  
  scan(projectPath);
  return files.sort((a, b) => b.lastModified - a.lastModified);
}

// Get git activity
export function getGitActivity(projectPath: string): GitActivity | null {
  if (!existsSync(join(projectPath, '.git'))) return null;
  
  try {
    const branch = execSync('git branch --show-current', { cwd: projectPath, encoding: 'utf-8' }).trim();
    
    let lastCommit: string | undefined;
    let lastCommitMessage: string | undefined;
    let lastCommitTime: number | undefined;
    
    try {
      lastCommit = execSync('git log -1 --format=%H', { cwd: projectPath, encoding: 'utf-8' }).trim();
      lastCommitMessage = execSync('git log -1 --format=%s', { cwd: projectPath, encoding: 'utf-8' }).trim();
      const timeStr = execSync('git log -1 --format=%ct', { cwd: projectPath, encoding: 'utf-8' }).trim();
      lastCommitTime = parseInt(timeStr) * 1000;
    } catch {}
    
    let uncommittedChanges = 0;
    try {
      const status = execSync('git status --porcelain', { cwd: projectPath, encoding: 'utf-8' });
      uncommittedChanges = status.split('\n').filter(Boolean).length;
    } catch {}
    
    return { branch, lastCommit, lastCommitMessage, lastCommitTime, uncommittedChanges };
  } catch {
    return null;
  }
}

// Check completion signals
export function checkCompletionSignals(projectPath: string): TrackerState['completionSignals'] {
  const signals: TrackerState['completionSignals'] = {
    testsExist: false,
    docsComplete: false,
  };
  
  // Check for tests
  const testPatterns = ['.test.', '.spec.', '__tests__', 'tests/'];
  const files = scanRecentFiles(projectPath, 0); // All files
  signals.testsExist = files.some(f => testPatterns.some(p => f.path.includes(p)));
  
  // Check docs
  const docsPath = join(projectPath, 'docs');
  if (existsSync(docsPath)) {
    const brainlift = existsSync(join(docsPath, 'brainlift.md'));
    const prd = existsSync(join(docsPath, 'prd.md'));
    const gameplan = existsSync(join(docsPath, 'gameplan.md'));
    signals.docsComplete = brainlift && prd && gameplan;
  }
  
  return signals;
}

// Infer phase from tool calls
function updatePhaseFromToolCalls(tracker: TrackerState): void {
  const recent = tracker.recentToolCalls.slice(0, 10);
  if (recent.length === 0) return;
  
  const lastTool = recent[0].tool;
  
  // Tool -> Phase mapping
  const toolPhaseMap: Record<string, Phase> = {
    'midas_start_project': { phase: 'EAGLE_SIGHT', step: 'IDEA' },
    'midas_check_docs': { phase: 'EAGLE_SIGHT', step: 'BRAINLIFT' },
    'midas_tornado': { phase: 'BUILD', step: 'DEBUG' },
    'midas_oneshot': { phase: 'BUILD', step: 'DEBUG' },
    'midas_horizon': { phase: 'BUILD', step: 'IMPLEMENT' },
    'midas_audit': { phase: 'SHIP', step: 'REVIEW' },
  };
  
  if (toolPhaseMap[lastTool]) {
    tracker.inferredPhase = toolPhaseMap[lastTool];
    tracker.confidence = 80;
  }
}

// Full tracker update - call this periodically or on-demand
export function updateTracker(projectPath: string): TrackerState {
  const tracker = loadTracker(projectPath);
  
  // Update file activity
  tracker.recentFiles = scanRecentFiles(projectPath);
  
  // Update git activity
  tracker.gitActivity = getGitActivity(projectPath);
  
  // Update completion signals
  tracker.completionSignals = checkCompletionSignals(projectPath);
  
  // Infer phase from signals
  inferPhaseFromSignals(tracker);
  
  saveTracker(projectPath, tracker);
  return tracker;
}

// Use multiple signals to infer phase
function inferPhaseFromSignals(tracker: TrackerState): void {
  const signals = tracker.completionSignals;
  const git = tracker.gitActivity;
  const recentTools = tracker.recentToolCalls.slice(0, 5).map(t => t.tool);
  
  // If docs don't exist yet, we're in EAGLE_SIGHT
  if (!signals.docsComplete) {
    if (!existsSync(join(process.cwd(), 'docs'))) {
      tracker.inferredPhase = { phase: 'IDLE' };
      tracker.confidence = 90;
      return;
    }
    tracker.inferredPhase = { phase: 'EAGLE_SIGHT', step: 'BRAINLIFT' };
    tracker.confidence = 70;
    return;
  }
  
  // If we have uncommitted changes and recent file edits, we're building
  if (git && git.uncommittedChanges > 0 && tracker.recentFiles.length > 0) {
    // Check what type of files changed
    const recentPaths = tracker.recentFiles.map(f => f.path);
    const hasTestChanges = recentPaths.some(p => p.includes('.test.') || p.includes('.spec.'));
    const hasSrcChanges = recentPaths.some(p => p.includes('src/') || p.includes('lib/'));
    
    if (hasTestChanges) {
      tracker.inferredPhase = { phase: 'BUILD', step: 'TEST' };
    } else if (hasSrcChanges) {
      tracker.inferredPhase = { phase: 'BUILD', step: 'IMPLEMENT' };
    } else {
      tracker.inferredPhase = { phase: 'BUILD', step: 'READ' };
    }
    tracker.confidence = 60;
    return;
  }
  
  // If audit was recently called, we're shipping
  if (recentTools.includes('midas_audit')) {
    tracker.inferredPhase = { phase: 'SHIP', step: 'REVIEW' };
    tracker.confidence = 75;
    return;
  }
  
  // Default to BUILD:IMPLEMENT if we have code
  if (tracker.recentFiles.length > 0) {
    tracker.inferredPhase = { phase: 'BUILD', step: 'IMPLEMENT' };
    tracker.confidence = 40;
  }
}

// Get a summary of current activity for display
export function getActivitySummary(projectPath: string): string {
  const tracker = updateTracker(projectPath);
  const lines: string[] = [];
  
  // Recent files
  if (tracker.recentFiles.length > 0) {
    const topFiles = tracker.recentFiles.slice(0, 3);
    lines.push(`Files: ${topFiles.map(f => f.path.split('/').pop()).join(', ')}`);
  }
  
  // Git status
  if (tracker.gitActivity) {
    if (tracker.gitActivity.uncommittedChanges > 0) {
      lines.push(`${tracker.gitActivity.uncommittedChanges} uncommitted changes`);
    }
    if (tracker.gitActivity.lastCommitMessage) {
      lines.push(`Last: "${tracker.gitActivity.lastCommitMessage.slice(0, 30)}..."`);
    }
  }
  
  // Recent tools
  if (tracker.recentToolCalls.length > 0) {
    const lastTool = tracker.recentToolCalls[0].tool.replace('midas_', '');
    lines.push(`Tool: ${lastTool}`);
  }
  
  return lines.join(' | ') || 'No recent activity';
}
