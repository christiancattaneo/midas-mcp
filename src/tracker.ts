import { existsSync, readFileSync, mkdirSync, statSync, readdirSync, watch } from 'fs';
import { join, relative } from 'path';
import { execSync } from 'child_process';
import writeFileAtomic from 'write-file-atomic';
import { loadState, saveState, getNextPhase, createHistoryEntry, type Phase } from './state/phase.js';
import { sanitizePath, isShellSafe } from './security.js';
import { logger } from './logger.js';
import { discoverDocsSync } from './docs-discovery.js';

const MIDAS_DIR = '.midas';
const TRACKER_FILE = 'tracker.json';

// ============================================================================
// TYPES
// ============================================================================

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
  recentCommits?: string[];  // Last 10 commit messages for phase detection
}

export interface ToolCall {
  tool: string;
  timestamp: number;
  args?: Record<string, unknown>;
}

// NEW: Verification gates
export interface VerificationGates {
  compiles: boolean | null;
  compiledAt: number | null;
  compileError?: string;
  testsPass: boolean | null;
  testedAt: number | null;
  testError?: string;
  failedTests?: number;
  lintsPass: boolean | null;
  lintedAt: number | null;
  lintErrors?: number;
}

// NEW: Error memory - tracks what we've tried
export interface ErrorMemory {
  id: string;
  error: string;
  file?: string;
  line?: number;
  firstSeen: number;
  lastSeen: number;
  fixAttempts: Array<{
    approach: string;
    timestamp: number;
    worked: boolean;
  }>;
  resolved: boolean;
}

// NEW: Current task focus
export interface TaskFocus {
  description: string;
  startedAt: string;
  relatedFiles: string[];
  phase: 'plan' | 'implement' | 'verify' | 'reflect';
  attempts: number;
}

// NEW: Suggestion tracking
export interface SuggestionHistory {
  timestamp: number;
  suggestion: string;
  accepted: boolean;
  userPrompt?: string;  // What user actually sent (if different)
  rejectionReason?: string;
}

// NEW: File snapshot for change detection
export interface FileSnapshot {
  path: string;
  mtime: number;
  size: number;
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
  
  // NEW: Enhanced tracking
  gates: VerificationGates;
  errorMemory: ErrorMemory[];
  currentTask: TaskFocus | null;
  suggestionHistory: SuggestionHistory[];
  fileSnapshot: FileSnapshot[];
  lastAnalysis: number | null;
  
  // Stuck detection
  phaseEnteredAt: number | null;  // When we entered current phase/step
  lastProgressAt: number | null;  // When we last made meaningful progress (commit, test pass, etc.)
}

// ============================================================================
// PERSISTENCE
// ============================================================================

function getTrackerPath(projectPath: string): string {
  return join(projectPath, MIDAS_DIR, TRACKER_FILE);
}

function ensureDir(projectPath: string): void {
  const dir = join(projectPath, MIDAS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Validate and sanitize loaded tracker state.
 * Handles null values, wrong types, and missing fields.
 */
function sanitizeTracker(raw: unknown): TrackerState {
  const defaults = getDefaultTracker();
  
  // If not an object, return defaults
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaults;
  }
  
  const data = raw as Record<string, unknown>;
  
  return {
    ...defaults,
    // Only merge valid fields
    lastUpdated: typeof data.lastUpdated === 'string' ? data.lastUpdated : defaults.lastUpdated,
    recentFiles: Array.isArray(data.recentFiles) ? data.recentFiles as typeof defaults.recentFiles : defaults.recentFiles,
    recentToolCalls: Array.isArray(data.recentToolCalls) ? data.recentToolCalls as typeof defaults.recentToolCalls : defaults.recentToolCalls,
    gitActivity: data.gitActivity && typeof data.gitActivity === 'object' ? data.gitActivity as typeof defaults.gitActivity : defaults.gitActivity,
    completionSignals: data.completionSignals && typeof data.completionSignals === 'object' 
      ? { ...defaults.completionSignals, ...(data.completionSignals as object) }
      : defaults.completionSignals,
    inferredPhase: data.inferredPhase && typeof data.inferredPhase === 'object' 
      ? data.inferredPhase as typeof defaults.inferredPhase 
      : defaults.inferredPhase,
    confidence: typeof data.confidence === 'number' ? data.confidence : defaults.confidence,
    gates: data.gates && typeof data.gates === 'object' 
      ? { ...defaults.gates, ...(data.gates as object) }
      : defaults.gates,
    errorMemory: Array.isArray(data.errorMemory) ? data.errorMemory as typeof defaults.errorMemory : defaults.errorMemory,
    currentTask: data.currentTask && typeof data.currentTask === 'object' ? data.currentTask as typeof defaults.currentTask : defaults.currentTask,
    lastAnalysis: typeof data.lastAnalysis === 'number' ? data.lastAnalysis : defaults.lastAnalysis,
    suggestionHistory: Array.isArray(data.suggestionHistory) ? data.suggestionHistory as typeof defaults.suggestionHistory : defaults.suggestionHistory,
    phaseEnteredAt: typeof data.phaseEnteredAt === 'number' || data.phaseEnteredAt === null ? data.phaseEnteredAt : defaults.phaseEnteredAt,
    lastProgressAt: typeof data.lastProgressAt === 'number' || data.lastProgressAt === null ? data.lastProgressAt : defaults.lastProgressAt,
  };
}

export function loadTracker(projectPath: string): TrackerState {
  const safePath = sanitizePath(projectPath);
  const path = getTrackerPath(safePath);
  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      // Sanitize and validate the loaded data
      return sanitizeTracker(data);
    } catch (error) {
      logger.error('Failed to parse tracker state', error);
    }
  }
  return getDefaultTracker();
}

