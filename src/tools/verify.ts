import { z } from 'zod';
import { 
  runVerificationGates, 
  getGatesStatus, 
  maybeAutoAdvance,
  recordError,
  getSmartPromptSuggestion,
  markAnalysisComplete,
  checkIfStuck,
  formatDuration,
  loadTracker,
  type VerificationGates,
} from '../tracker.js';
import { sanitizePath } from '../security.js';
import { loadState } from '../state/phase.js';
import { logEvent } from '../events.js';
import { getRealityChecks } from '../reality.js';

// ============================================================================
// midas_verify - Run verification gates (build, test, lint)
// ============================================================================

export const verifySchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  runBuild: z.boolean().optional().describe('Run build/compile (default: true)'),
  runTests: z.boolean().optional().describe('Run tests (default: true)'),
  runLint: z.boolean().optional().describe('Run linter (default: true)'),
});

export type VerifyInput = z.infer<typeof verifySchema>;

export interface VerifyResult {
  gates: VerificationGates;
  allPass: boolean;
  failing: string[];
  nextStep: string;
  autoAdvanced?: {
    from: string;
    to: string;
  };
  // Reality check status for SHIP phase
  realityCheck?: {
    total: number;
    pending: number;
    critical: number;
    warning?: string;
  };
}

export function verify(input: VerifyInput): VerifyResult {
  const projectPath = sanitizePath(input.projectPath);
  
  // Run all gates
  const gates = runVerificationGates(projectPath);
  const status = getGatesStatus(projectPath);
  
  // Log event for TUI sync
  logEvent(projectPath, {
    type: 'tool_called',
    tool: 'midas_verify',
    data: { allPass: status.allPass, failing: status.failing },
  });
  
  // Record any errors to error memory
  if (gates.compileError) {
    recordError(projectPath, gates.compileError, undefined, undefined);
  }
  if (gates.testError) {
    recordError(projectPath, gates.testError, undefined, undefined);
  }
  
  // Maybe auto-advance if all gates pass
  let autoAdvanced: VerifyResult['autoAdvanced'];
  if (status.allPass) {
    const advance = maybeAutoAdvance(projectPath);
    if (advance.advanced) {
      autoAdvanced = {
        from: `${advance.from.phase}:${'step' in advance.from ? advance.from.step : ''}`,
        to: `${advance.to.phase}:${'step' in advance.to ? advance.to.step : ''}`,
      };
    }
  }
  
  // Check reality checks if in SHIP phase
  const state = loadState(projectPath);
  let realityCheck: VerifyResult['realityCheck'];
  
  if (state.current.phase === 'SHIP') {
    const rc = getRealityChecks(projectPath);
    const pendingCritical = rc.checks.filter(c => c.priority === 'critical' && c.status === 'pending').length;
    
    realityCheck = {
      total: rc.summary.total,
      pending: rc.summary.pending,
      critical: pendingCritical,
    };
    
    if (pendingCritical > 0) {
      realityCheck.warning = `${pendingCritical} critical requirements not addressed. Press [y] in TUI or run midas_reality_check to review.`;
    }
  }
  
  // Determine next step
  let nextStep: string;
  if (status.allPass) {
    if (autoAdvanced) {
      nextStep = `All gates pass! Auto-advanced from ${autoAdvanced.from} to ${autoAdvanced.to}.`;
    } else {
      nextStep = 'All gates pass. Ready to continue or advance phase.';
    }
    
    // Add reality check warning if applicable
    if (realityCheck?.warning) {
      nextStep += `\n\n⚠️ ${realityCheck.warning}`;
    }
  } else {
    nextStep = `Fix: ${status.failing.join(', ')}`;
    if (gates.compileError) {
      nextStep += `\n\nBuild error:\n${gates.compileError.slice(0, 300)}`;
    }
    if (gates.testError) {
      nextStep += `\n\nTest error:\n${gates.testError.slice(0, 300)}`;
    }
  }
  
  return {
    gates,
    allPass: status.allPass,
    failing: status.failing,
    nextStep,
    autoAdvanced,
    realityCheck,
  };
}

// ============================================================================
// midas_smart_suggest - Get intelligent next prompt suggestion
// ============================================================================

export const smartSuggestSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
});

export type SmartSuggestInput = z.infer<typeof smartSuggestSchema>;

export interface SmartSuggestResult {
  prompt: string;
  reason: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  context?: string;
  phase: string;
  step?: string;
}

export function smartSuggest(input: SmartSuggestInput): SmartSuggestResult {
  const projectPath = sanitizePath(input.projectPath);
  
  const suggestion = getSmartPromptSuggestion(projectPath);
  const state = loadState(projectPath);
  
  // Mark that we've done an analysis
  markAnalysisComplete(projectPath);
  
  return {
    ...suggestion,
    phase: state.current.phase,
    step: 'step' in state.current ? state.current.step : undefined,
  };
}

// ============================================================================
// midas_set_task - Set current task focus
// ============================================================================

import { setTaskFocus, updateTaskPhase, clearTaskFocus, type TaskFocus } from '../tracker.js';

export const setTaskSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  description: z.string().describe('What you are working on'),
  relatedFiles: z.array(z.string()).optional().describe('Files related to this task'),
});

export type SetTaskInput = z.infer<typeof setTaskSchema>;

export function setTask(input: SetTaskInput): TaskFocus {
  const projectPath = sanitizePath(input.projectPath);
  return setTaskFocus(projectPath, input.description, input.relatedFiles);
}

