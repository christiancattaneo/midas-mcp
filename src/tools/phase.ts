import { z } from 'zod';
import { 
  loadState, 
  saveState, 
  setPhase, 
  getPhaseGuidance, 
  getDefaultState,
  type Phase,
  type EagleSightStep,
  type BuildStep,
  type ShipStep,
  type GrowStep,
} from '../state/phase.js';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// Tool: midas_start_project
export const startProjectSchema = z.object({
  projectName: z.string().describe('Name of the project'),
  projectPath: z.string().optional().describe('Path to project root, defaults to cwd'),
});

export type StartProjectInput = z.infer<typeof startProjectSchema>;

export function startProject(input: StartProjectInput): {
  success: boolean;
  message: string;
  nextSteps: string[];
} {
  const projectPath = input.projectPath || process.cwd();
  const docsPath = join(projectPath, 'docs');

  // Create docs folder
  if (!existsSync(docsPath)) {
    mkdirSync(docsPath, { recursive: true });
  }

  // Create brainlift template
  const brainliftContent = `# Brainlift: ${input.projectName}

## Contrarian Insights
- [What do YOU know that contradicts conventional wisdom?]
- [What have you learned from experience that AI can't know?]

## Domain Knowledge
- [Industry-specific context]
- [User behavior patterns you've observed]

## Hard-Won Lessons
- [What NOT to do based on past experience]
- [Hidden gotchas in this space]

## Current Context
- [Recent market changes]
- [Technology updates post-training-cutoff]
`;

  // Create PRD template
  const prdContent = `# PRD: ${input.projectName}

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
  const gameplanContent = `# Gameplan: ${input.projectName}

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
  const brainliftPath = join(docsPath, 'brainlift.md');
  const prdPath = join(docsPath, 'prd.md');
  const gameplanPath = join(docsPath, 'gameplan.md');

  if (!existsSync(brainliftPath)) {
    writeFileSync(brainliftPath, brainliftContent);
  }
  if (!existsSync(prdPath)) {
    writeFileSync(prdPath, prdContent);
  }
  if (!existsSync(gameplanPath)) {
    writeFileSync(gameplanPath, gameplanContent);
  }

  // Initialize state
  const state = getDefaultState();
  state.current = { phase: 'EAGLE_SIGHT', step: 'IDEA' };
  state.startedAt = new Date().toISOString();
  saveState(projectPath, state);

  return {
    success: true,
    message: `Project "${input.projectName}" initialized with Eagle Sight docs.`,
    nextSteps: [
      'Fill out docs/brainlift.md with your unique insights',
      'Define requirements in docs/prd.md',
      'Plan the build in docs/gameplan.md',
      'Use midas_get_phase to see current progress',
    ],
  };
}

// Tool: midas_get_phase
export const getPhaseSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
});

export type GetPhaseInput = z.infer<typeof getPhaseSchema>;

export function getPhase(input: GetPhaseInput): {
  current: Phase;
  nextSteps: string[];
  prompt?: string;
} {
  const projectPath = input.projectPath || process.cwd();
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
  phase: z.enum(['IDLE', 'EAGLE_SIGHT', 'BUILD', 'SHIP', 'GROW']).describe('Target phase'),
  step: z.string().optional().describe('Step within phase'),
  projectPath: z.string().optional().describe('Path to project root'),
});

export type SetPhaseInput = z.infer<typeof setPhaseSchema>;

export function setPhaseManually(input: SetPhaseInput): {
  success: boolean;
  current: Phase;
  nextSteps: string[];
} {
  const projectPath = input.projectPath || process.cwd();
  
  let newPhase: Phase;
  
  if (input.phase === 'IDLE') {
    newPhase = { phase: 'IDLE' };
  } else if (input.phase === 'EAGLE_SIGHT') {
    const step = (input.step as EagleSightStep) || 'IDEA';
    newPhase = { phase: 'EAGLE_SIGHT', step };
  } else if (input.phase === 'BUILD') {
    const step = (input.step as BuildStep) || 'RULES';
    newPhase = { phase: 'BUILD', step };
  } else if (input.phase === 'SHIP') {
    const step = (input.step as ShipStep) || 'REVIEW';
    newPhase = { phase: 'SHIP', step };
  } else if (input.phase === 'GROW') {
    const step = (input.step as GrowStep) || 'FEEDBACK';
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
