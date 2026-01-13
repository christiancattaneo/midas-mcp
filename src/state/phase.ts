import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Full lifecycle phases
export type EagleSightStep = 
  | 'IDEA'
  | 'RESEARCH'
  | 'BRAINLIFT'
  | 'PRD'
  | 'GAMEPLAN';

export type BuildStep =
  | 'SCAFFOLD'
  | 'IMPLEMENT'
  | 'TEST'
  | 'POLISH';

export type ShipStep =
  | 'REVIEW'
  | 'DEPLOY'
  | 'MONITOR';

export type GrowStep =
  | 'FEEDBACK'
  | 'ANALYZE'
  | 'ITERATE';

export type Phase =
  | { phase: 'IDLE' }
  | { phase: 'EAGLE_SIGHT'; step: EagleSightStep }
  | { phase: 'BUILD'; step: BuildStep }
  | { phase: 'SHIP'; step: ShipStep }
  | { phase: 'GROW'; step: GrowStep };

export interface PhaseState {
  current: Phase;
  history: Phase[];
  startedAt: string;
  docs: {
    brainlift: boolean;
    prd: boolean;
    gameplan: boolean;
  };
}

const STATE_DIR = '.midas';
const STATE_FILE = 'state.json';

function getStatePath(projectPath: string): string {
  return join(projectPath, STATE_DIR, STATE_FILE);
}