export function saveTracker(projectPath: string, tracker: TrackerState): void {
  ensureDir(projectPath);
  tracker.lastUpdated = new Date().toISOString();
  // Use atomic write to prevent corruption from concurrent access
  writeFileAtomic.sync(getTrackerPath(projectPath), JSON.stringify(tracker, null, 2));
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
    // NEW defaults
    gates: {
      compiles: null,
      compiledAt: null,
      testsPass: null,
      testedAt: null,
      lintsPass: null,
      lintedAt: null,
    },
    errorMemory: [],
    currentTask: null,
    suggestionHistory: [],
    fileSnapshot: [],
    lastAnalysis: null,
    phaseEnteredAt: null,
    lastProgressAt: null,
  };
}

// ============================================================================
// TOOL CALL TRACKING
// ============================================================================

export function trackToolCall(projectPath: string, tool: string, args?: Record<string, unknown>): void {
  const safePath = sanitizePath(projectPath);
  const tracker = loadTracker(safePath);
  
  tracker.recentToolCalls = [
    { tool, timestamp: Date.now(), args },
    ...tracker.recentToolCalls.slice(0, 49),
  ];
  
  updatePhaseFromToolCalls(tracker);
  saveTracker(safePath, tracker);
}

// ============================================================================
// VERIFICATION GATES
// ============================================================================

export function runVerificationGates(projectPath: string): VerificationGates {
  const safePath = sanitizePath(projectPath);
  const gates: VerificationGates = {
    compiles: null,
    compiledAt: null,
    testsPass: null,
    testedAt: null,
    lintsPass: null,
    lintedAt: null,
  };
  
  if (!isShellSafe(safePath)) {
    logger.debug('Unsafe path for verification', { path: safePath });
    return gates;
  }
  
  // Check if package.json exists
  const pkgPath = join(safePath, 'package.json');
  if (!existsSync(pkgPath)) {
    return gates;
  }
  
  let pkg: { scripts?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    return gates;
  }
  
  // Run build if script exists
  if (pkg.scripts?.build) {
    try {
      execSync('npm run build 2>&1', { cwd: safePath, encoding: 'utf-8', timeout: 60000 });
      gates.compiles = true;
      gates.compiledAt = Date.now();
    } catch (error) {
      gates.compiles = false;
      gates.compiledAt = Date.now();
      gates.compileError = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
    }
  }
  
  // Run tests if script exists
  if (pkg.scripts?.test) {
    try {
      execSync('npm test 2>&1', { cwd: safePath, encoding: 'utf-8', timeout: 120000 });
      gates.testsPass = true;
      gates.testedAt = Date.now();
    } catch (error) {
      gates.testsPass = false;
      gates.testedAt = Date.now();
      const output = error instanceof Error ? error.message : String(error);
      gates.testError = output.slice(0, 500);
      // Try to extract failed test count
      const failMatch = output.match(/(\d+) fail/i);
      if (failMatch) gates.failedTests = parseInt(failMatch[1]);
    }
  }
  
  // Run lint if script exists
  if (pkg.scripts?.lint) {
    try {
      execSync('npm run lint 2>&1', { cwd: safePath, encoding: 'utf-8', timeout: 30000 });
      gates.lintsPass = true;
      gates.lintedAt = Date.now();
    } catch (error) {
      gates.lintsPass = false;
      gates.lintedAt = Date.now();
      const output = error instanceof Error ? error.message : String(error);
      // Try to extract error count
      const errorMatch = output.match(/(\d+) error/i);
      if (errorMatch) gates.lintErrors = parseInt(errorMatch[1]);
    }
  }
  
  // Update tracker with gates
  const tracker = loadTracker(safePath);
  tracker.gates = gates;
  saveTracker(safePath, tracker);
  
  return gates;
}

export function getGatesStatus(projectPath: string): { allPass: boolean; failing: string[]; stale: boolean } {
  const tracker = loadTracker(projectPath);
  const gates = tracker.gates;
  
  const failing: string[] = [];
  if (gates.compiles === false) failing.push('build');
  if (gates.testsPass === false) failing.push('tests');
  if (gates.lintsPass === false) failing.push('lint');
  
  // Consider gates stale if older than 10 minutes or if files changed since
  const oldestGate = Math.min(
    gates.compiledAt || Infinity,
    gates.testedAt || Infinity,
    gates.lintedAt || Infinity
  );
  const stale = oldestGate === Infinity || (Date.now() - oldestGate > 600000);
  
  return {
    allPass: failing.length === 0 && gates.compiles === true,
    failing,
    stale,
  };
}

// ============================================================================
// ERROR MEMORY
// ============================================================================

export function recordError(projectPath: string, error: string, file?: string, line?: number): ErrorMemory {
  const tracker = loadTracker(projectPath);
  
  // Check if we've seen this error before
  const existing = tracker.errorMemory.find(e => 
    e.error === error && e.file === file && !e.resolved
  );
  
  if (existing) {
    existing.lastSeen = Date.now();
    saveTracker(projectPath, tracker);
    return existing;
  }
  
  // New error
  const newError: ErrorMemory = {
    id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    error,
    file,
    line,
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    fixAttempts: [],
    resolved: false,
  };
  
  tracker.errorMemory = [newError, ...tracker.errorMemory.slice(0, 49)];
  saveTracker(projectPath, tracker);
  return newError;
}

