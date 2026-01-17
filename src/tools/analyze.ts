import { z } from 'zod';
import { analyzeProject, type ProjectAnalysis } from '../analyzer.js';
import { loadState, setPhase, getNextPhase } from '../state/phase.js';
import { getApiKey } from '../config.js';
import { validatePlanningDocs } from './validate-docs.js';

// Tool: midas_analyze - AI-powered project analysis
export const analyzeSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  updatePhase: z.boolean().optional().describe('Whether to update phase state based on analysis'),
});

export type AnalyzeInput = z.infer<typeof analyzeSchema>;

export async function analyze(input: AnalyzeInput): Promise<ProjectAnalysis & { updated: boolean }> {
  const projectPath = input.projectPath || process.cwd();
  
  if (!getApiKey()) {
    return {
      currentPhase: { phase: 'IDLE' },
      summary: 'No API key configured',
      whatsDone: [],
      whatsNext: 'Add ANTHROPIC_API_KEY to ~/.midas/config.json',
      suggestedPrompt: '',
      confidence: 0,
      techStack: [],
      updated: false,
    };
  }

  const analysis = await analyzeProject(projectPath);
  
  let updated = false;
  if (input.updatePhase && analysis.currentPhase.phase !== 'IDLE') {
    setPhase(projectPath, analysis.currentPhase);
    updated = true;
  }

  return { ...analysis, updated };
}

// Tool: midas_suggest_prompt - Get context-aware prompt for current phase
export const suggestPromptSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  context: z.string().optional().describe('Additional context about current task'),
});

export type SuggestPromptInput = z.infer<typeof suggestPromptSchema>;

export interface PromptSuggestion {
  prompt: string;
  phase: string;
  step: string;
  explanation: string;
}

export function suggestPrompt(input: SuggestPromptInput): PromptSuggestion {
  const projectPath = input.projectPath || process.cwd();
  const state = loadState(projectPath);
  const phase = state.current;

  // Phase-specific prompt templates
  const prompts: Record<string, Record<string, { prompt: string; explanation: string }>> = {
    PLAN: {
      IDEA: {
        prompt: 'I want to build [describe your idea]. Help me think through: What problem does this solve? Who is it for? Why now?',
        explanation: 'Start by clearly defining your idea and its value proposition.',
      },
      RESEARCH: {
        prompt: 'Research the landscape for [your idea]. What similar solutions exist? What works about them? What gaps exist?',
        explanation: 'Understand the competitive landscape before building.',
      },
      BRAINLIFT: {
        prompt: 'Help me document my unique insights for this project. I know that [your domain knowledge]. The conventional wisdom says [X] but I believe [Y] because [reason].',
        explanation: 'Capture your contrarian insights that AI cannot know.',
      },
      PRD: {
        prompt: 'Based on our research, help me write a PRD. Goals: [list]. Non-goals: [list]. Key user stories: [list].',
        explanation: 'Define exactly what to build (and what NOT to build).',
      },
      GAMEPLAN: {
        prompt: 'Create a gameplan for building this. Tech stack: [choice]. Break it into phases with specific tasks.',
        explanation: 'Plan the implementation before coding.',
      },
    },
    BUILD: {
      RULES: {
        prompt: 'Read and understand the user rules in .cursorrules. Research each constraint for complete understanding. Ask clarifying questions.',
        explanation: 'Load context and constraints before implementation.',
      },
      INDEX: {
        prompt: 'Index the codebase structure. Understand the architecture, folder organization, and key files.',
        explanation: 'Understand the existing architecture.',
      },
      READ: {
        prompt: 'Read the specific files relevant to [current task]: @file1 @file2. Understand the patterns and implementation details.',
        explanation: 'Load specific implementation context.',
      },
      RESEARCH: {
        prompt: 'Research the documentation for [library/API]. Look up best practices and examples for [specific use case].',
        explanation: 'Gather external knowledge before implementing.',
      },
      IMPLEMENT: {
        prompt: 'Implement [feature]. Write the test file first, then implement to make it pass. Each function should do one thing.',
        explanation: 'Write code with TDD approach.',
      },
      TEST: {
        prompt: 'Run the tests for [feature]. Fix any failures. Add edge case tests for [scenarios].',
        explanation: 'Verify the implementation works correctly.',
      },
      DEBUG: {
        prompt: 'I\'m stuck on [problem]. Let\'s use the Tornado approach: 1) Research the issue, 2) Add strategic logs, 3) Write a test that reproduces it.',
        explanation: 'Use Research + Logs + Tests to solve issues.',
      },
    },
    SHIP: {
      REVIEW: {
        prompt: 'Review the code for security vulnerabilities and performance issues. Check for: SQL injection, XSS, auth bypasses, N+1 queries.',
        explanation: 'Security and performance audit before deployment.',
      },
      DEPLOY: {
        prompt: 'Prepare for deployment. Verify: environment variables set, database migrations ready, CI/CD configured, rollback plan documented.',
        explanation: 'Pre-deployment checklist.',
      },
      MONITOR: {
        prompt: 'Set up monitoring. Configure: error tracking, health checks, alerts, key metrics dashboards.',
        explanation: 'Ensure visibility into production.',
      },
    },
    GROW: {
      DONE: {
        prompt: 'You shipped! Follow the graduation checklist: 1) ANNOUNCE to 3 communities, 2) NETWORK with 10 potential users, 3) FEEDBACK from 5 users, 4) PROOF via testimonials, 5) ITERATE on feedback, 6) CONTENT to build authority, 7) MEASURE your key metric, 8) AUTOMATE a growth loop.',
        explanation: 'Project is shipped. Time to grow usage with deliberate external actions.',
      },
    },
  };

  if (phase.phase === 'IDLE') {
    return {
      prompt: 'I want to start a new project. Use midas_start_project to initialize it with planning docs.',
      phase: 'IDLE',
      step: 'none',
      explanation: 'No project started yet. Initialize with planning docs.',
    };
  }

  const phasePrompts = prompts[phase.phase];
  const stepPrompt = phasePrompts?.[(phase as { step: string }).step];

  if (!stepPrompt) {
    return {
      prompt: 'Continue with the current task.',
      phase: phase.phase,
      step: (phase as { step: string }).step || 'unknown',
      explanation: 'No specific prompt template for this step.',
    };
  }

  let prompt = stepPrompt.prompt;
  if (input.context) {
    prompt = prompt.replace('[current task]', input.context)
      .replace('[describe your idea]', input.context)
      .replace('[your idea]', input.context)
      .replace('[feature]', input.context)
      .replace('[problem]', input.context);
  }

  return {
    prompt,
    phase: phase.phase,
    step: (phase as { step: string }).step,
    explanation: stepPrompt.explanation,
  };
}

