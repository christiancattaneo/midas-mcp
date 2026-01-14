import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { sanitizePath } from '../security.js';

// ============================================================================
// Document Validation - Quality gates for planning documents
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  score: number;  // 0-100
  missing: string[];
  warnings: string[];
  suggestions: string[];
}

// Required sections for each document type
const BRAINLIFT_SECTIONS = {
  required: [
    { pattern: /what.*building|building|problem/i, name: 'Problem/What you\'re building' },
    { pattern: /who.*for|target|user|audience/i, name: 'Target audience' },
    { pattern: /know.*ai|edge|context|domain/i, name: 'Your unique context/edge' },
  ],
  recommended: [
    { pattern: /constraint|limitation|requirement/i, name: 'Constraints' },
    { pattern: /unknown|research|question/i, name: 'Unknowns to research' },
    { pattern: /prior.*art|existing|alternative/i, name: 'Prior art/alternatives' },
    { pattern: /decision|choice|chose/i, name: 'Key decisions' },
  ],
};

const PRD_SECTIONS = {
  required: [
    { pattern: /goal|objective|purpose/i, name: 'Goals/Objectives' },
    { pattern: /non-goal|out.*scope|won't|will not/i, name: 'Non-goals/Out of scope' },
    { pattern: /user.*stor|requirement|feature/i, name: 'User stories/Requirements' },
  ],
  recommended: [
    { pattern: /success.*metric|kpi|measure/i, name: 'Success metrics' },
    { pattern: /acceptance.*criteria|done.*when/i, name: 'Acceptance criteria' },
    { pattern: /milestone|phase|timeline/i, name: 'Milestones' },
    { pattern: /risk|concern|blocke/i, name: 'Risks' },
  ],
};

const GAMEPLAN_SECTIONS = {
  required: [
    { pattern: /tech.*stack|technolog|framework|language/i, name: 'Tech stack' },
    { pattern: /task|step|phase|order/i, name: 'Ordered tasks' },
  ],
  recommended: [
    { pattern: /depend|prerequisite|require/i, name: 'Dependencies' },
    { pattern: /estimate|time|duration|day|week/i, name: 'Time estimates' },
    { pattern: /risk|mitigation|concern/i, name: 'Risks & mitigations' },
    { pattern: /structure|folder|architect/i, name: 'Project structure' },
  ],
};

function validateDocument(
  content: string,
  sections: { required: { pattern: RegExp; name: string }[]; recommended: { pattern: RegExp; name: string }[] }
): ValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];
  
  // Check required sections
  for (const section of sections.required) {
    if (!section.pattern.test(content)) {
      missing.push(section.name);
    }
  }
  
  // Check recommended sections
  for (const section of sections.recommended) {
    if (!section.pattern.test(content)) {
      warnings.push(`Consider adding: ${section.name}`);
    }
  }
  
  // Check document length (too short = probably incomplete)
  const wordCount = content.split(/\s+/).length;
  if (wordCount < 100) {
    suggestions.push('Document seems short. Consider adding more detail.');
  } else if (wordCount < 300) {
    suggestions.push('Document could be more detailed.');
  }
  
  // Calculate score
  const requiredScore = ((sections.required.length - missing.length) / sections.required.length) * 70;
  const recommendedScore = ((sections.recommended.length - warnings.length) / sections.recommended.length) * 30;
  const score = Math.round(requiredScore + recommendedScore);
  
  return {
    valid: missing.length === 0,
    score,
    missing,
    warnings,
    suggestions,
  };
}

// ============================================================================
// Brainlift Validation
// ============================================================================

export const validateBrainliftSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
});

export type ValidateBrainliftInput = z.infer<typeof validateBrainliftSchema>;