export function recordFixAttempt(projectPath: string, errorId: string, approach: string, worked: boolean): void {
  const tracker = loadTracker(projectPath);
  const error = tracker.errorMemory.find(e => e.id === errorId);
  
  if (error) {
    error.fixAttempts.push({
      approach,
      timestamp: Date.now(),
      worked,
    });
    if (worked) {
      error.resolved = true;
    }
    saveTracker(projectPath, tracker);
  }
}

export function getUnresolvedErrors(projectPath: string): ErrorMemory[] {
  const tracker = loadTracker(projectPath);
  return tracker.errorMemory.filter(e => !e.resolved);
}

export function getStuckErrors(projectPath: string): ErrorMemory[] {
  const tracker = loadTracker(projectPath);
  return tracker.errorMemory.filter(e => 
    !e.resolved && e.fixAttempts.length >= 2
  );
}

// ============================================================================
// TASK FOCUS
// ============================================================================

export function setTaskFocus(projectPath: string, description: string, relatedFiles: string[] = []): TaskFocus {
  const tracker = loadTracker(projectPath);
  
  const task: TaskFocus = {
    description,
    startedAt: new Date().toISOString(),
    relatedFiles,
    phase: 'plan',
    attempts: 0,
  };
  
  tracker.currentTask = task;
  saveTracker(projectPath, tracker);
  return task;
}

export function updateTaskPhase(projectPath: string, phase: TaskFocus['phase']): void {
  const tracker = loadTracker(projectPath);
  if (tracker.currentTask) {
    tracker.currentTask.phase = phase;
    if (phase === 'implement') {
      tracker.currentTask.attempts++;
    }
    saveTracker(projectPath, tracker);
  }
}

export function clearTaskFocus(projectPath: string): void {
  const tracker = loadTracker(projectPath);
  tracker.currentTask = null;
  saveTracker(projectPath, tracker);
}

// ============================================================================
// SUGGESTION TRACKING
// ============================================================================

export function recordSuggestion(projectPath: string, suggestion: string): void {
  const tracker = loadTracker(projectPath);
  
  tracker.suggestionHistory = [
    {
      timestamp: Date.now(),
      suggestion,
      accepted: false,  // Will be updated when we see what user sends
    },
    ...tracker.suggestionHistory.slice(0, 19),
  ];
  
  saveTracker(projectPath, tracker);
}

export function recordSuggestionOutcome(
  projectPath: string, 
  accepted: boolean, 
  userPrompt?: string,
  rejectionReason?: string
): void {
  const tracker = loadTracker(projectPath);
  
  if (tracker.suggestionHistory.length > 0) {
    const latest = tracker.suggestionHistory[0];
    latest.accepted = accepted;
    if (userPrompt) latest.userPrompt = userPrompt;
    if (rejectionReason) latest.rejectionReason = rejectionReason;
    saveTracker(projectPath, tracker);
  }
}

export function getSuggestionAcceptanceRate(projectPath: string): number {
  const tracker = loadTracker(projectPath);
  const recent = tracker.suggestionHistory.slice(0, 10);
  if (recent.length === 0) return 0;
  
  const accepted = recent.filter(s => s.accepted).length;
  return Math.round((accepted / recent.length) * 100);
}

/**
 * Get weekly summary of suggestion patterns
 */
export interface WeeklySummary {
  totalSuggestions: number;
  accepted: number;
  declined: number;
  acceptanceRate: number;
  topDeclineReasons: string[];
  patternsToAvoid: string[];
}

export function getWeeklySummary(projectPath: string): WeeklySummary {
  const safePath = sanitizePath(projectPath);
  const tracker = loadTracker(safePath);
  
  // Get suggestions from last 7 days
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekSuggestions = tracker.suggestionHistory.filter(s => s.timestamp > oneWeekAgo);
  
  const accepted = weekSuggestions.filter(s => s.accepted).length;
  const declined = weekSuggestions.filter(s => !s.accepted && s.rejectionReason).length;
  
  // Count decline reasons
  const reasonCounts: Record<string, number> = {};
  for (const s of weekSuggestions) {
    if (!s.accepted && s.rejectionReason) {
      const reason = s.rejectionReason.toLowerCase();
      // Categorize reasons
      if (reason.includes('already') || reason.includes('exist')) {
        reasonCounts['Already exists'] = (reasonCounts['Already exists'] || 0) + 1;
      } else if (reason.includes('wrong') || reason.includes('incorrect')) {
        reasonCounts['Wrong approach'] = (reasonCounts['Wrong approach'] || 0) + 1;
      } else if (reason.includes('scope') || reason.includes('later')) {
        reasonCounts['Out of scope'] = (reasonCounts['Out of scope'] || 0) + 1;
      } else if (reason.includes('irrelevant') || reason.includes('not needed')) {
        reasonCounts['Not relevant'] = (reasonCounts['Not relevant'] || 0) + 1;
      } else {
        reasonCounts['Other'] = (reasonCounts['Other'] || 0) + 1;
      }
    }
  }
  
  // Sort reasons by count
  const topDeclineReasons = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => `${reason} (${count})`);
  
  // Generate patterns to avoid
  const patternsToAvoid: string[] = [];
  if (reasonCounts['Already exists'] > 2) {
    patternsToAvoid.push('Check for existing code before suggesting implementations');
  }
  if (reasonCounts['Out of scope'] > 2) {
    patternsToAvoid.push('Focus on current phase tasks, not future features');
  }
  if (reasonCounts['Not relevant'] > 2) {
    patternsToAvoid.push('Consider project type when suggesting steps');
  }
  
  return {
    totalSuggestions: weekSuggestions.length,
    accepted,
    declined,
    acceptanceRate: weekSuggestions.length > 0 ? Math.round((accepted / weekSuggestions.length) * 100) : 0,
    topDeclineReasons,
    patternsToAvoid,
  };
}

