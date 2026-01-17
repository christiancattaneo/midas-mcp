import { z } from 'zod';
import { loadState, saveState, createHistoryEntry, type Phase } from '../state/phase.js';
import { saveToJournal } from './journal.js';
import { sanitizePath } from '../security.js';
import { logEvent } from '../events.js';

// ============================================================================
// Hotfix Mode - Emergency bug fixes without disrupting normal workflow
// ============================================================================

export const startHotfixSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  description: z.string().describe('Brief description of the bug being fixed'),
});

export type StartHotfixInput = z.infer<typeof startHotfixSchema>;

export interface StartHotfixResult {
  success: boolean;
  previousPhase: string;
  message: string;
}

/**
 * Start hotfix mode - saves current phase and jumps to BUILD/DEBUG
 */
export function startHotfix(input: StartHotfixInput): StartHotfixResult {
  const projectPath = sanitizePath(input.projectPath);
  const state = loadState(projectPath);
  
  // Check if already in hotfix mode
  if (state.hotfix?.active) {
    return {
      success: false,
      previousPhase: formatPhase(state.current),
      message: 'Already in hotfix mode. Complete or cancel the current hotfix first.',
    };
  }
  
  // Save current phase and enter hotfix mode
  const previousPhase = state.current;
  state.hotfix = {
    active: true,
    description: input.description,
    previousPhase,
    startedAt: new Date().toISOString(),
  };
  
  // Jump to BUILD/DEBUG step
  state.current = { phase: 'BUILD', step: 'DEBUG' };
  state.history.push(createHistoryEntry(previousPhase));
  saveState(projectPath, state);
  
  // Auto-create minimal journal entry
  saveToJournal({
    projectPath,
    title: `HOTFIX: ${input.description}`,
    conversation: `Starting hotfix for: ${input.description}\n\nPrevious phase: ${formatPhase(previousPhase)}\nJumping to BUILD/DEBUG mode.`,
    tags: ['hotfix', 'bug'],
  });
  
  logEvent(projectPath, {
    type: 'tool_called',
    tool: 'midas_start_hotfix',
    data: { description: input.description, previousPhase: formatPhase(previousPhase) },
  });
  
  return {
    success: true,
    previousPhase: formatPhase(previousPhase),
    message: `Hotfix mode started. Jumped to BUILD/DEBUG. When complete, use midas_complete_hotfix to return to ${formatPhase(previousPhase)}.`,
  };
}

// ============================================================================
// Complete Hotfix - Return to previous phase
// ============================================================================

export const completeHotfixSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  summary: z.string().optional().describe('Brief summary of what was fixed'),
});

export type CompleteHotfixInput = z.infer<typeof completeHotfixSchema>;

export interface CompleteHotfixResult {
  success: boolean;
  returnedTo: string;
  message: string;
}

/**
 * Complete hotfix mode - return to previous phase
 */
export function completeHotfix(input: CompleteHotfixInput): CompleteHotfixResult {
  const projectPath = sanitizePath(input.projectPath);
  const state = loadState(projectPath);
  
  // Check if in hotfix mode
  if (!state.hotfix?.active) {
    return {
      success: false,
      returnedTo: formatPhase(state.current),
      message: 'Not in hotfix mode.',
    };
  }
  
  const hotfixDescription = state.hotfix.description || 'Unknown hotfix';
  const previousPhase = state.hotfix.previousPhase || { phase: 'IDLE' as const };
  
  // Return to previous phase
  state.current = previousPhase;
  state.hotfix = { active: false };
  saveState(projectPath, state);
  
  // Log completion in journal
  saveToJournal({
    projectPath,
    title: `HOTFIX COMPLETE: ${hotfixDescription}`,
    conversation: `Hotfix completed: ${hotfixDescription}\n\nSummary: ${input.summary || 'No summary provided'}\n\nReturning to: ${formatPhase(previousPhase)}`,
    tags: ['hotfix', 'complete'],
  });
  
  logEvent(projectPath, {
    type: 'tool_called',
    tool: 'midas_complete_hotfix',
    data: { summary: input.summary, returnedTo: formatPhase(previousPhase) },
  });
  
  return {
    success: true,
    returnedTo: formatPhase(previousPhase),
    message: `Hotfix complete! Returned to ${formatPhase(previousPhase)}.`,
  };
}

// ============================================================================
// Cancel Hotfix - Abandon hotfix and return to previous phase
// ============================================================================

export const cancelHotfixSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  reason: z.string().optional().describe('Why the hotfix was cancelled'),
});

export type CancelHotfixInput = z.infer<typeof cancelHotfixSchema>;

export function cancelHotfix(input: CancelHotfixInput): CompleteHotfixResult {
  const projectPath = sanitizePath(input.projectPath);
  const state = loadState(projectPath);
  
  if (!state.hotfix?.active) {
    return {
      success: false,
      returnedTo: formatPhase(state.current),
      message: 'Not in hotfix mode.',
    };
  }
  
  const previousPhase = state.hotfix.previousPhase || { phase: 'IDLE' as const };
  
  // Return to previous phase without completion
  state.current = previousPhase;
  state.hotfix = { active: false };
  saveState(projectPath, state);
  
  logEvent(projectPath, {
    type: 'tool_called',
    tool: 'midas_cancel_hotfix',
    data: { reason: input.reason, returnedTo: formatPhase(previousPhase) },
  });
  
  return {
    success: true,
    returnedTo: formatPhase(previousPhase),
    message: `Hotfix cancelled. Returned to ${formatPhase(previousPhase)}.`,
  };
}

// ============================================================================
// Get Hotfix Status
// ============================================================================

export const getHotfixStatusSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
});

export type GetHotfixStatusInput = z.infer<typeof getHotfixStatusSchema>;

export interface HotfixStatus {
  active: boolean;
  description?: string;
  previousPhase?: string;
  duration?: string;
}

export function getHotfixStatus(input: GetHotfixStatusInput): HotfixStatus {
  const projectPath = sanitizePath(input.projectPath);
  const state = loadState(projectPath);
  
  if (!state.hotfix?.active) {
    return { active: false };
  }
  
  // Calculate duration
  let duration: string | undefined;
  if (state.hotfix.startedAt) {
    const started = new Date(state.hotfix.startedAt).getTime();
    const now = Date.now();
    const minutes = Math.floor((now - started) / (1000 * 60));
    if (minutes < 60) {
      duration = `${minutes}m`;
    } else {
      const hours = Math.floor(minutes / 60);
      duration = `${hours}h ${minutes % 60}m`;
    }
  }
  
  return {
    active: true,
    description: state.hotfix.description,
    previousPhase: state.hotfix.previousPhase ? formatPhase(state.hotfix.previousPhase) : undefined,
    duration,
  };
}

// Helper function
function formatPhase(phase: Phase): string {
  if (phase.phase === 'IDLE') return 'IDLE';
  return `${phase.phase}:${(phase as { step: string }).step}`;
}