export function validateBrainlift(input: ValidateBrainliftInput): ValidationResult & { exists: boolean } {
  const projectPath = sanitizePath(input.projectPath);
  const brainliftPath = join(projectPath, 'docs', 'brainlift.md');
  
  if (!existsSync(brainliftPath)) {
    return {
      exists: false,
      valid: false,
      score: 0,
      missing: ['Brainlift document does not exist'],
      warnings: [],
      suggestions: ['Create docs/brainlift.md to document your project context'],
    };
  }
  
  const content = readFileSync(brainliftPath, 'utf-8');
  const result = validateDocument(content, BRAINLIFT_SECTIONS);
  
  return {
    exists: true,
    ...result,
  };
}

// ============================================================================
// PRD Validation
// ============================================================================

export const validatePRDSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
});

export type ValidatePRDInput = z.infer<typeof validatePRDSchema>;

export function validatePRD(input: ValidatePRDInput): ValidationResult & { exists: boolean } {
  const projectPath = sanitizePath(input.projectPath);
  const prdPath = join(projectPath, 'docs', 'prd.md');
  
  if (!existsSync(prdPath)) {
    return {
      exists: false,
      valid: false,
      score: 0,
      missing: ['PRD document does not exist'],
      warnings: [],
      suggestions: ['Create docs/prd.md to define requirements'],
    };
  }
  
  const content = readFileSync(prdPath, 'utf-8');
  const result = validateDocument(content, PRD_SECTIONS);
  
  return {
    exists: true,
    ...result,
  };
}

// ============================================================================
// Gameplan Validation
// ============================================================================

export const validateGameplanSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
});

export type ValidateGameplanInput = z.infer<typeof validateGameplanSchema>;

export function validateGameplan(input: ValidateGameplanInput): ValidationResult & { exists: boolean } {
  const projectPath = sanitizePath(input.projectPath);
  const gameplanPath = join(projectPath, 'docs', 'gameplan.md');
  
  if (!existsSync(gameplanPath)) {
    return {
      exists: false,
      valid: false,
      score: 0,
      missing: ['Gameplan document does not exist'],
      warnings: [],
      suggestions: ['Create docs/gameplan.md to plan implementation'],
    };
  }
  
  const content = readFileSync(gameplanPath, 'utf-8');
  const result = validateDocument(content, GAMEPLAN_SECTIONS);
  
  return {
    exists: true,
    ...result,
  };
}

// ============================================================================
// Validate All Planning Docs
// ============================================================================

export const validatePlanningDocsSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
});

export type ValidatePlanningDocsInput = z.infer<typeof validatePlanningDocsSchema>;

export interface PlanningDocsValidation {
  brainlift: ValidationResult & { exists: boolean };
  prd: ValidationResult & { exists: boolean };
  gameplan: ValidationResult & { exists: boolean };
  overallScore: number;
  readyForBuild: boolean;
  blockers: string[];
}

export function validatePlanningDocs(input: ValidatePlanningDocsInput): PlanningDocsValidation {
  const projectPath = sanitizePath(input.projectPath);
  
  const brainlift = validateBrainlift({ projectPath });
  const prd = validatePRD({ projectPath });
  const gameplan = validateGameplan({ projectPath });
  
  // Calculate overall score (weighted: brainlift 40%, PRD 35%, gameplan 25%)
  const overallScore = Math.round(
    (brainlift.score * 0.4) + (prd.score * 0.35) + (gameplan.score * 0.25)
  );
  
  // Collect blockers
  const blockers: string[] = [];
  if (!brainlift.exists) blockers.push('Missing brainlift.md');
  else if (!brainlift.valid) blockers.push(`Brainlift incomplete: ${brainlift.missing.join(', ')}`);
  
  if (!prd.exists) blockers.push('Missing prd.md');
  else if (!prd.valid) blockers.push(`PRD incomplete: ${prd.missing.join(', ')}`);
  
  if (!gameplan.exists) blockers.push('Missing gameplan.md');
  else if (!gameplan.valid) blockers.push(`Gameplan incomplete: ${gameplan.missing.join(', ')}`);
  
  // Ready for BUILD if all docs exist and have required sections
  const readyForBuild = brainlift.valid && prd.valid && gameplan.valid;
  
  return {
    brainlift,
    prd,
    gameplan,
    overallScore,
    readyForBuild,
    blockers,
  };
}