// ============================================================================
// FILE CHANGE DETECTION
// ============================================================================

export function takeFileSnapshot(projectPath: string): FileSnapshot[] {
  const files = scanRecentFiles(projectPath, 0);
  return files.map(f => ({
    path: f.path,
    mtime: f.lastModified,
    size: 0,  // We don't need size for change detection
  }));
}

export function detectFileChanges(projectPath: string): { changed: string[]; added: string[]; deleted: string[] } {
  const tracker = loadTracker(projectPath);
  const oldSnapshot = tracker.fileSnapshot;
  const newSnapshot = takeFileSnapshot(projectPath);
  
  const oldMap = new Map(oldSnapshot.map(f => [f.path, f]));
  const newMap = new Map(newSnapshot.map(f => [f.path, f]));
  
  const changed: string[] = [];
  const added: string[] = [];
  const deleted: string[] = [];
  
  // Find changed and added files
  for (const [path, file] of newMap) {
    const old = oldMap.get(path);
    if (!old) {
      added.push(path);
    } else if (old.mtime !== file.mtime) {
      changed.push(path);
    }
  }
  
  // Find deleted files
  for (const path of oldMap.keys()) {
    if (!newMap.has(path)) {
      deleted.push(path);
    }
  }
  
  // Update snapshot
  tracker.fileSnapshot = newSnapshot;
  saveTracker(projectPath, tracker);
  
  return { changed, added, deleted };
}

export function hasFilesChangedSinceAnalysis(projectPath: string): boolean {
  const tracker = loadTracker(projectPath);
  if (!tracker.lastAnalysis) return true;
  
  const recentFiles = scanRecentFiles(projectPath, tracker.lastAnalysis);
  return recentFiles.length > 0;
}

/**
 * Check if key artifacts have changed since last analysis.
 * Key artifacts are files that should trigger auto-reanalysis:
 * - .cursorrules (rules step completion)
 * - docs/brainlift.md (brainlift step completion)
 * - docs/prd.md (prd step completion)
 * - docs/gameplan.md (gameplan step completion)
 */
export function checkKeyArtifactChanges(projectPath: string): { 
  changed: boolean; 
  artifacts: string[];
  shouldAutoReanalyze: boolean;
} {
  const safePath = sanitizePath(projectPath);
  const tracker = loadTracker(safePath);
  
  // Key artifacts that trigger auto-reanalysis when created/modified
  const keyArtifacts = [
    '.cursorrules',
    'docs/brainlift.md',
    'docs/prd.md', 
    'docs/gameplan.md',
  ];
  
  const changedArtifacts: string[] = [];
  const lastAnalysis = tracker.lastAnalysis || 0;
  
  for (const artifact of keyArtifacts) {
    const fullPath = join(safePath, artifact);
    if (existsSync(fullPath)) {
      try {
        const stat = statSync(fullPath);
        if (stat.mtimeMs > lastAnalysis) {
          changedArtifacts.push(artifact);
        }
      } catch {
        // Ignore stat errors
      }
    }
  }
  
  return {
    changed: changedArtifacts.length > 0,
    artifacts: changedArtifacts,
    // Auto-reanalyze if any key artifact changed
    shouldAutoReanalyze: changedArtifacts.length > 0,
  };
}

export function markAnalysisComplete(projectPath: string): void {
  const tracker = loadTracker(projectPath);
  tracker.lastAnalysis = Date.now();
  saveTracker(projectPath, tracker);
}

// ============================================================================
// SMART PROMPT SUGGESTION
// ============================================================================

// ============================================================================
// COACHING EXPLANATIONS
// ============================================================================

/**
 * Educational explanations for each suggestion type
 * These teach the user WHY this is the right next step
 */
const COACHING = {
  buildFailing: {
    short: 'Build is failing - must fix before continuing',
    explain: `Your code won't compile. In Golden Code, we never proceed with broken builds because:
1. You can't run tests on code that doesn't compile
2. Errors compound - fixing later is harder
3. Every minute coding on a broken base is wasted
Fix compilation errors first, always.`,
  },
  
  testsFailing: {
    short: 'Tests are failing - fix before new features',
    explain: `Failing tests mean your safety net has holes. The Golden Code rule:
1. Never add features with failing tests
2. A test failure is a gift - it caught a bug before users did
3. Fix tests immediately while context is fresh
The longer you wait, the harder it gets to remember what broke.`,
  },
  
  stuckOnError: {
    short: 'Same error multiple times - time for Tornado',
    explain: `You've tried fixing this ${'{attempts}'} times without success. Random fixes won't work.
The Tornado cycle breaks the loop:
1. RESEARCH - Search docs, StackOverflow, GitHub issues for this exact error
2. LOGS - Add console.log/debugger around the problem to see actual values
3. TESTS - Write a minimal test case that reproduces the bug
This systematic approach works when guessing doesn't.`,
  },
  
  lintErrors: {
    short: 'Linter errors present',
    explain: `Linting catches bugs before they become runtime errors:
- Unused variables often indicate logic mistakes
- Type errors prevent crashes
- Style consistency makes code readable for future you
Fix these now - they take seconds but prevent hours of debugging later.`,
  },
  
  unresolvedError: {
    short: 'Unresolved error from earlier session',
    explain: `You left off with an error. Continuing without fixing it means:
- The bug is still there
- You'll hit it again (probably at a worse time)
- Context you had is fading
Address it now while it's still fresh in the codebase.`,
  },
  
  verifyChanges: {
    short: 'No verification run recently',
    explain: `You've made changes but haven't verified them. Golden Code principle:
- Verify early, verify often
- The longer between checks, the harder to find what broke
- A passing build gives confidence to continue
Run build + tests now to catch issues while changes are small.`,
  },
  
  allGatesPass: {
    short: 'All gates pass - ready to advance',
    explain: `Build passes, tests pass, lint passes. This is the green light.
- Your code is verified working
- It's safe to commit and move forward
- You've earned the right to add new features
Consider committing this checkpoint before starting the next task.`,
  },
  
  phaseDefault: (phase: string, step: string) => ({
    short: `Continuing ${phase}:${step}`,
    explain: `You're in the ${phase} phase, ${step} step.
${getPhaseExplanation(phase, step)}
Focus on completing this step before moving to the next.`,
  }),
};

