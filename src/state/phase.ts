import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Phase types from SPEC.md
export type EagleSightStep = 
  | 'IDEA'
  | 'RESEARCH'
  | 'BRAINLIFT'
  | 'PRD'
  | 'GAMEPLAN';

export type BuildStep =
  | 'RULES_LOADED'
  | 'CODEBASE_INDEXED'
  | 'FILES_READ'
  | 'RESEARCHING'
  | 'IMPLEMENTING'
  | 'TESTING'
  | 'DEBUGGING';

export type Phase =
  | { phase: 'IDLE' }
  | { phase: 'EAGLE_SIGHT'; step: EagleSightStep }
  | { phase: 'BUILD'; step: BuildStep }
  | { phase: 'SHIPPED' };

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

export function getPhaseGuidance(phase: Phase): { nextSteps: string[]; prompt?: string } {
  if (phase.phase === 'IDLE') {
    return {
      nextSteps: [
        'Start a new project with midas_start_project',
        'Or set phase manually with midas_set_phase',
      ],
      prompt: 'Ready to begin. What are you building?',
    };
  }

  if (phase.phase === 'EAGLE_SIGHT') {
    const stepGuidance: Record<EagleSightStep, { nextSteps: string[]; prompt: string }> = {
      IDEA: {
        nextSteps: ['Define the core idea clearly', 'Move to RESEARCH when ready'],
        prompt: 'What problem does this solve? Who is it for?',
      },
      RESEARCH: {
        nextSteps: ['Scan the landscape', 'Identify existing solutions', 'Move to BRAINLIFT'],
        prompt: 'What already exists? What can you learn from competitors?',
      },
      BRAINLIFT: {
        nextSteps: ['Document your unique insights', 'Add domain knowledge AI lacks', 'Move to PRD'],
        prompt: 'What do YOU know that AI doesn\'t? What are your contrarian insights?',
      },
      PRD: {
        nextSteps: ['Define requirements clearly', 'Include non-goals', 'Move to GAMEPLAN'],
        prompt: 'What exactly are you building? What are you NOT building?',
      },
      GAMEPLAN: {
        nextSteps: ['Define tech stack', 'Break into phases', 'Ready for BUILD phase'],
        prompt: 'How will you build this? What\'s the order of operations?',
      },
    };
    return stepGuidance[phase.step];
  }

  if (phase.phase === 'BUILD') {
    const stepGuidance: Record<BuildStep, { nextSteps: string[]; prompt: string }> = {
      RULES_LOADED: {
        nextSteps: ['Index the codebase structure', 'Move to CODEBASE_INDEXED'],
        prompt: 'Rules loaded. Now index the codebase architecture.',
      },
      CODEBASE_INDEXED: {
        nextSteps: ['Read specific implementation files', 'Move to FILES_READ'],
        prompt: 'Architecture understood. Read the specific files you need.',
      },
      FILES_READ: {
        nextSteps: ['Research documentation if needed', 'Move to RESEARCHING or IMPLEMENTING'],
        prompt: 'Files loaded. Research any APIs or patterns, then implement.',
      },
      RESEARCHING: {
        nextSteps: ['Document findings', 'Move to IMPLEMENTING'],
        prompt: 'Research complete? Time to write code.',
      },
      IMPLEMENTING: {
        nextSteps: ['Write code with tests', 'Move to TESTING'],
        prompt: 'Write code. Include tests. Run them.',
      },
      TESTING: {
        nextSteps: ['Run all tests', 'Fix failures', 'Move to DEBUGGING if issues'],
        prompt: 'Run tests. All passing? Ship it. Failures? Debug.',
      },
      DEBUGGING: {
        nextSteps: ['Use Tornado cycle', 'Add logs', 'Research', 'Back to TESTING'],
        prompt: 'Stuck? Spin the Tornado: Research + Logs + Tests.',
      },
    };
    return stepGuidance[phase.step];
  }

  // SHIPPED
  return {
    nextSteps: ['Project shipped!', 'Run midas_audit for production readiness check'],
    prompt: 'Shipped. Run an audit to verify production readiness.',
  };
}
