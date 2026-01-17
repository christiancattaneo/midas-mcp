import { existsSync } from 'fs';
import { join } from 'path';
import { 
  readStateAtomic, 
  writeStateAtomicSync, 
  type VersionedState 
} from '../atomic-state.js';

// Full lifecycle phases
export type PlanStep = 
  | 'IDEA'
  | 'RESEARCH'
  | 'BRAINLIFT'
  | 'PRD'
  | 'GAMEPLAN';

// Backwards compatibility alias
export type EagleSightStep = PlanStep;

export type BuildStep =
  | 'RULES'
  | 'INDEX'
  | 'READ'
  | 'RESEARCH'
  | 'IMPLEMENT'
  | 'TEST'
  | 'DEBUG';

export type ShipStep =
  | 'REVIEW'
  | 'DEPLOY'
  | 'MONITOR';

export type GrowStep = 'DONE';  // Graduation - project shipped, here's what's next

export type Phase =
  | { phase: 'IDLE' }
  | { phase: 'PLAN'; step: PlanStep }
  | { phase: 'BUILD'; step: BuildStep }
  | { phase: 'SHIP'; step: ShipStep }
  | { phase: 'GROW'; step: GrowStep };

// Hotfix mode - for emergency bug fixes without disrupting normal workflow
export interface HotfixState {
  active: boolean;
  description?: string;
  previousPhase?: Phase;  // Phase to return to when hotfix complete
  startedAt?: string;
}

// History entry with unique ID for proper merge handling
export interface HistoryEntry {
  id: string;           // Unique ID for this entry
  phase: Phase;         // The phase that was transitioned from
  timestamp: string;    // When this transition happened
}

export interface PhaseState extends VersionedState {
  current: Phase;
  history: HistoryEntry[];  // Now with unique IDs for merge safety
  startedAt: string;
  docs: {
    brainlift: boolean;
    prd: boolean;
    gameplan: boolean;
  };
  // Hotfix mode - allows quick fixes without disrupting normal phase
  hotfix?: HotfixState;
}

const STATE_DIR = '.midas';
const STATE_FILE = 'state.json';

function getStatePath(projectPath: string): string {
  return join(projectPath, STATE_DIR, STATE_FILE);
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
    // Versioning for atomic state management
    _version: 0,
    _lastModified: new Date().toISOString(),
    _processId: '',
  };
}

/**
 * Load state with atomic read and schema migration
 */
export function loadState(projectPath: string): PhaseState {
  const statePath = getStatePath(projectPath);
  
  const state = readStateAtomic(statePath, getDefaultState);
  
  // Merge with defaults for schema evolution
  const defaults = getDefaultState();
  return {
    ...defaults,
    ...state,
    docs: { ...defaults.docs, ...(state.docs || {}) },
  };
}

/**
 * Save state atomically with conflict detection and array merging.
 * History entries are never lost - they're union-merged on conflict.
 * 
 * IMPORTANT: Version tracking uses the _version field FROM the state object,
 * not a module-level variable, so concurrent operations each track their own
 * read version correctly.
 */
export function saveState(projectPath: string, state: PhaseState): void {
  const statePath = getStatePath(projectPath);
  
  // The expectedVersion is the version from the state we're saving
  // (which was the version when we loaded it)
  const expectedVersion = state._version ?? 0;
  
  // Atomic write with conflict detection
  // Arrays (history) are union-merged to never lose entries
  writeStateAtomicSync(statePath, state, {
    expectedVersion,
    arrayKeys: ['history'],  // History entries are union-merged on conflict
  });
}