function getPhaseExplanation(phase: string, step: string): string {
  const explanations: Record<string, Record<string, string>> = {
    PLAN: {
      IDEA: 'Define the core problem, who it affects, and why now is the right time to solve it.',
      RESEARCH: 'Study what exists. What works? What fails? Where are the gaps?',
      BRAINLIFT: 'Document your unique insights - what do you know that others don\'t?',
      PRD: 'Write clear requirements. Vague requirements lead to vague implementations.',
      GAMEPLAN: 'Break the build into ordered tasks. Each task should be completable in one session.',
    },
    BUILD: {
      RULES: 'Read project constraints first. Building without knowing the rules wastes time.',
      INDEX: 'Understand the codebase structure before diving in. Where does what live?',
      READ: 'Read the specific files you\'ll touch. Understand before you modify.',
      RESEARCH: 'Look up docs for APIs you\'ll use. Don\'t guess at library behavior.',
      IMPLEMENT: 'Write code with tests. Test-first catches bugs before they compound.',
      TEST: 'Run all tests. Green means safe. Red means stop and fix.',
      DEBUG: 'Use the Tornado cycle: Research + Logs + Tests when stuck.',
    },
    SHIP: {
      REVIEW: 'Review for security, performance, and edge cases before shipping.',
      DEPLOY: 'Deploy with proper CI/CD. Manual deploys are error-prone.',
      MONITOR: 'Set up logs and alerts. You can\'t fix what you can\'t see.',
    },
    GROW: {
      FEEDBACK: 'Collect real user feedback. Your assumptions need validation.',
      ANALYZE: 'Study the data. Where do users struggle? What do they love?',
      ITERATE: 'Plan the next cycle based on evidence, not guesses. Back to Plan phase.',
    },
  };
  
  return explanations[phase]?.[step] || 'Continue with the current step.';
}

export function getSmartPromptSuggestion(projectPath: string): {
  prompt: string;
  reason: string;
  explanation: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  context?: string;
} {
  const tracker = loadTracker(projectPath);
  const gates = tracker.gates;
  const stuckErrors = getStuckErrors(projectPath);
  const unresolvedErrors = getUnresolvedErrors(projectPath);
  
  // Priority 1: CRITICAL - Build is broken
  if (gates.compiles === false) {
    return {
      prompt: `Fix the TypeScript compilation errors:\n${gates.compileError || 'Run npm run build to see errors'}`,
      reason: COACHING.buildFailing.short,
      explanation: COACHING.buildFailing.explain,
      priority: 'critical',
      context: gates.compileError,
    };
  }
  
  // Priority 2: HIGH - Tests are failing
  if (gates.testsPass === false) {
    return {
      prompt: `Fix the failing tests (${gates.failedTests || 'some'} failures):\n${gates.testError || 'Run npm test to see failures'}`,
      reason: COACHING.testsFailing.short,
      explanation: COACHING.testsFailing.explain,
      priority: 'high',
      context: gates.testError,
    };
  }
  
  // Priority 3: HIGH - Stuck on same error
  if (stuckErrors.length > 0) {
    const stuck = stuckErrors[0];
    const triedApproaches = stuck.fixAttempts.filter(a => !a.worked).map(a => a.approach);
    return {
      prompt: `Stuck on error (tried ${stuck.fixAttempts.length}x). Tornado time:\n1. Research: "${stuck.error.slice(0, 50)}"\n2. Add logging around the issue\n3. Write a minimal test case\n\nAlready tried: ${triedApproaches.join(', ')}`,
      reason: COACHING.stuckOnError.short,
      explanation: COACHING.stuckOnError.explain.replace('{attempts}', String(stuck.fixAttempts.length)),
      priority: 'high',
      context: stuck.error,
    };
  }
  
  // Priority 4: NORMAL - Lint errors
  if (gates.lintsPass === false) {
    return {
      prompt: `Fix ${gates.lintErrors || 'the'} linter errors, then run lint again.`,
      reason: COACHING.lintErrors.short,
      explanation: COACHING.lintErrors.explain,
      priority: 'normal',
    };
  }
  
  // Priority 5: NORMAL - Unresolved errors from recent session
  if (unresolvedErrors.length > 0) {
    const recent = unresolvedErrors[0];
    return {
      prompt: `Address this error${recent.file ? ` in ${recent.file}` : ''}:\n${recent.error}`,
      reason: COACHING.unresolvedError.short,
      explanation: COACHING.unresolvedError.explain,
      priority: 'normal',
      context: recent.error,
    };
  }
  
  // Priority 6: Check if gates are stale
  const gatesStatus = getGatesStatus(projectPath);
  if (gatesStatus.stale && tracker.currentTask?.phase === 'implement') {
    return {
      prompt: 'Verify changes: run build and tests to check everything still works.',
      reason: COACHING.verifyChanges.short,
      explanation: COACHING.verifyChanges.explain,
      priority: 'normal',
    };
  }
  
  // Priority 7: All gates pass - suggest advancement
  if (gatesStatus.allPass) {
    return {
      prompt: 'All gates pass. Ready to advance to the next step.',
      reason: COACHING.allGatesPass.short,
      explanation: COACHING.allGatesPass.explain,
      priority: 'low',
    };
  }
  
  // Default: Continue with current phase
  const phase = tracker.inferredPhase;
  const phaseStr = phase.phase;
  const stepStr = 'step' in phase ? phase.step : 'IDLE';
  const coaching = COACHING.phaseDefault(phaseStr, stepStr);
  
  return {
    prompt: getPhaseBasedPrompt(tracker.inferredPhase, tracker.currentTask),
    reason: coaching.short,
    explanation: coaching.explain,
    priority: 'normal',
  };
}

