import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync, watch } from 'fs';
import { join, relative } from 'path';
import { execSync } from 'child_process';
import { loadState, saveState, getNextPhase, type Phase } from './state/phase.js';
import { sanitizePath, isShellSafe } from './security.js';
import { logger } from './logger.js';

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

export function loadTracker(projectPath: string): TrackerState {
  const safePath = sanitizePath(projectPath);
  const path = getTrackerPath(safePath);
  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      // Merge with defaults to handle schema evolution
      return { ...getDefaultTracker(), ...data };
    } catch (error) {
      logger.error('Failed to parse tracker state', error);
    }
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
    EAGLE_SIGHT: {
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
  
  if (phase.phase === 'EAGLE_SIGHT') {
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

export function maybeAutoAdvance(projectPath: string): { advanced: boolean; from: Phase; to: Phase } {
  const tracker = loadTracker(projectPath);
  const gatesStatus = getGatesStatus(projectPath);
  const state = loadState(projectPath);
  
  const currentPhase = state.current;
  
  // Only auto-advance if all gates pass
  if (!gatesStatus.allPass) {
    return { advanced: false, from: currentPhase, to: currentPhase };
  }
  
  // Only auto-advance from BUILD:IMPLEMENT or BUILD:TEST
  if (currentPhase.phase === 'BUILD') {
    if (currentPhase.step === 'IMPLEMENT' || currentPhase.step === 'TEST') {
      const nextPhase = getNextPhase(currentPhase);
      
      // Update state
      state.history.push(currentPhase);
      state.current = nextPhase;
      saveState(projectPath, state);
      
      // Update tracker
      tracker.inferredPhase = nextPhase;
      saveTracker(projectPath, tracker);
      
      return { advanced: true, from: currentPhase, to: nextPhase };
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
  
  const testPatterns = ['.test.', '.spec.', '__tests__', 'tests/'];
  const files = scanRecentFiles(projectPath, 0);
  signals.testsExist = files.some(f => testPatterns.some(p => f.path.includes(p)));
  
  const docsPath = join(projectPath, 'docs');
  if (existsSync(docsPath)) {
    const brainlift = existsSync(join(docsPath, 'brainlift.md'));
    const prd = existsSync(join(docsPath, 'prd.md'));
    const gameplan = existsSync(join(docsPath, 'gameplan.md'));
    signals.docsComplete = brainlift && prd && gameplan;
  }
  
  return signals;
}

function updatePhaseFromToolCalls(tracker: TrackerState): void {
  const recent = tracker.recentToolCalls.slice(0, 10);
  if (recent.length === 0) return;
  
  const lastTool = recent[0].tool;
  
  const toolPhaseMap: Record<string, Phase> = {
    'midas_start_project': { phase: 'EAGLE_SIGHT', step: 'IDEA' },
    'midas_check_docs': { phase: 'EAGLE_SIGHT', step: 'BRAINLIFT' },
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
    if (!existsSync(join(process.cwd(), 'docs'))) {
      tracker.inferredPhase = { phase: 'IDLE' };
      tracker.confidence = 90;
      return;
    }
    tracker.inferredPhase = { phase: 'EAGLE_SIGHT', step: 'BRAINLIFT' };
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