// Generate unique ID for history entries
function generateHistoryId(): string {
  return `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a history entry with unique ID.
 * Use this when adding to history to ensure proper merge handling.
 */
export function createHistoryEntry(phase: Phase): HistoryEntry {
  return {
    id: generateHistoryId(),
    phase,
    timestamp: new Date().toISOString(),
  };
}

export function setPhase(projectPath: string, newPhase: Phase): PhaseState {
  const state = loadState(projectPath);
  
  // Create history entry with unique ID (enables proper merge under concurrency)
  state.history.push(createHistoryEntry(state.current));
  state.current = newPhase;
  saveState(projectPath, state);
  return state;
}

// Phase metadata for display and guidance
export const PHASE_INFO = {
  PLAN: {
    name: 'Plan',
    description: 'Plan before you build',
    why: 'Code without context is just syntax. The AI doesn\'t know your domain, constraints, or users. You do.',
    color: 'yellow',
    steps: {
      IDEA: { name: 'Idea', action: 'Define the core idea', prompt: 'What problem? Who for? Why now?', why: 'Most projects fail from solving the wrong problem. 10 min clarifying saves days of building wrong.' },
      RESEARCH: { name: 'Research', action: 'Scan the landscape', prompt: 'What exists? What works? What fails?', why: 'Someone has solved 80% of this. Libraries, patterns, anti-patterns exist. Don\'t reinvent wheels.' },
      BRAINLIFT: { name: 'Brainlift', action: 'Document your edge', prompt: 'What do YOU know that AI doesn\'t?', why: 'AI read the internet. You have specific context it doesn\'t. Capture what makes YOUR project different.' },
      PRD: { name: 'PRD', action: 'Define requirements', prompt: 'Goals, non-goals, user stories, specs', why: '"I\'ll know it when I see it" means you\'ll never finish. A PRD defines the finish line.' },
      GAMEPLAN: { name: 'Gameplan', action: 'Plan the build', prompt: 'Tech stack, phases, tasks, risks', why: 'Some things depend on other things. Sequence work so you\'re never blocked waiting for yourself.' },
    },
  },
  BUILD: {
    name: 'Build',
    description: 'Write code that works',
    why: 'Jumping straight to code means hours of debugging. Each step reduces the blast radius of mistakes.',
    color: 'blue',
    steps: {
      RULES: { name: 'Rules', action: 'Read and understand user rules', prompt: 'Load .cursorrules, understand constraints and patterns', why: 'Every project has conventions. Reading first prevents "works but doesn\'t fit" code.' },
      INDEX: { name: 'Index', action: 'Index the codebase', prompt: 'Understand architecture, folder structure, key files', why: 'You can\'t extend what you don\'t understand. Prevents duplicate implementations.' },
      READ: { name: 'Read', action: 'Read specific files', prompt: 'Read implementation files needed for current task', why: 'Indexing shows structure. Reading shows implementation. Understand before touching.' },
      RESEARCH: { name: 'Research', action: 'Research docs and APIs', prompt: 'Look up documentation, best practices, examples', why: 'The right library can turn 200 lines into 5. Research is cheap; debugging is expensive.' },
      IMPLEMENT: { name: 'Implement', action: 'Write code with tests', prompt: 'Write test first, then implement to make it pass', why: 'Test-first defines "working" before you code. Catches misunderstandings early.' },
      TEST: { name: 'Test', action: 'Run and fix tests', prompt: 'Run all tests, fix failures, add edge cases', why: 'Your change might break something unrelated. Full suite catches regressions before production.' },
      DEBUG: { name: 'Debug', action: 'Debug with Tornado cycle', prompt: 'Research + Logs + Tests to solve issues', why: 'When stuck, random changes make it worse. Tornado systematically narrows possibilities.' },
    },
  },
  SHIP: {
    name: 'Ship',
    description: 'Get it to users',
    why: '"Works on my machine" isn\'t deployment. Production has constraints, users, and consequences dev doesn\'t.',
    color: 'green',
    steps: {
      REVIEW: { name: 'Review', action: 'Code review and audit', prompt: 'Security audit, code review, performance', why: 'Fresh eyes catch what tired eyes miss. Review is cheaper than incident response.' },
      DEPLOY: { name: 'Deploy', action: 'Deploy to production', prompt: 'CI/CD, environment config, rollout', why: 'Manual deployment is error-prone. CI/CD ensures same steps every time, rollback possible.' },
      MONITOR: { name: 'Monitor', action: 'Watch for issues', prompt: 'Logs, alerts, health checks, metrics', why: 'Users don\'t file bug reports. They leave. Know about problems before they complain.' },
    },
  },
  GROW: {
    name: 'Done',
    description: 'You shipped! Now grow your project.',
    why: 'Code is done. Time to get users, feedback, and traction.',
    color: 'magenta',
    steps: {
      DONE: { 
        name: 'Shipped', 
        action: 'Follow the graduation checklist', 
        prompt: 'You built something. Now make people use it.',
        why: 'Most projects die after launch. Growth requires deliberate effort outside the codebase.',
      },
    },
    // The 8-step graduation checklist (external actions, not AI-driven)
    checklist: [
      { key: 'ANNOUNCE', name: 'Announce', action: 'Post to 3 communities', detail: 'Reddit, Discord, Twitter, Hacker News, Product Hunt - wherever your users hang out' },
      { key: 'NETWORK', name: 'Network', action: 'DM 10 people who would find this useful', detail: 'Personal outreach converts 10x better than public posts' },
      { key: 'FEEDBACK', name: 'Feedback', action: 'Ask 5 users: what\'s confusing? what\'s missing?', detail: 'Real users reveal blind spots you can\'t see' },
      { key: 'PROOF', name: 'Proof', action: 'Get 3 testimonials, screenshot your metrics', detail: 'Social proof compounds - collect it early' },
      { key: 'ITERATE', name: 'Iterate', action: 'Ship one improvement based on feedback', detail: 'Show users you listen - fastest way to build loyalty' },
      { key: 'CONTENT', name: 'Content', action: 'Write "what I learned building X" post', detail: 'Teaching builds authority and attracts users who trust you' },
      { key: 'MEASURE', name: 'Measure', action: 'Set up analytics for your key metric', detail: 'Users, downloads, revenue - you can\'t improve what you don\'t measure' },
      { key: 'AUTOMATE', name: 'Automate', action: 'Set up one recurring growth loop', detail: 'Newsletter, social schedule, referral system - consistency compounds' },
    ],
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
    { phase: 'PLAN', step: 'IDEA' },
    { phase: 'PLAN', step: 'RESEARCH' },
    { phase: 'PLAN', step: 'BRAINLIFT' },
    { phase: 'PLAN', step: 'PRD' },
    { phase: 'PLAN', step: 'GAMEPLAN' },
    { phase: 'BUILD', step: 'RULES' },
    { phase: 'BUILD', step: 'INDEX' },
    { phase: 'BUILD', step: 'READ' },
    { phase: 'BUILD', step: 'RESEARCH' },
    { phase: 'BUILD', step: 'IMPLEMENT' },
    { phase: 'BUILD', step: 'TEST' },
    { phase: 'BUILD', step: 'DEBUG' },
    { phase: 'SHIP', step: 'REVIEW' },
    { phase: 'SHIP', step: 'DEPLOY' },
    { phase: 'SHIP', step: 'MONITOR' },
    { phase: 'GROW', step: 'DONE' },  // Single graduation step
  ];

  if (current.phase === 'IDLE') {
    return { phase: 'PLAN', step: 'IDEA' };
  }

  const currentIdx = allSteps.findIndex(
    s => s.phase === current.phase && s.step === ('step' in current ? current.step : '')
  );

  if (currentIdx === -1 || currentIdx >= allSteps.length - 1) {
    // Loop back to Plan for next iteration
    return { phase: 'PLAN', step: 'IDEA' };
  }

  const next = allSteps[currentIdx + 1];
  
  if (next.phase === 'PLAN') return { phase: 'PLAN', step: next.step as PlanStep };
  if (next.phase === 'BUILD') return { phase: 'BUILD', step: next.step as BuildStep };
  if (next.phase === 'SHIP') return { phase: 'SHIP', step: next.step as ShipStep };
  if (next.phase === 'GROW') return { phase: 'GROW', step: next.step as GrowStep };
  
  return { phase: 'IDLE' };
}

export function getPrevPhase(current: Phase): Phase {
  const allSteps: Array<{ phase: Phase['phase']; step: string }> = [
    { phase: 'PLAN', step: 'IDEA' },
    { phase: 'PLAN', step: 'RESEARCH' },
    { phase: 'PLAN', step: 'BRAINLIFT' },
    { phase: 'PLAN', step: 'PRD' },
    { phase: 'PLAN', step: 'GAMEPLAN' },
    { phase: 'BUILD', step: 'RULES' },
    { phase: 'BUILD', step: 'INDEX' },
    { phase: 'BUILD', step: 'READ' },
    { phase: 'BUILD', step: 'RESEARCH' },
    { phase: 'BUILD', step: 'IMPLEMENT' },
    { phase: 'BUILD', step: 'TEST' },
    { phase: 'BUILD', step: 'DEBUG' },
    { phase: 'SHIP', step: 'REVIEW' },
    { phase: 'SHIP', step: 'DEPLOY' },
    { phase: 'SHIP', step: 'MONITOR' },
    { phase: 'GROW', step: 'DONE' },  // Single graduation step
  ];

  if (current.phase === 'IDLE') return { phase: 'IDLE' };

  const currentIdx = allSteps.findIndex(
    s => s.phase === current.phase && s.step === ('step' in current ? current.step : '')
  );

  if (currentIdx <= 0) return current;

  const prev = allSteps[currentIdx - 1];
  
  if (prev.phase === 'PLAN') return { phase: 'PLAN', step: prev.step as PlanStep };
  if (prev.phase === 'BUILD') return { phase: 'BUILD', step: prev.step as BuildStep };
  if (prev.phase === 'SHIP') return { phase: 'SHIP', step: prev.step as ShipStep };
  if (prev.phase === 'GROW') return { phase: 'GROW', step: prev.step as GrowStep };
  
  return current;
}

// Graduation checklist type
export interface GraduationItem {
  key: string;
  name: string;
  action: string;
  detail: string;
}

/**
 * Get the graduation checklist for projects that have shipped
 */
export function getGraduationChecklist(): GraduationItem[] {
  const growInfo = PHASE_INFO.GROW as { checklist?: GraduationItem[] };
  return growInfo.checklist || [];
}

/**
 * Format the graduation checklist as copyable text
 */
export function formatGraduationChecklist(): string {
  const items = getGraduationChecklist();
  const lines = [
    '🎉 YOU SHIPPED! Now grow your project:',
    '',
    ...items.map((item, i) => `${i + 1}. ${item.name.toUpperCase()} - ${item.action}`),
    '',
    'Details:',
    ...items.map(item => `• ${item.name}: ${item.detail}`),
  ];
  return lines.join('\n');
}
