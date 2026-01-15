import { z } from 'zod';
import { getRealityChecks, getRealityChecksWithAI, getTierSymbol } from '../reality.js';
import { sanitizePath } from '../security.js';

// ============================================================================
// midas_reality_check - Get before-you-ship requirements
// ============================================================================

export const realityCheckSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  useAI: z.boolean().optional().describe('Use AI to filter checks (more accurate but slower)'),
});

export type RealityCheckInput = z.infer<typeof realityCheckSchema>;

export interface RealityCheckToolResult {
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
    generatable: number;  // AI can draft
    assistable: number;   // AI can help, needs review
    humanOnly: number;    // Requires real-world action
  };
  checks: Array<{
    key: string;
    category: string;
    tier: string;         // 'generatable' | 'assistable' | 'human_only'
    tierSymbol: string;   // ✅ | ⚠️ | 🔴
    headline: string;
    explanation: string;
    cursorPrompt: string;
    humanSteps?: string[];
    alsoNeeded?: string[];
    priority: string;
  }>;
  aiFiltered: boolean;
  message: string;
}

/**
 * Get reality checks for a project - requirements that should be addressed before shipping.
 * 
 * Uses conservative keyword detection + optional AI filtering for accuracy.
 * 
 * Checks are categorized by what AI can do:
 * - generatable (✅): AI can draft the document, just needs human review
 * - assistable (⚠️): AI can create a guide/checklist, needs professional verification  
 * - human_only (🔴): Requires real-world action (signup, purchase, certification)
 */
export async function realityCheck(input: RealityCheckInput): Promise<RealityCheckToolResult> {
  const projectPath = sanitizePath(input.projectPath || process.cwd());
  const useAI = input.useAI ?? true;  // Default to using AI for better accuracy
  
  try {
    // Use AI-filtered version for more accurate results
    const result = useAI 
      ? await getRealityChecksWithAI(projectPath)
      : { ...getRealityChecks(projectPath), aiFiltered: false };
    
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
    }));
    
    const aiNote = result.aiFiltered ? ' (AI-filtered)' : '';
    const message = result.checks.length === 0
      ? 'No reality checks detected. Add more details to your brainlift/PRD to get personalized requirements.'
      : `Found ${result.summary.total} requirements${aiNote}: ${result.summary.critical} critical, ${result.summary.generatable} AI-draftable, ${result.summary.assistable} need review, ${result.summary.humanOnly} manual.`;
    
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
        generatable: 0,
        assistable: 0,
        humanOnly: 0,
      },
      checks: [],
      aiFiltered: false,
      message: `Failed to check requirements: ${error}`,
    };
  }
}