function getPhaseBasedPrompt(phase: Phase, task: TaskFocus | null): string {
  if (phase.phase === 'IDLE') {
    return 'Start a new project or set the phase with midas_set_phase.';
  }
  
  if (phase.phase === 'PLAN') {
    const stepPrompts: Record<string, string> = {
      IDEA: 'Define the core idea: What problem? Who for? Why now?',
      RESEARCH: 'Research the landscape: What exists? What works? What fails?',
      BRAINLIFT: 'Document your unique insights in docs/brainlift.md',
      PRD: 'Write requirements in docs/prd.md',
      GAMEPLAN: 'Plan the build in docs/gameplan.md',
    };
    return stepPrompts[phase.step] || 'Continue planning.';
  }
  
  if (phase.phase === 'BUILD') {
    const taskContext = task ? ` for: ${task.description}` : '';
    const stepPrompts: Record<string, string> = {
      RULES: `Load .cursorrules and understand project constraints${taskContext}`,
      INDEX: `Index the codebase structure and architecture${taskContext}`,
      READ: `Read the specific files needed${taskContext}`,
      RESEARCH: `Research docs and APIs needed${taskContext}`,
      IMPLEMENT: `Implement${taskContext} with tests`,
      TEST: 'Run tests and fix any failures',
      DEBUG: 'Debug using Tornado: Research + Logs + Tests',
    };
    return stepPrompts[phase.step] || 'Continue building.';
  }
  
  if (phase.phase === 'SHIP') {
    const stepPrompts: Record<string, string> = {
      REVIEW: 'Code review: Check security, performance, edge cases',
      DEPLOY: 'Deploy to production: CI/CD, environment config',
      MONITOR: 'Set up monitoring: logs, alerts, health checks',
    };
    return stepPrompts[phase.step] || 'Continue shipping.';
  }
  
  if (phase.phase === 'GROW') {
    const stepPrompts: Record<string, string> = {
      FEEDBACK: 'Collect user feedback: interviews, support tickets, reviews',
      ANALYZE: 'Study the data: metrics, behavior patterns, retention',
      ITERATE: 'Plan next cycle: prioritize and return to Plan phase',
    };
    return stepPrompts[phase.step] || 'Continue growing.';
  }
  
  return 'Continue with the current phase.';
}

// ============================================================================
// AUTO-ADVANCE PHASE
// ============================================================================

/**
 * Auto-advance phase based on:
 * 1. Artifact detection (planning docs, .cursorrules)
 * 2. Gate status (build/test/lint passing)
 * 
 * This prevents users from getting stuck when they've completed a step
 * but the AI didn't call midas_advance_phase.
 */
export function maybeAutoAdvance(projectPath: string): { advanced: boolean; from: Phase; to: Phase; reason?: string } {
  const safePath = sanitizePath(projectPath);
  const tracker = loadTracker(safePath);
  const state = loadState(safePath);
  const currentPhase = state.current;
  
  // Helper to perform advancement
  const doAdvance = (reason: string): { advanced: boolean; from: Phase; to: Phase; reason: string } => {
    const nextPhase = getNextPhase(currentPhase);
    
    // Update state
    state.history.push(createHistoryEntry(currentPhase));
    state.current = nextPhase;
    saveState(safePath, state);
    
    // Update tracker
    tracker.inferredPhase = nextPhase;
    saveTracker(safePath, tracker);
    
    logger.debug('Auto-advanced phase', { from: currentPhase, to: nextPhase, reason });
    
    return { advanced: true, from: currentPhase, to: nextPhase, reason };
  };
  
  // Check for artifact-based advancement in PLAN phase
  if (currentPhase.phase === 'PLAN') {
    const docsResult = discoverDocsSync(safePath);
    
    // PLAN:BRAINLIFT → PLAN:PRD when brainlift.md exists
    if (currentPhase.step === 'BRAINLIFT' && docsResult.brainlift) {
      return doAdvance('brainlift.md created');
    }
    
    // PLAN:PRD → PLAN:GAMEPLAN when prd.md exists
    if (currentPhase.step === 'PRD' && docsResult.prd) {
      return doAdvance('prd.md created');
    }
    
    // PLAN:GAMEPLAN → BUILD:RULES when gameplan.md exists
    if (currentPhase.step === 'GAMEPLAN' && docsResult.gameplan) {
      return doAdvance('gameplan.md created');
    }
  }
  
  // Check for artifact-based advancement in BUILD phase
  if (currentPhase.phase === 'BUILD') {
    // BUILD:RULES → BUILD:INDEX when .cursorrules exists
    if (currentPhase.step === 'RULES') {
      const hasCursorrules = existsSync(join(safePath, '.cursorrules'));
      if (hasCursorrules) {
        return doAdvance('.cursorrules created');
      }
    }
    
    // BUILD:IMPLEMENT or BUILD:TEST → next step when gates pass
    if (currentPhase.step === 'IMPLEMENT' || currentPhase.step === 'TEST') {
      const gatesStatus = getGatesStatus(safePath);
      if (gatesStatus.allPass) {
        return doAdvance('all gates pass');
      }
    }
  }
  
  return { advanced: false, from: currentPhase, to: currentPhase };
}

