import { z } from 'zod';
import { 
  getPreflightChecks, 
  getPreflightChecksWithAI, 
  getTierSymbol,
  updateCheckStatus,
  type PreflightCheckStatus,
} from '../preflight.js';
import { sanitizePath } from '../security.js';
import { saveToJournal } from './journal.js';

// ============================================================================
// midas_preflight - Get before-you-ship requirements
// ============================================================================

export const preflightCheckSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  useAI: z.boolean().optional().describe('Use AI to filter checks (more accurate but slower)'),
});

export type PreflightCheckInput = z.infer<typeof preflightCheckSchema>;

export interface PreflightCheckToolResult {
  success: boolean;
  profile: {
    collectsUserData: boolean;
    hasPayments: boolean;
    usesAI: boolean;
    targetsEU: boolean;
    businessModel: string;
  };
  summary: {
    total: number;
    critical: number;
    aiAssisted: number;   // AI can help with these
    manual: number;       // Requires real-world action
    pending: number;      // Not yet addressed
    completed: number;    // Marked complete
    skipped: number;      // Skipped by user
  };
  checks: Array<{
    key: string;
    category: string;
    tier: string;         // 'ai_assisted' | 'manual'
    tierSymbol: string;   // 🤖 | 👤
    headline: string;
    explanation: string;
    cursorPrompt: string;
    humanSteps?: string[];
    alsoNeeded?: string[];
    priority: string;
    status: string;       // 'pending' | 'completed' | 'skipped'
    statusUpdatedAt?: string;
    skippedReason?: string;
  }>;
  aiFiltered: boolean;
  message: string;
}

/**
 * Get preflight checks for a project - requirements that should be addressed before shipping.
 * 
 * Uses conservative keyword detection + optional AI filtering for accuracy.
 * 
 * Checks are categorized by what AI can do:
 * - ai_assisted (🤖): AI can help draft or implement
 * - manual (👤): Requires real-world action (signup, purchase, certification)
 */
export async function preflightCheck(input: PreflightCheckInput): Promise<PreflightCheckToolResult> {
  const projectPath = sanitizePath(input.projectPath || process.cwd());
  const useAI = input.useAI ?? true;  // Default to using AI for better accuracy
  
  try {
    // Use AI-filtered version for more accurate results
    const result = useAI 
      ? await getPreflightChecksWithAI(projectPath)
      : { ...getPreflightChecks(projectPath), aiFiltered: false };
    
    const checks = result.checks.map(check => ({
      key: check.key,
      category: check.category,
      tier: check.tier,
      tierSymbol: getTierSymbol(check.tier),
      headline: check.headline,
      explanation: check.explanation,
      cursorPrompt: check.cursorPrompt,
      humanSteps: check.humanSteps,
      alsoNeeded: check.alsoNeeded,
      priority: check.priority,
      status: check.status,
      statusUpdatedAt: check.statusUpdatedAt,
      skippedReason: check.skippedReason,
    }));
    
    const aiNote = result.aiFiltered ? ' (AI-filtered)' : '';
    const message = result.checks.length === 0
      ? 'No preflight checks detected. Add more details to your PRD to get personalized requirements.'
      : `Found ${result.summary.total} requirements${aiNote}: ${result.summary.critical} critical, ${result.summary.aiAssisted} AI-assisted, ${result.summary.manual} manual.`;
    
    return {
      success: true,
      profile: {
        collectsUserData: result.profile.collectsUserData,
        hasPayments: result.profile.hasPayments,
        usesAI: result.profile.usesAI,
        targetsEU: result.profile.targetsEU,
        businessModel: result.profile.businessModel,
      },
      summary: result.summary,
      checks,
      aiFiltered: result.aiFiltered,
      message,
    };
  } catch (error) {
    return {
      success: false,
      profile: {
        collectsUserData: false,
        hasPayments: false,
        usesAI: false,
        targetsEU: false,
        businessModel: 'unknown',
      },
      summary: {
        total: 0,
        critical: 0,
        aiAssisted: 0,
        manual: 0,
        pending: 0,
        completed: 0,
        skipped: 0,
      },
      checks: [],
      aiFiltered: false,
      message: `Failed to check requirements: ${error}`,
    };
  }
}

// ============================================================================
// midas_preflight_update - Update status of a preflight check
// ============================================================================

export const preflightUpdateSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  checkKey: z.string().describe('The key of the check to update (e.g., PRIVACY_POLICY)'),
  status: z.enum(['pending', 'completed', 'skipped']).describe('New status for the check'),
  skippedReason: z.string().optional().describe('Why the check was skipped (optional)'),
});

export type PreflightUpdateInput = z.infer<typeof preflightUpdateSchema>;

export interface PreflightUpdateResult {
  success: boolean;
  checkKey: string;
  status: PreflightCheckStatus;
  message: string;
}

/**
 * Update the status of a preflight check (mark as completed or skipped).
 * Status is persisted between sessions in .midas/preflight-checks.json.
 * Completed checks are logged to journal for audit trail.
 */
export function preflightUpdate(input: PreflightUpdateInput): PreflightUpdateResult {
  const projectPath = sanitizePath(input.projectPath || process.cwd());
  
  try {
    updateCheckStatus(
      projectPath,
      input.checkKey,
      input.status as PreflightCheckStatus,
      input.skippedReason
    );
    
    const statusMessage = input.status === 'completed' 
      ? 'marked as completed'
      : input.status === 'skipped'
        ? `skipped${input.skippedReason ? `: ${input.skippedReason}` : ''}`
        : 'reset to pending';
    
    // Log to journal for audit trail when completed
    if (input.status === 'completed') {
      saveToJournal({
        projectPath,
        title: `Preflight: ${input.checkKey} completed`,
        conversation: `Completed requirement: ${input.checkKey}`,
        tags: ['preflight'],
      });
    }
    
    return {
      success: true,
      checkKey: input.checkKey,
      status: input.status as PreflightCheckStatus,
      message: `Preflight check ${input.checkKey} ${statusMessage}`,
    };
  } catch (error) {
    return {
      success: false,
      checkKey: input.checkKey,
      status: 'pending',
      message: `Failed to update check: ${error}`,
    };
  }
}

// ============================================================================
// BACKWARD COMPATIBILITY ALIASES
// ============================================================================

// Keep old names working for existing code
export const realityCheckSchema = preflightCheckSchema;
export type RealityCheckInput = PreflightCheckInput;
export type RealityCheckToolResult = PreflightCheckToolResult;
export const realityCheck = preflightCheck;

export const realityUpdateSchema = preflightUpdateSchema;
export type RealityUpdateInput = PreflightUpdateInput;
export type RealityUpdateResult = PreflightUpdateResult;
export const realityUpdate = preflightUpdate;