// Tool: midas_advance_phase - Advance to the next step
export const advancePhaseSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  force: z.boolean().optional().describe('Force advance even if validation fails'),
});

export type AdvancePhaseInput = z.infer<typeof advancePhaseSchema>;

export interface AdvancePhaseResult {
  previous: { phase: string; step?: string };
  current: { phase: string; step?: string };
  message: string;
  blocked?: boolean;
  blockers?: string[];
}

export function advancePhase(input: AdvancePhaseInput): AdvancePhaseResult {
  const projectPath = input.projectPath || process.cwd();
  const state = loadState(projectPath);
  const previous = state.current;
  const next = getNextPhase(previous);
  
  // Check if advancing from PLAN (Plan) to BUILD - validate planning docs
  if (previous.phase === 'PLAN' && next.phase === 'BUILD' && !input.force) {
    const validation = validatePlanningDocs({ projectPath });
    
    if (!validation.readyForBuild) {
      return {
        previous: {
          phase: previous.phase,
          step: (previous as { step: string }).step,
        },
        current: {
          phase: previous.phase,
          step: (previous as { step: string }).step,
        },
        message: `Cannot advance to BUILD: planning docs incomplete`,
        blocked: true,
        blockers: validation.blockers,
      };
    }
  }
  
  setPhase(projectPath, next);

  const prevStr = previous.phase === 'IDLE' 
    ? 'IDLE' 
    : `${previous.phase}:${(previous as { step: string }).step}`;
  const nextStr = next.phase === 'IDLE'
    ? 'IDLE'
    : `${next.phase}:${(next as { step: string }).step}`;

  return {
    previous: {
      phase: previous.phase,
      step: previous.phase !== 'IDLE' ? (previous as { step: string }).step : undefined,
    },
    current: {
      phase: next.phase,
      step: next.phase !== 'IDLE' ? (next as { step: string }).step : undefined,
    },
    message: `Advanced from ${prevStr} to ${nextStr}`,
  };
}