// ============================================================================
// EXISTING FUNCTIONS (preserved with enhancements)
// ============================================================================

export function scanRecentFiles(projectPath: string, since?: number): FileActivity[] {
  const cutoff = since || Date.now() - 3600000;
  const files: FileActivity[] = [];
  const ignore = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.midas', 'coverage'];
  
  function scan(dir: string, depth = 0): void {
    // Increased limits for better project visibility
    if (depth > 6 || files.length >= 500) return;
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

export function getGitActivity(projectPath: string): GitActivity | null {
  const safePath = sanitizePath(projectPath);
  
  if (!existsSync(join(safePath, '.git'))) return null;
  
  if (!isShellSafe(safePath)) {
    logger.debug('Unsafe path for git commands', { path: safePath });
    return null;
  }
  
  try {
    const branch = execSync('git branch --show-current', { cwd: safePath, encoding: 'utf-8' }).trim();
    
    let lastCommit: string | undefined;
    let lastCommitMessage: string | undefined;
    let lastCommitTime: number | undefined;
    
    try {
      lastCommit = execSync('git log -1 --format=%H', { cwd: safePath, encoding: 'utf-8' }).trim();
      lastCommitMessage = execSync('git log -1 --format=%s', { cwd: safePath, encoding: 'utf-8' }).trim();
      const timeStr = execSync('git log -1 --format=%ct', { cwd: safePath, encoding: 'utf-8' }).trim();
      lastCommitTime = parseInt(timeStr) * 1000;
    } catch {}
    
    let uncommittedChanges = 0;
    try {
      const status = execSync('git status --porcelain', { cwd: safePath, encoding: 'utf-8' });
      uncommittedChanges = status.split('\n').filter(Boolean).length;
    } catch {}
    
    // Get recent commits for phase detection (version bumps, publish, deploy, etc.)
    let recentCommits: string[] = [];
    try {
      const commits = execSync('git log -10 --format=%s', { cwd: safePath, encoding: 'utf-8' });
      recentCommits = commits.split('\n').filter(Boolean);
    } catch {}
    
    return { branch, lastCommit, lastCommitMessage, lastCommitTime, uncommittedChanges, recentCommits };
  } catch (error) {
    logger.error('Failed to get git activity', error);
    return null;
  }
}

export function checkCompletionSignals(projectPath: string): TrackerState['completionSignals'] {
  const signals: TrackerState['completionSignals'] = {
    testsExist: false,
    docsComplete: false,
  };
  
  const testPatterns = ['.test.', '.spec.', '__tests__', 'tests/', '_test.', 'test_', 'spec/'];
  const files = scanRecentFiles(projectPath, 0);
  signals.testsExist = files.some(f => testPatterns.some(p => f.path.includes(p)));
  
  // Use intelligent docs discovery instead of hardcoded filenames
  const docsResult = discoverDocsSync(projectPath);
  signals.docsComplete = docsResult.hasAllPlanningDocs;
  
  return signals;
}

function updatePhaseFromToolCalls(tracker: TrackerState): void {
  const recent = tracker.recentToolCalls.slice(0, 10);
  if (recent.length === 0) return;
  
  const lastTool = recent[0].tool;
  
  const toolPhaseMap: Record<string, Phase> = {
    'midas_start_project': { phase: 'PLAN', step: 'IDEA' },
    'midas_check_docs': { phase: 'PLAN', step: 'BRAINLIFT' },
    'midas_tornado': { phase: 'BUILD', step: 'DEBUG' },
    'midas_oneshot': { phase: 'BUILD', step: 'DEBUG' },
    'midas_horizon': { phase: 'BUILD', step: 'IMPLEMENT' },
    'midas_audit': { phase: 'SHIP', step: 'REVIEW' },
    'midas_verify': { phase: 'BUILD', step: 'TEST' },
  };
  
  if (toolPhaseMap[lastTool]) {
    tracker.inferredPhase = toolPhaseMap[lastTool];
    tracker.confidence = 80;
  }
}

function inferPhaseFromSignals(tracker: TrackerState): void {
  const signals = tracker.completionSignals;
  const git = tracker.gitActivity;
  const recentTools = tracker.recentToolCalls.slice(0, 5).map(t => t.tool);
  
  if (!signals.docsComplete) {
    // Use docs discovery to determine what's missing
    const docsResult = discoverDocsSync(process.cwd());
    if (docsResult.totalDocsFound === 0) {
      tracker.inferredPhase = { phase: 'IDLE' };
      tracker.confidence = 90;
      return;
    }
    // Determine which planning step based on what's missing
    if (!docsResult.brainlift) {
      tracker.inferredPhase = { phase: 'PLAN', step: 'BRAINLIFT' };
    } else if (!docsResult.prd) {
      tracker.inferredPhase = { phase: 'PLAN', step: 'PRD' };
    } else if (!docsResult.gameplan) {
      tracker.inferredPhase = { phase: 'PLAN', step: 'GAMEPLAN' };
    } else {
      tracker.inferredPhase = { phase: 'PLAN', step: 'BRAINLIFT' };
    }
    tracker.confidence = 70;
    return;
  }
  
  if (git && git.uncommittedChanges > 0 && tracker.recentFiles.length > 0) {
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
  
  if (recentTools.includes('midas_audit')) {
    tracker.inferredPhase = { phase: 'SHIP', step: 'REVIEW' };
    tracker.confidence = 75;
    return;
  }
  
  if (tracker.recentFiles.length > 0) {
    tracker.inferredPhase = { phase: 'BUILD', step: 'IMPLEMENT' };
    tracker.confidence = 40;
  }
}

export function updateTracker(projectPath: string): TrackerState {
  const tracker = loadTracker(projectPath);
  
  tracker.recentFiles = scanRecentFiles(projectPath);
  tracker.gitActivity = getGitActivity(projectPath);
  tracker.completionSignals = checkCompletionSignals(projectPath);
  
  inferPhaseFromSignals(tracker);
  
  saveTracker(projectPath, tracker);
  return tracker;
}

export function getActivitySummary(projectPath: string): string {
  const tracker = updateTracker(projectPath);
  const lines: string[] = [];
  
  if (tracker.recentFiles.length > 0) {
    const topFiles = tracker.recentFiles.slice(0, 3);
    lines.push(`Files: ${topFiles.map(f => f.path.split('/').pop()).join(', ')}`);
  }
  
  if (tracker.gitActivity) {
    if (tracker.gitActivity.uncommittedChanges > 0) {
      lines.push(`${tracker.gitActivity.uncommittedChanges} uncommitted changes`);
    }
    if (tracker.gitActivity.lastCommitMessage) {
      lines.push(`Last: "${tracker.gitActivity.lastCommitMessage.slice(0, 30)}..."`);
    }
  }
  
  if (tracker.recentToolCalls.length > 0) {
    const lastTool = tracker.recentToolCalls[0].tool.replace('midas_', '');
    lines.push(`Tool: ${lastTool}`);
  }
  
  // Add gate status
  const gatesStatus = getGatesStatus(projectPath);
  if (gatesStatus.failing.length > 0) {
    lines.push(`Failing: ${gatesStatus.failing.join(', ')}`);
  } else if (gatesStatus.allPass) {
    lines.push('Gates: all pass');
  }
  
  return lines.join(' | ') || 'No recent activity';
}

// ============================================================================
// STUCK DETECTION
// ============================================================================

const STUCK_THRESHOLD_MS = 2 * 60 * 60 * 1000;  // 2 hours

/**
 * Record that the user has entered a new phase/step
 */
export function recordPhaseEntry(projectPath: string): void {
  const tracker = loadTracker(projectPath);
  tracker.phaseEnteredAt = Date.now();
  tracker.lastProgressAt = Date.now();
  saveTracker(projectPath, tracker);
}

/**
 * Record that meaningful progress was made (commit, test pass, etc.)
 */
export function recordProgress(projectPath: string): void {
  const tracker = loadTracker(projectPath);
  tracker.lastProgressAt = Date.now();
  saveTracker(projectPath, tracker);
}

/**
 * Check if the user appears to be stuck
 * Returns stuck info if stuck, null otherwise
 */
export function checkIfStuck(projectPath: string): {
  isStuck: boolean;
  timeInPhase: number;
  timeSinceProgress: number;
  suggestions: string[];
} | null {
  const tracker = loadTracker(projectPath);
  const now = Date.now();
  
  // Calculate time in phase
  const phaseEnteredAt = tracker.phaseEnteredAt || now;
  const timeInPhase = now - phaseEnteredAt;
  
  // Calculate time since last progress
  const lastProgressAt = tracker.lastProgressAt || phaseEnteredAt;
  const timeSinceProgress = now - lastProgressAt;
  
  // Not stuck if we've made progress recently
  if (timeSinceProgress < STUCK_THRESHOLD_MS) {
    return null;
  }
  
  // Check for repeated errors
  const unresolvedErrors = tracker.errorMemory.filter(e => !e.resolved);
  const repeatedErrors = unresolvedErrors.filter(e => e.fixAttempts.length >= 3);
  
  // Generate suggestions based on context
  const suggestions: string[] = [];
  
  if (repeatedErrors.length > 0) {
    suggestions.push('Use Tornado debugging: Research + Logs + Tests to systematically solve this error');
  }
  
  if (tracker.gates.testsPass === false) {
    suggestions.push('Focus on fixing the failing tests before adding new features');
  }
  
  if (tracker.gates.compiles === false) {
    suggestions.push('Get the build passing first - comment out broken code if needed');
  }
  
  // Generic suggestions
  suggestions.push('Take a 15-minute break - fresh eyes help');
  suggestions.push('Simplify: cut scope to minimum viable feature');
  suggestions.push('Ask for help: describe the problem to someone else');
  suggestions.push('Pivot: maybe there\'s a simpler approach you haven\'t considered');
  
  return {
    isStuck: true,
    timeInPhase,
    timeSinceProgress,
    suggestions: suggestions.slice(0, 4),  // Max 4 suggestions
  };
}

/**
 * Format time duration in human-readable form
 */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }
  return `${minutes}m`;
}