export const updateTaskSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  phase: z.enum(['plan', 'implement', 'verify', 'reflect']).describe('Current phase of the task'),
});

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export function updateTask(input: UpdateTaskInput): { success: boolean } {
  const projectPath = sanitizePath(input.projectPath);
  updateTaskPhase(projectPath, input.phase);
  return { success: true };
}

export const clearTaskSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
});

export type ClearTaskInput = z.infer<typeof clearTaskSchema>;

export function clearTask(input: ClearTaskInput): { success: boolean } {
  const projectPath = sanitizePath(input.projectPath);
  clearTaskFocus(projectPath);
  return { success: true };
}

// ============================================================================
// midas_record_error - Record an error for tracking
// ============================================================================

import { recordFixAttempt, getStuckErrors, type ErrorMemory } from '../tracker.js';

export const recordErrorSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  error: z.string().describe('The error message'),
  file: z.string().optional().describe('File where error occurred'),
  line: z.number().optional().describe('Line number'),
});

export type RecordErrorInput = z.infer<typeof recordErrorSchema>;

export function recordErrorTool(input: RecordErrorInput): ErrorMemory {
  const projectPath = sanitizePath(input.projectPath);
  return recordError(projectPath, input.error, input.file, input.line);
}

export const recordFixSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  errorId: z.string().describe('ID of the error'),
  approach: z.string().describe('What fix was attempted'),
  worked: z.boolean().describe('Did the fix work?'),
});

export type RecordFixInput = z.infer<typeof recordFixSchema>;

export function recordFix(input: RecordFixInput): { success: boolean } {
  const projectPath = sanitizePath(input.projectPath);
  recordFixAttempt(projectPath, input.errorId, input.approach, input.worked);
  return { success: true };
}

export const getStuckSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
});

export type GetStuckInput = z.infer<typeof getStuckSchema>;

export function getStuck(input: GetStuckInput): ErrorMemory[] {
  const projectPath = sanitizePath(input.projectPath);
  return getStuckErrors(projectPath);
}

// ============================================================================
// midas_unstuck - Intervention options when stuck
// ============================================================================

export const unstuckSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  action: z.enum(['diagnose', 'simplify', 'pivot', 'break']).optional().describe(
    'Action to take: diagnose (analyze what\'s blocking), simplify (cut scope), pivot (try different approach), break (take a break)'
  ),
});

export type UnstuckInput = z.infer<typeof unstuckSchema>;

export interface UnstuckResult {
  isStuck: boolean;
  timeInPhase: string;
  timeSinceProgress: string;
  unresolvedErrors: number;
  failingGates: string[];
  action: string;
  guidance: string;
  suggestedPrompt: string;
}

export function unstuck(input: UnstuckInput): UnstuckResult {
  const projectPath = sanitizePath(input.projectPath);
  const action = input.action || 'diagnose';
  
  const stuckInfo = checkIfStuck(projectPath);
  const tracker = loadTracker(projectPath);
  const gates = getGatesStatus(projectPath);
  
  const isStuck = stuckInfo?.isStuck ?? false;
  const timeInPhase = formatDuration(stuckInfo?.timeInPhase ?? 0);
  const timeSinceProgress = formatDuration(stuckInfo?.timeSinceProgress ?? 0);
  const unresolvedErrors = tracker.errorMemory?.filter((e: ErrorMemory) => !e.resolved).length ?? 0;
  const failingGates = gates.failing;
  
  // Generate guidance based on action
  let guidance = '';
  let suggestedPrompt = '';
  
  switch (action) {
    case 'diagnose':
      guidance = 'Let\'s understand what\'s blocking you. Check the error memory and failing gates.';
      if (failingGates.length > 0) {
        suggestedPrompt = `Focus on fixing the failing ${failingGates[0]} gate first. Show me the specific error and let's work through it systematically.`;
      } else if (unresolvedErrors > 0) {
        suggestedPrompt = `I've had ${unresolvedErrors} unresolved errors. Let's use the Tornado approach: Research + Logs + Tests to solve the most recent one.`;
      } else {
        suggestedPrompt = 'I feel stuck but no specific errors. Let me describe what I\'m trying to do and what\'s not working...';
      }
      break;
      
    case 'simplify':
      guidance = 'Cut scope to the minimum viable feature. Ship something small that works.';
      suggestedPrompt = 'Let\'s simplify. What\'s the absolute minimum version of this feature that would still be useful? Help me identify what I can defer to v2.';
      break;
      
    case 'pivot':
      guidance = 'Maybe the current approach isn\'t working. Consider a completely different solution.';
      suggestedPrompt = 'I\'ve been stuck on this approach. What are 3 completely different ways to solve this problem? Let\'s evaluate the tradeoffs.';
      break;
      
    case 'break':
      guidance = 'Step away from the keyboard. Fresh eyes often see solutions immediately.';
      suggestedPrompt = 'I\'m going to take a 15-minute break. Before I go, write a summary of where I am so I can pick up easily when I return.';
      break;
  }
  
  // Log event
  logEvent(projectPath, {
    type: 'tool_called',
    tool: 'midas_unstuck',
    data: { action, isStuck },
  });
  
  return {
    isStuck,
    timeInPhase,
    timeSinceProgress,
    unresolvedErrors,
    failingGates,
    action,
    guidance,
    suggestedPrompt,
  };
}
