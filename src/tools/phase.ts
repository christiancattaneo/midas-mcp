import { z } from 'zod';
import { 
  loadState, 
  saveState, 
  setPhase, 
  getPhaseGuidance, 
  getDefaultState,
  type Phase,
  type PlanStep,
  type BuildStep,
  type ShipStep,
  type GrowStep,
} from '../state/phase.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { sanitizePath, limitLength, LIMITS, validateEnum } from '../security.js';
import { writeCursorRules, detectTechStack } from '../techstack.js';

// Valid step values for each phase
const PLAN_STEPS = ['IDEA', 'RESEARCH', 'PRD', 'GAMEPLAN'] as const;
const BUILD_STEPS = ['RULES', 'INDEX', 'READ', 'RESEARCH', 'IMPLEMENT', 'TEST', 'DEBUG'] as const;
const SHIP_STEPS = ['REVIEW', 'DEPLOY', 'MONITOR'] as const;
const GROW_STEPS = ['DONE'] as const;  // Single graduation step

// Tool: midas_start_project
export const startProjectSchema = z.object({
  projectName: z.string().max(100).describe('Name of the project'),
  projectPath: z.string().max(LIMITS.PATH_MAX_LENGTH).optional().describe('Path to project root, defaults to cwd'),
  addCursorRules: z.boolean().optional().describe('Generate .cursorrules file based on detected tech stack'),
});

export type StartProjectInput = z.infer<typeof startProjectSchema>;

export function startProject(input: StartProjectInput): {
  success: boolean;
  message: string;
  nextSteps: string[];
} {
  const projectPath = sanitizePath(input.projectPath);
  const projectName = limitLength(input.projectName, 100);
  const docsPath = join(projectPath, 'docs');

  // Create docs folder
  if (!existsSync(docsPath)) {
    mkdirSync(docsPath, { recursive: true });
  }

  // Create PRD template
  const prdContent = `# PRD: ${projectName}

## Overview
[One-paragraph description]

## Goals
1. [Primary goal]
2. [Secondary goal]

## Non-Goals
- [What you're explicitly NOT building]

## User Stories
- As a [user type], I want to [action] so that [benefit]

## Technical Requirements
- [Performance, security, integration requirements]

## Success Metrics
- [How you'll measure success]
`;

  // Create Gameplan template
  const gameplanContent = `# Gameplan: ${projectName}

## Tech Stack
[Stack choice with justification]

## Architecture Overview
[High-level system design]

## Phase 1: Foundation
- [ ] Task 1
- [ ] Task 2

## Phase 2: Core Features
- [ ] Task 1
- [ ] Task 2

## Risk Mitigation
- Risk: [issue] → Mitigation: [solution]
`;

  // Write templates if they don't exist
  const prdPath = join(docsPath, 'prd.md');
  const gameplanPath = join(docsPath, 'gameplan.md');

  if (!existsSync(prdPath)) {
    writeFileSync(prdPath, prdContent);
  }
  if (!existsSync(gameplanPath)) {
    writeFileSync(gameplanPath, gameplanContent);
  }

  // Initialize state
  const state = getDefaultState();
  state.current = { phase: 'PLAN', step: 'IDEA' };
  state.startedAt = new Date().toISOString();
  saveState(projectPath, state);

  // Generate .cursorrules if requested
  const nextSteps = [
    'Define requirements in docs/prd.md',
    'Plan the build in docs/gameplan.md',
    'Use midas_get_phase to see current progress',
  ];
  
  let message = `Project "${projectName}" initialized with planning docs.`;
  
  if (input.addCursorRules) {
    const rulesResult = writeCursorRules(projectPath, projectName);
    if (rulesResult.success) {
      const stack = detectTechStack(projectPath);
      message += ` Generated .cursorrules for ${stack.language}${stack.framework ? `/${stack.framework}` : ''}.`;
    }
  }

  return {
    success: true,
    message,
    nextSteps,
  };
}

// Tool: midas_get_phase
export const getPhaseSchema = z.object({
  projectPath: z.string().max(LIMITS.PATH_MAX_LENGTH).optional().describe('Path to project root'),
});

export type GetPhaseInput = z.infer<typeof getPhaseSchema>;

export function getPhase(input: GetPhaseInput): {
  current: Phase;
  nextSteps: string[];
  prompt?: string;
} {
  const projectPath = sanitizePath(input.projectPath);
  const state = loadState(projectPath);
  const guidance = getPhaseGuidance(state.current);
  
  return {
    current: state.current,
    nextSteps: guidance.nextSteps,
    prompt: guidance.prompt,
  };
}

// Tool: midas_set_phase
export const setPhaseSchema = z.object({
  phase: z.enum(['IDLE', 'PLAN', 'BUILD', 'SHIP', 'GROW']).describe('Target phase'),
  step: z.string().max(20).optional().describe('Step within phase'),
  projectPath: z.string().max(LIMITS.PATH_MAX_LENGTH).optional().describe('Path to project root'),
});

export type SetPhaseInput = z.infer<typeof setPhaseSchema>;

export function setPhaseManually(input: SetPhaseInput): {
  success: boolean;
  current: Phase;
  nextSteps: string[];
  error?: string;
} {
  const projectPath = sanitizePath(input.projectPath);
  
  let newPhase: Phase;
  
  if (input.phase === 'IDLE') {
    newPhase = { phase: 'IDLE' };
  } else if (input.phase === 'PLAN') {
    const step = validateEnum(input.step || 'IDEA', PLAN_STEPS) as PlanStep;
    if (!step) {
      return {
        success: false,
        current: loadState(projectPath).current,
        nextSteps: [],
        error: `Invalid step "${input.step}" for PLAN. Valid: ${PLAN_STEPS.join(', ')}`,
      };
    }
    newPhase = { phase: 'PLAN', step };
  } else if (input.phase === 'BUILD') {
    const step = validateEnum(input.step || 'RULES', BUILD_STEPS) as BuildStep;
    if (!step) {
      return {
        success: false,
        current: loadState(projectPath).current,
        nextSteps: [],
        error: `Invalid step "${input.step}" for BUILD. Valid: ${BUILD_STEPS.join(', ')}`,
      };
    }
    newPhase = { phase: 'BUILD', step };
  } else if (input.phase === 'SHIP') {
    const step = validateEnum(input.step || 'REVIEW', SHIP_STEPS) as ShipStep;
    if (!step) {
      return {
        success: false,
        current: loadState(projectPath).current,
        nextSteps: [],
        error: `Invalid step "${input.step}" for SHIP. Valid: ${SHIP_STEPS.join(', ')}`,
      };
    }
    newPhase = { phase: 'SHIP', step };
  } else if (input.phase === 'GROW') {
    const step = validateEnum(input.step || 'FEEDBACK', GROW_STEPS) as GrowStep;
    if (!step) {
      return {
        success: false,
        current: loadState(projectPath).current,
        nextSteps: [],
        error: `Invalid step "${input.step}" for GROW. Valid: ${GROW_STEPS.join(', ')}`,
      };
    }
    newPhase = { phase: 'GROW', step };
  } else {
    newPhase = { phase: 'IDLE' };
  }
  
  const state = setPhase(projectPath, newPhase);
  const guidance = getPhaseGuidance(state.current);
  
  return {
    success: true,
    current: state.current,
    nextSteps: guidance.nextSteps,
  };
}
