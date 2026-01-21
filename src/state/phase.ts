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
 * Validate and sanitize a loaded state object.
 * Handles null values, wrong types, and missing fields.
 */
function sanitizeState(raw: unknown): PhaseState {
  const defaults = getDefaultState();
  
  // If not an object, return defaults
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaults;
  }
  
  const state = raw as Record<string, unknown>;
  
  // Validate current - must be an object with a string phase
  let current = defaults.current;
  if (state.current && typeof state.current === 'object' && !Array.isArray(state.current)) {
    const curr = state.current as Record<string, unknown>;
    if (typeof curr.phase === 'string') {
      current = state.current as typeof defaults.current;
    }
  }
  
  // Validate history - must be an array
  let history = defaults.history;
  if (Array.isArray(state.history)) {
    // Filter out invalid entries and ensure each has required fields
    history = (state.history as unknown[])
      .filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry))
      .map((entry: unknown) => {
        const e = entry as Record<string, unknown>;
        return {
          id: typeof e.id === 'string' ? e.id : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          phase: e.phase && typeof e.phase === 'object' ? e.phase as PhaseState['current'] : { phase: 'IDLE' as const },
          timestamp: typeof e.timestamp === 'string' ? e.timestamp : new Date().toISOString(),
        };
      }) as typeof defaults.history;
  }
  
  // Validate docs - must be an object with boolean values
  let docs = defaults.docs;
  if (state.docs && typeof state.docs === 'object' && !Array.isArray(state.docs)) {
    const d = state.docs as Record<string, unknown>;
    docs = {
      brainlift: typeof d.brainlift === 'boolean' ? d.brainlift : defaults.docs.brainlift,
      prd: typeof d.prd === 'boolean' ? d.prd : defaults.docs.prd,
      gameplan: typeof d.gameplan === 'boolean' ? d.gameplan : defaults.docs.gameplan,
    };
  }
  
  return {
    current,
    history,
    docs,
    startedAt: typeof state.startedAt === 'string' ? state.startedAt : defaults.startedAt,
    _version: typeof state._version === 'number' ? state._version : defaults._version,
    _lastModified: typeof state._lastModified === 'string' ? state._lastModified : defaults._lastModified,
    _processId: typeof state._processId === 'string' ? state._processId : defaults._processId,
    ...(state.hotfix && typeof state.hotfix === 'object' ? { hotfix: state.hotfix as PhaseState['hotfix'] } : {}),
  };
}

/**
 * Load state with atomic read and schema migration
 */
