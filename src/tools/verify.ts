import { z } from 'zod';
import { 
  runVerificationGates, 
  getGatesStatus, 
  maybeAutoAdvance,
  recordError,
  getSmartPromptSuggestion,
  markAnalysisComplete,
  type VerificationGates,
} from '../tracker.js';
import { sanitizePath } from '../security.js';
import { loadState } from '../state/phase.js';
import { logEvent } from '../events.js';

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
  
  // Determine next step
  let nextStep: string;
  if (status.allPass) {
    if (autoAdvanced) {
      nextStep = `All gates pass! Auto-advanced from ${autoAdvanced.from} to ${autoAdvanced.to}.`;
    } else {
      nextStep = 'All gates pass. Ready to continue or advance phase.';
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