function ensureStateDir(projectPath: string): void {
  const dir = join(projectPath, STATE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function getDefaultState(): PhaseState {
  return {
    current: { phase: 'IDLE' },
    history: [],
    startedAt: new Date().toISOString(),
    docs: {
      brainlift: false,
      prd: false,
      gameplan: false,
    },
  };
}

export function loadState(projectPath: string): PhaseState {
  const statePath = getStatePath(projectPath);
  if (!existsSync(statePath)) {
    return getDefaultState();
  }
  try {
    const raw = readFileSync(statePath, 'utf-8');
    return JSON.parse(raw) as PhaseState;
  } catch {
    return getDefaultState();
  }
}

export function saveState(projectPath: string, state: PhaseState): void {
  ensureStateDir(projectPath);
  const statePath = getStatePath(projectPath);
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

export function setPhase(projectPath: string, newPhase: Phase): PhaseState {
  const state = loadState(projectPath);
  state.history.push(state.current);
  state.current = newPhase;
  saveState(projectPath, state);
  return state;
}

// Phase metadata for display and guidance
export const PHASE_INFO = {
  EAGLE_SIGHT: {
    name: 'Eagle Sight',
    description: 'Plan before you build',
    color: 'yellow',
    steps: {
      IDEA: { name: 'Idea', action: 'Define the core idea', prompt: 'What problem? Who for? Why now?' },
      RESEARCH: { name: 'Research', action: 'Scan the landscape', prompt: 'What exists? What works? What fails?' },
      BRAINLIFT: { name: 'Brainlift', action: 'Document your edge', prompt: 'What do YOU know that AI doesn\'t?' },
      PRD: { name: 'PRD', action: 'Define requirements', prompt: 'Goals, non-goals, user stories, specs' },
      GAMEPLAN: { name: 'Gameplan', action: 'Plan the build', prompt: 'Tech stack, phases, tasks, risks' },
    },
  },
  BUILD: {
    name: 'Build',
    description: 'Write code that works',
    color: 'blue',
    steps: {
      SCAFFOLD: { name: 'Scaffold', action: 'Set up project structure', prompt: 'Create folders, configs, dependencies' },
      IMPLEMENT: { name: 'Implement', action: 'Write core features', prompt: 'Build the main functionality' },
      TEST: { name: 'Test', action: 'Write and run tests', prompt: 'Unit tests, integration tests, E2E' },
      POLISH: { name: 'Polish', action: 'Fix bugs, refine UX', prompt: 'Edge cases, error handling, UX polish' },
    },
  },
  SHIP: {
    name: 'Ship',
    description: 'Get it to users',
    color: 'green',
    steps: {
      REVIEW: { name: 'Review', action: 'Code review and audit', prompt: 'Security audit, code review, performance' },
      DEPLOY: { name: 'Deploy', action: 'Deploy to production', prompt: 'CI/CD, environment config, rollout' },
      MONITOR: { name: 'Monitor', action: 'Watch for issues', prompt: 'Logs, alerts, health checks, metrics' },
    },
  },
  GROW: {
    name: 'Grow',
    description: 'Learn and iterate',
    color: 'magenta',
    steps: {
      FEEDBACK: { name: 'Feedback', action: 'Collect user feedback', prompt: 'User interviews, support tickets, reviews' },
      ANALYZE: { name: 'Analyze', action: 'Study the data', prompt: 'Metrics, behavior patterns, retention' },
      ITERATE: { name: 'Iterate', action: 'Plan next cycle', prompt: 'Prioritize, plan, return to Eagle Sight' },
    },
  },
};

export function getPhaseGuidance(phase: Phase): { nextSteps: string[]; prompt?: string } {
  if (phase.phase === 'IDLE') {
    return {
      nextSteps: ['Start with midas_start_project or midas_set_phase'],
      prompt: 'Ready to begin. What are you building?',
    };
  }

  const phaseInfo = PHASE_INFO[phase.phase];
  if (!phaseInfo) {
    return { nextSteps: ['Unknown phase'], prompt: 'Continue' };
  }

  const stepInfo = (phaseInfo.steps as Record<string, { name: string; action: string; prompt: string }>)[phase.step];
  if (!stepInfo) {
    return { nextSteps: ['Unknown step'], prompt: 'Continue' };
  }

  return {
    nextSteps: [stepInfo.action],
    prompt: stepInfo.prompt,
  };
}

export function getNextPhase(current: Phase): Phase {
  const allSteps: Array<{ phase: Phase['phase']; step: string }> = [
    { phase: 'EAGLE_SIGHT', step: 'IDEA' },
    { phase: 'EAGLE_SIGHT', step: 'RESEARCH' },
    { phase: 'EAGLE_SIGHT', step: 'BRAINLIFT' },
    { phase: 'EAGLE_SIGHT', step: 'PRD' },
    { phase: 'EAGLE_SIGHT', step: 'GAMEPLAN' },
    { phase: 'BUILD', step: 'SCAFFOLD' },
    { phase: 'BUILD', step: 'IMPLEMENT' },
    { phase: 'BUILD', step: 'TEST' },
    { phase: 'BUILD', step: 'POLISH' },
    { phase: 'SHIP', step: 'REVIEW' },
    { phase: 'SHIP', step: 'DEPLOY' },
    { phase: 'SHIP', step: 'MONITOR' },
    { phase: 'GROW', step: 'FEEDBACK' },
    { phase: 'GROW', step: 'ANALYZE' },
    { phase: 'GROW', step: 'ITERATE' },
  ];

  if (current.phase === 'IDLE') {
    return { phase: 'EAGLE_SIGHT', step: 'IDEA' };
  }

  const currentIdx = allSteps.findIndex(
    s => s.phase === current.phase && s.step === ('step' in current ? current.step : '')
  );

  if (currentIdx === -1 || currentIdx >= allSteps.length - 1) {
    // Loop back to Eagle Sight for next iteration
    return { phase: 'EAGLE_SIGHT', step: 'IDEA' };
  }

  const next = allSteps[currentIdx + 1];
  
  if (next.phase === 'EAGLE_SIGHT') return { phase: 'EAGLE_SIGHT', step: next.step as EagleSightStep };
  if (next.phase === 'BUILD') return { phase: 'BUILD', step: next.step as BuildStep };
  if (next.phase === 'SHIP') return { phase: 'SHIP', step: next.step as ShipStep };
  if (next.phase === 'GROW') return { phase: 'GROW', step: next.step as GrowStep };
  
  return { phase: 'IDLE' };
}

export function getPrevPhase(current: Phase): Phase {
  const allSteps: Array<{ phase: Phase['phase']; step: string }> = [
    { phase: 'EAGLE_SIGHT', step: 'IDEA' },
    { phase: 'EAGLE_SIGHT', step: 'RESEARCH' },
    { phase: 'EAGLE_SIGHT', step: 'BRAINLIFT' },
    { phase: 'EAGLE_SIGHT', step: 'PRD' },
    { phase: 'EAGLE_SIGHT', step: 'GAMEPLAN' },
    { phase: 'BUILD', step: 'SCAFFOLD' },
    { phase: 'BUILD', step: 'IMPLEMENT' },
    { phase: 'BUILD', step: 'TEST' },
    { phase: 'BUILD', step: 'POLISH' },
    { phase: 'SHIP', step: 'REVIEW' },
    { phase: 'SHIP', step: 'DEPLOY' },
    { phase: 'SHIP', step: 'MONITOR' },
    { phase: 'GROW', step: 'FEEDBACK' },
    { phase: 'GROW', step: 'ANALYZE' },
    { phase: 'GROW', step: 'ITERATE' },
  ];

  if (current.phase === 'IDLE') return { phase: 'IDLE' };

  const currentIdx = allSteps.findIndex(
    s => s.phase === current.phase && s.step === ('step' in current ? current.step : '')
  );

  if (currentIdx <= 0) return current;

  const prev = allSteps[currentIdx - 1];
  
  if (prev.phase === 'EAGLE_SIGHT') return { phase: 'EAGLE_SIGHT', step: prev.step as EagleSightStep };
  if (prev.phase === 'BUILD') return { phase: 'BUILD', step: prev.step as BuildStep };
  if (prev.phase === 'SHIP') return { phase: 'SHIP', step: prev.step as ShipStep };
  if (prev.phase === 'GROW') return { phase: 'GROW', step: prev.step as GrowStep };
  
  return current;
}