export function loadState(projectPath: string): PhaseState {
  const statePath = getStatePath(projectPath);
  
  const raw = readStateAtomic(statePath, getDefaultState);
  
  // Sanitize and validate the loaded state
  return sanitizeState(raw);
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

// Project-type-specific graduation checklists (max 10 steps each)
type ProjectType = 'cli' | 'library' | 'web-app' | 'api' | 'mobile' | 'monorepo' | 'unknown';

const PROJECT_CHECKLISTS: Record<ProjectType, GraduationItem[]> = {
  'cli': [
    { key: 'NPM', name: 'Publish', action: 'Publish to npm with proper keywords', detail: 'npm publish - make it discoverable with good keywords and description' },
    { key: 'README', name: 'Docs', action: 'Add usage examples and GIFs to README', detail: 'Show, don\'t tell - terminal screenshots/GIFs convert better' },
    { key: 'HOMEBREW', name: 'Homebrew', action: 'Create a Homebrew formula', detail: 'Mac users expect `brew install` - it\'s table stakes for CLI tools' },
    { key: 'ANNOUNCE', name: 'Announce', action: 'Post to r/commandline, HN, dev.to', detail: 'CLI users hang out in tech communities - share your tool' },
    { key: 'COMPARE', name: 'Compare', action: 'Add "vs alternatives" section', detail: 'Why use yours over existing tools? Be honest about tradeoffs' },
    { key: 'ALIAS', name: 'Alias', action: 'Add shell completion and aliases', detail: 'Power users expect tab completion - it\'s a quality signal' },
    { key: 'CHANGELOG', name: 'Changelog', action: 'Start a CHANGELOG.md', detail: 'Users want to know what changed before upgrading' },
    { key: 'SPONSOR', name: 'Sponsor', action: 'Add GitHub Sponsors', detail: 'If people use it daily, some will pay - make it easy' },
  ],
  'library': [
    { key: 'NPM', name: 'Publish', action: 'Publish to npm with types', detail: 'Include TypeScript types - it\'s expected in 2024+' },
    { key: 'DOCS', name: 'Docs', action: 'Generate API docs from JSDoc', detail: 'Use typedoc or similar - auto-generated docs stay current' },
    { key: 'EXAMPLES', name: 'Examples', action: 'Add /examples folder with use cases', detail: 'Real code > documentation - show how to use it' },
    { key: 'BUNDLE', name: 'Bundle', action: 'Check bundle size on bundlephobia', detail: 'Library size matters - document and optimize it' },
    { key: 'COMPARE', name: 'Compare', action: 'Document vs alternatives', detail: 'Why choose this over X? Help users decide quickly' },
    { key: 'BADGES', name: 'Badges', action: 'Add npm version, downloads, tests badges', detail: 'Badges signal quality and maintenance' },
    { key: 'ANNOUNCE', name: 'Announce', action: 'Post to relevant Discord/Slack', detail: 'Find where your target developers hang out' },
    { key: 'CHANGELOG', name: 'Changelog', action: 'Follow semantic versioning', detail: 'Breaking changes need major bumps - respect your users' },
  ],
  'web-app': [
    { key: 'ANALYTICS', name: 'Analytics', action: 'Set up Plausible/Posthog', detail: 'Know your users - privacy-friendly analytics exist' },
    { key: 'SEO', name: 'SEO', action: 'Add meta tags, OG images, sitemap', detail: 'First impressions in search results and shares matter' },
    { key: 'LAUNCH', name: 'Launch', action: 'Post to Product Hunt, IndieHackers', detail: 'Web apps get discovered on product directories' },
    { key: 'FEEDBACK', name: 'Feedback', action: 'Add feedback widget (Canny, email)', detail: 'Make it trivial for users to tell you what\'s broken' },
    { key: 'PERF', name: 'Performance', action: 'Run Lighthouse, fix scores', detail: 'Slow sites lose users - aim for 90+ scores' },
    { key: 'A11Y', name: 'Accessibility', action: 'Run axe, fix critical issues', detail: 'Accessibility is legal requirement in many places' },
    { key: 'SOCIAL', name: 'Social', action: 'Create demo video/screenshots', detail: 'Visual content gets shared - make it easy to share' },
    { key: 'ITERATE', name: 'Iterate', action: 'Ship one user-requested feature', detail: 'Show you listen - fastest way to build loyalty' },
    { key: 'WAITLIST', name: 'Waitlist', action: 'Add email capture for updates', detail: 'Build an audience for future launches' },
    { key: 'PRICING', name: 'Pricing', action: 'Add pricing page (even if free)', detail: 'Clarity on cost/value - even free products need this' },
  ],
  'api': [
    { key: 'DOCS', name: 'API Docs', action: 'Generate OpenAPI/Swagger docs', detail: 'Interactive API docs are expected - use Swagger UI or similar' },
    { key: 'SDK', name: 'SDK', action: 'Create JS/Python client SDK', detail: 'Make integration trivial - SDKs reduce friction' },
    { key: 'AUTH', name: 'Auth', action: 'Document authentication flow', detail: 'Clear auth docs prevent 90% of support questions' },
    { key: 'RATE', name: 'Rate Limits', action: 'Document rate limits clearly', detail: 'Surprise rate limits frustrate developers' },
    { key: 'STATUS', name: 'Status', action: 'Add status page (Betterstack/Upptime)', detail: 'Show uptime history - builds trust with API consumers' },
    { key: 'ERRORS', name: 'Errors', action: 'Document error codes and handling', detail: 'Good error messages save hours of debugging' },
    { key: 'POSTMAN', name: 'Postman', action: 'Create Postman collection', detail: 'Developers expect to test before integrating' },
    { key: 'ANNOUNCE', name: 'Announce', action: 'Post to API directories', detail: 'RapidAPI, ProgrammableWeb, relevant Discords' },
    { key: 'CHANGELOG', name: 'Changelog', action: 'Document breaking changes', detail: 'API consumers need time to migrate - announce early' },
  ],
  'mobile': [
    { key: 'STORE', name: 'App Store', action: 'Submit to App Store/Play Store', detail: 'Follow guidelines carefully - rejections delay launches' },
    { key: 'ASO', name: 'ASO', action: 'Optimize title, keywords, screenshots', detail: 'App Store Optimization is SEO for mobile' },
    { key: 'SCREENS', name: 'Screenshots', action: 'Create compelling store screenshots', detail: 'Screenshots sell apps - invest time in them' },
    { key: 'VIDEO', name: 'Preview', action: 'Add app preview video', detail: 'Motion shows value better than static images' },
    { key: 'REVIEW', name: 'Reviews', action: 'Prompt for reviews at right moment', detail: 'Happy path completion = good time to ask for review' },
    { key: 'CRASH', name: 'Crash', action: 'Set up Sentry/Crashlytics', detail: 'Know when your app crashes before 1-star reviews' },
    { key: 'PUSH', name: 'Push', action: 'Implement push notifications', detail: 'Re-engagement drives retention - use wisely' },
    { key: 'DEEP', name: 'Deep Links', action: 'Add deep linking for sharing', detail: 'Users share content - make links open in-app' },
    { key: 'BETA', name: 'Beta', action: 'Set up TestFlight/Beta testing', detail: 'Get feedback before wide release' },
    { key: 'ITERATE', name: 'Iterate', action: 'Ship update within 2 weeks', detail: 'Active updates signal maintenance - algorithms reward it' },
  ],
  'monorepo': [
    { key: 'DOCS', name: 'Docs', action: 'Document package relationships', detail: 'New contributors need to understand the structure' },
    { key: 'PUBLISH', name: 'Publish', action: 'Set up changesets or lerna publish', detail: 'Coordinated versioning prevents dependency hell' },
    { key: 'CI', name: 'CI', action: 'Set up affected-only CI', detail: 'Only test/build what changed - saves CI minutes' },
    { key: 'CONTRIB', name: 'Contribute', action: 'Write CONTRIBUTING.md', detail: 'Monorepos are complex - help contributors navigate' },
    { key: 'ANNOUNCE', name: 'Announce', action: 'Announce each package separately', detail: 'Each package may have different audiences' },
    { key: 'EXAMPLES', name: 'Examples', action: 'Add example apps using packages', detail: 'Show how packages work together' },
    { key: 'UPGRADE', name: 'Upgrade', action: 'Document upgrade paths', detail: 'Breaking changes across packages need coordination' },
    { key: 'SPONSOR', name: 'Sponsor', action: 'Set up sponsorship', detail: 'Monorepo maintenance is significant - make it sustainable' },
  ],
  'unknown': [
    { key: 'ANNOUNCE', name: 'Announce', action: 'Post to 3 communities', detail: 'Reddit, Discord, Twitter, Hacker News - wherever your users hang out' },
    { key: 'NETWORK', name: 'Network', action: 'DM 10 people who would find this useful', detail: 'Personal outreach converts 10x better than public posts' },
    { key: 'FEEDBACK', name: 'Feedback', action: 'Ask 5 users: what\'s confusing? what\'s missing?', detail: 'Real users reveal blind spots you can\'t see' },
    { key: 'PROOF', name: 'Proof', action: 'Get 3 testimonials, screenshot your metrics', detail: 'Social proof compounds - collect it early' },
    { key: 'ITERATE', name: 'Iterate', action: 'Ship one improvement based on feedback', detail: 'Show users you listen - fastest way to build loyalty' },
    { key: 'CONTENT', name: 'Content', action: 'Write "what I learned building X" post', detail: 'Teaching builds authority and attracts users who trust you' },
    { key: 'MEASURE', name: 'Measure', action: 'Set up analytics for your key metric', detail: 'Users, downloads, revenue - you can\'t improve what you don\'t measure' },
    { key: 'AUTOMATE', name: 'Automate', action: 'Set up one recurring growth loop', detail: 'Newsletter, social schedule, referral system - consistency compounds' },
  ],
};

/**
 * Get the graduation checklist for projects that have shipped.
 * Dynamically selects checklist based on project type.
 * 
 * @param projectType - Detected project type (cli, library, web-app, api, mobile, monorepo)
 */
export function getGraduationChecklist(projectType?: ProjectType): GraduationItem[] {
  const type = projectType || 'unknown';
  return PROJECT_CHECKLISTS[type] || PROJECT_CHECKLISTS['unknown'];
}

/**
 * Format the graduation checklist as copyable text
 */
export function formatGraduationChecklist(projectType?: ProjectType): string {
  const items = getGraduationChecklist(projectType);
  const typeLabel = projectType && projectType !== 'unknown' ? ` (${projectType})` : '';
  const lines = [
    `🎉 YOU SHIPPED${typeLabel}! Now grow your project:`,
    '',
    ...items.map((item, i) => `${i + 1}. ${item.name.toUpperCase()} - ${item.action}`),
    '',
    'Details:',
    ...items.map(item => `• ${item.name}: ${item.detail}`),
  ];
  return lines.join('\n');
}
