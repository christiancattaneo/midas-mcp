import { getApiKey, getActiveProvider, getSkillLevel, type SkillLevel } from './config.js';
import { chat, chatStream, getProviderCapabilities, getCurrentModel, type StreamProgress } from './providers.js';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import type { Phase, PlanStep, BuildStep, ShipStep, GrowStep } from './state/phase.js';
import { loadState } from './state/phase.js';
import { updateTracker, getActivitySummary, loadTracker, getGatesStatus, getUnresolvedErrors, markAnalysisComplete, maybeAutoAdvance } from './tracker.js';
import { getJournalEntries } from './tools/journal.js';
import { sanitizePath, limitLength, LIMITS } from './security.js';
import { logger } from './logger.js';
import { estimateTokens } from './context.js';
import { isCursorAvailable, getRecentMessages, getCursorInfo } from './cursor.js';
import { discoverDocsSync } from './docs-discovery.js';
import { discoverAndReadCode, type CodeContext } from './code-discovery.js';

// ============================================================================
// SKILL LEVEL ADAPTERS
// ============================================================================

/**
 * Get skill-specific prompt suffix based on user level
 */
function getSkillPromptSuffix(skillLevel: SkillLevel): string {
  switch (skillLevel) {
    case 'beginner':
      return `

## SKILL LEVEL: BEGINNER
When generating suggestedPrompt:
- Be VERBOSE - explain what to do AND why
- Include command examples with explanations
- Break complex tasks into smaller steps
- Add context about what files/tools will be used
- Explain any jargon or technical terms
Example format: "Create a test file for the auth module. Tests go in src/tests/. Use 'describe' blocks to group related tests. Start with a simple test that checks if the module exports correctly."`;
    
    case 'advanced':
      return `

## SKILL LEVEL: ADVANCED
When generating suggestedPrompt:
- Be TERSE - assume deep technical knowledge
- Skip obvious steps (setup, imports, boilerplate)
- Focus on edge cases and optimization
- Reference patterns by name without explanation
- Use technical shorthand
Example format: "Add property-based tests for auth edge cases. Cover: token expiry, concurrent sessions, CSRF vectors."`;
    
    case 'intermediate':
    default:
      return `

## SKILL LEVEL: INTERMEDIATE
When generating suggestedPrompt:
- Balance detail with conciseness
- Include key steps but skip obvious ones
- Mention tools/patterns by name
- Focus on the "what" and "how" - assume basic "why" is understood
Example format: "Write integration tests for the API endpoints. Cover happy path, validation errors, and auth failures."`;
  }
}

// ============================================================================
// AI PROVIDER ABSTRACTION
// ============================================================================

/**
 * Call the configured AI provider
 * 
 * Supports: Anthropic Claude, OpenAI GPT-4o, Google Gemini, xAI Grok
 * 
 * Provider-specific features:
 * - Anthropic: Extended thinking, prompt caching (90% savings)
 * - OpenAI: Standard chat completions
 * - Google: 1M token context
 * - xAI: OpenAI-compatible format
 */
async function callAI(
  prompt: string, 
  systemPrompt: string, 
  options: { maxTokens?: number; useThinking?: boolean } = {}
): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No API key configured');

  const provider = getActiveProvider();
  const capabilities = getProviderCapabilities(provider);
  const maxTokens = options.maxTokens ?? 16000;
  
  // Use extended thinking only if provider supports it
  const useThinking = (options.useThinking ?? true) && capabilities.thinking;

  logger.debug('AI call', { 
    provider,
    model: getCurrentModel(),
    thinking: useThinking,
  });

  const response = await chat(prompt, {
    systemPrompt,
    maxTokens,
    useThinking,
    timeout: 60000,
  });
  
  // Log usage for monitoring
  logger.debug('AI response', {
    provider: response.provider,
    model: response.model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    cached: response.cached,
  });
  
  return response.content;
}

/**
 * Scan ALL project files to understand full structure.
 * No artificial limits - we need complete visibility for accurate analysis.
 * Paths are cheap; reading content is where we limit.
 */
function scanFiles(dir: string): string[] {
  const files: string[] = [];
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.swift', '.go', '.rs', '.md', '.json', '.yaml', '.yml'];
  const ignore = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.midas', 'coverage', '.nyc_output'];

  function scan(d: string, depth = 0): void {
    // Depth 6 covers most project structures (src/modules/feature/components/utils/file.ts)
    if (depth > 6) return;
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || ignore.includes(entry.name)) continue;
        const path = join(d, entry.name);
        if (entry.isDirectory()) {
          scan(path, depth + 1);
        } else if (extensions.includes(extname(entry.name))) {
          files.push(path);
        }
      }
    } catch {
      // Directory may be inaccessible
    }
  }
  scan(dir);
  return files;
}

/**
 * Read file content. Full read by default - compression happens later.
 * Only limit for extremely large files to prevent memory issues.
 */
function readFile(path: string, maxLines = 500): string {
  try {
    const lines = readFileSync(path, 'utf-8').split('\n');
    if (lines.length <= maxLines) return lines.join('\n');
    // For very large files, take beginning + end (important context at both ends)
    const head = lines.slice(0, Math.floor(maxLines * 0.7));
    const tail = lines.slice(-Math.floor(maxLines * 0.3));
    return [...head, '\n// ... middle truncated ...\n', ...tail].join('\n');
  } catch {
    return '';
  }
}

// ============================================================================
// CONTEXT SUMMARIZATION
// ============================================================================

/**
 * Summarize long content using Claude (with caching for efficiency)
 * Use for: journal entries, long error logs, large code files
 */
export async function summarizeContent(
  content: string, 
  purpose: string,
  targetTokens: number = 200
): Promise<string> {
  // Don't summarize if already short enough
  if (estimateTokens(content) <= targetTokens) return content;
  
  try {
    const result = await callAI(
      `Summarize this in ~${targetTokens} tokens. Preserve: key decisions, technical choices, errors, solutions.\n\n${content.slice(0, 4000)}`,
      'You are a concise technical summarizer. Output only the summary, no preamble.',
      { maxTokens: targetTokens + 50, useThinking: false }  // Fast summarization
    );
    return result.trim();
  } catch {
    // Fallback: truncate intelligently
    return truncateIntelligently(content, targetTokens * 4);
  }
}

/**
 * Truncate text at sentence boundaries
 */
function truncateIntelligently(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  
  const truncated = text.slice(0, maxChars);
  const lastPeriod = truncated.lastIndexOf('. ');
  const lastNewline = truncated.lastIndexOf('\n');
  const boundary = Math.max(lastPeriod, lastNewline);
  
  if (boundary > maxChars * 0.7) {
    return truncated.slice(0, boundary + 1) + '...';
  }
  return truncated + '...';
}

function getActivityContext(projectPath: string): string {
  const safePath = sanitizePath(projectPath);
  try {
    const tracker = updateTracker(safePath);
    const lines: string[] = [];
    
    // Try to get actual Cursor chat history
    if (isCursorAvailable()) {
      try {
        const cursorInfo = getCursorInfo();
        const recentMessages = getRecentMessages(10);
        
        if (recentMessages.length > 0) {
          lines.push('## Recent Cursor Chat History:');
          lines.push(`(Source: ${cursorInfo.path})`);
          for (const msg of recentMessages.slice(-5)) {
            const prefix = msg.type === 'user' ? 'User' : 'AI';
            const text = msg.text.slice(0, 200) + (msg.text.length > 200 ? '...' : '');
            lines.push(`- ${prefix}: ${text}`);
          }
          lines.push('');
        }
      } catch (error) {
        logger.debug('Could not read Cursor chat history', { error: String(error) });
      }
    }
    
    // Recent file activity
    if (tracker.recentFiles.length > 0) {
      lines.push('## Recent File Activity:');
      for (const f of tracker.recentFiles.slice(0, 10)) {
        const ago = Math.round((Date.now() - f.lastModified) / 60000);
        lines.push(`- ${f.path} (${ago}min ago)`);
      }
    }
    
    // Git activity (CRITICAL for phase detection)
    if (tracker.gitActivity) {
      lines.push('\n## Git Activity:');
      lines.push(`- Branch: ${tracker.gitActivity.branch}`);
      lines.push(`- Uncommitted changes: ${tracker.gitActivity.uncommittedChanges}`);
      if (tracker.gitActivity.recentCommits && tracker.gitActivity.recentCommits.length > 0) {
        lines.push('- Recent commits (newest first):');
        for (const commit of tracker.gitActivity.recentCommits.slice(0, 10)) {
          lines.push(`  * ${commit}`);
        }
        // Phase hints from commits
        const commitText = tracker.gitActivity.recentCommits.join(' ').toLowerCase();
        if (commitText.includes('publish') || commitText.includes('release') || commitText.includes('deploy')) {
          lines.push('  → PHASE SIGNAL: publish/release/deploy commits detected → likely SHIP or GROW phase');
        }
        if (commitText.includes('bump version') || commitText.match(/v?\d+\.\d+\.\d+/)) {
          lines.push('  → PHASE SIGNAL: version bump detected → likely SHIP or GROW phase');
        }
      }
    }
    
    // Recent tool calls
    if (tracker.recentToolCalls.length > 0) {
      lines.push('\n## Recent Midas Tool Calls:');
      for (const t of tracker.recentToolCalls.slice(0, 5)) {
        const ago = Math.round((Date.now() - t.timestamp) / 60000);
        lines.push(`- ${t.tool} (${ago}min ago)`);
      }
    }
    
    // Completion signals
    lines.push('\n## Completion Signals:');
    lines.push(`- Tests exist: ${tracker.completionSignals.testsExist ? 'yes' : 'no'}`);
    lines.push(`- Docs complete: ${tracker.completionSignals.docsComplete ? 'yes' : 'no'}`);
    
    return lines.join('\n');
  } catch (error) {
    logger.error('Failed to get activity context', error as unknown);
    return 'No activity data available';
  }
}

export interface ProjectAnalysis {
  currentPhase: Phase;
  summary: string;
  whatsDone: string[];
  whatsNext: string;
  suggestedPrompt: string;
  confidence: number;
  techStack: string[];
}

// ============================================================================
// DETERMINISTIC PROGRESS CALCULATION
// ============================================================================

import { getGameplanProgress } from './gameplan-tracker.js';

export interface DeterministicProgress {
  percentage: number;       // 0-100, calculated from artifacts
  breakdown: {
    planning: number;       // 0-25 based on docs
    implementation: number; // 0-50 based on gameplan tasks
    quality: number;        // 0-25 based on tests/gates
  };
  label: string;           // Human-readable status
}

/**
 * Calculate progress deterministically from artifacts, not AI assessment.
 * 
 * Formula:
 * - PLAN phase: planning docs progress (brainlift, prd, gameplan)
 * - BUILD phase: gameplan task completion
 * - SHIP phase: gates + preflight checks
 * - GROW phase: deployment + monitoring artifacts
 */
export function calculateDeterministicProgress(projectPath: string): DeterministicProgress {
  const safePath = sanitizePath(projectPath);
  const state = loadState(safePath);
  const phase = state.current.phase;
  
  // Discover artifacts
  const docsResult = discoverDocsSync(safePath);
  const hasBrainlift = !!docsResult.brainlift;
  const hasPrd = !!docsResult.prd;
  const hasGameplan = !!docsResult.gameplan;
  const hasCursorrules = existsSync(join(safePath, '.cursorrules'));
  
  // Gates status
  const gatesStatus = getGatesStatus(safePath);
  const gatesScore = gatesStatus.allPass ? 25 : 
                     gatesStatus.failing.length === 1 ? 15 :
                     gatesStatus.failing.length === 2 ? 5 : 0;
  
  // Gameplan progress
  const gameplan = getGameplanProgress(safePath);
  const gameplanScore = Math.round((gameplan.actual / 100) * 50);
  
  // Planning docs score (0-25)
  let planningScore = 0;
  if (hasBrainlift) planningScore += 6;
  if (hasPrd) planningScore += 6;
  if (hasGameplan) planningScore += 8;
  if (hasCursorrules) planningScore += 5;
  
  // Calculate based on phase
  let percentage: number;
  let label: string;
  
  switch (phase) {
    case 'IDLE':
      percentage = 0;
      label = 'Not started';
      break;
      
    case 'PLAN':
      // In PLAN, we care about planning artifacts
      percentage = planningScore;
      label = `${planningScore}/25 planning`;
      break;
      
    case 'BUILD':
      // In BUILD, planning is done (25) + gameplan progress (0-50)
      percentage = 25 + gameplanScore;
      label = `${gameplan.actual}% implemented`;
      break;
      
    case 'SHIP':
      // In SHIP, planning (25) + implementation mostly done (40) + quality gates
      percentage = 65 + gatesScore;
      label = gatesStatus.allPass ? 'Ready to ship' : `Fixing: ${gatesStatus.failing.join(', ')}`;
      break;
      
    case 'GROW':
      // In GROW, we're at 90-100%
      percentage = 90 + gatesScore / 2.5;  // Gates add up to 10 more points
      label = 'Live & iterating';
      break;
      
    default:
      percentage = 0;
      label = 'Unknown';
  }
  
  return {
    percentage: Math.min(100, Math.round(percentage)),
    breakdown: {
      planning: planningScore,
      implementation: gameplanScore,
      quality: gatesScore,
    },
    label,
  };
}

export async function analyzeProject(projectPath: string): Promise<ProjectAnalysis> {
  const safePath = sanitizePath(projectPath);
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      currentPhase: { phase: 'IDLE' },
      summary: 'No API key - cannot analyze',
      whatsDone: [],
      whatsNext: 'Add API key to ~/.midas/config.json',
      suggestedPrompt: '',
      confidence: 0,
      techStack: [],
    };
  }

  // Get current state for context-aware discovery
  const currentState = loadState(safePath);
  const tracker = loadTracker(safePath);
  const unresolvedErrors = getUnresolvedErrors(safePath);
  
  // Build context for intelligent code discovery
  const codeContext: CodeContext = {
    phase: currentState.current,
    errors: unresolvedErrors.map(e => e.error),
    recentCommits: tracker.gitActivity?.recentCommits || [],
    mentions: tracker.recentFiles.map(f => f.path),
  };
  
  // Intelligent code discovery - reads files based on context, phase, and relevance
  const codeResult = discoverAndReadCode(safePath, codeContext);
  const files = codeResult.files.map(f => f.path);
  const fileList = codeResult.fileList;
  const codeSamples = codeResult.codeContext;
  
  // Discover and classify planning docs (intelligent detection)
  const docsResult = discoverDocsSync(safePath);
  const hasbrainlift = !!docsResult.brainlift;
  const hasPrd = !!docsResult.prd;
  const hasGameplan = !!docsResult.gameplan;
  
  // Check for .cursorrules (RULES step completion)
  const hasCursorrules = existsSync(join(safePath, '.cursorrules'));
  
  const brainliftContent = docsResult.brainlift?.content || '';
  const prdContent = docsResult.prd?.content || '';
  const gameplanContent = docsResult.gameplan?.content || '';
  
  // Check for deployment/monitoring
  const hasDockerfile = existsSync(join(safePath, 'Dockerfile')) || existsSync(join(safePath, 'docker-compose.yml'));
  const hasCI = existsSync(join(safePath, '.github', 'workflows'));
  const hasTests = codeResult.testFiles.length > 0;

  // Extract package.json for AI to analyze (let AI determine project type dynamically)
  let packageJsonContent = '';
  const packageJsonPath = join(safePath, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      // Include key fields that indicate project type
      packageJsonContent = JSON.stringify({
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        bin: pkg.bin,
        main: pkg.main,
        exports: pkg.exports,
        type: pkg.type,
        scripts: pkg.scripts,
        dependencies: Object.keys(pkg.dependencies || {}),
        devDependencies: Object.keys(pkg.devDependencies || {}),
      }, null, 2);
    } catch { /* ignore parse errors */ }
  }
  
  // Check for other project indicators (raw data for AI)
  const hasCargoToml = existsSync(join(safePath, 'Cargo.toml'));
  const hasPyproject = existsSync(join(safePath, 'pyproject.toml'));
  const hasSetupPy = existsSync(join(safePath, 'setup.py'));
  const hasGoMod = existsSync(join(safePath, 'go.mod'));
  
  // Get activity context (replaces broken chat history)
  const activityContext = getActivityContext(safePath);
  
  // Get journal entries for conversation history - read more context
  const journalEntries = getJournalEntries({ projectPath: safePath, limit: 10 });
  const journalContext = journalEntries.length > 0 
    ? journalEntries.map(e => `### ${e.title} (${e.timestamp.slice(0, 10)})\n${limitLength(e.conversation, 2000)}`).join('\n\n')
    : 'No journal entries yet';

  // Get gates status (currentState, tracker, unresolvedErrors already loaded above)
  const gatesStatus = getGatesStatus(safePath);
  
  // Auto-advance phase if gates pass (e.g., BUILD:TEST → BUILD:DEBUG when tests pass)
  // This ensures the AI suggests the right next action instead of re-suggesting tests
  if (gatesStatus.allPass) {
    const advanced = maybeAutoAdvance(safePath);
    if (advanced.advanced) {
      // Reload state after advancement
      const newState = loadState(safePath);
      currentState.current = newState.current;
      logger.debug('Auto-advanced phase', { from: advanced.from, to: advanced.to });
    }
  }
  
  // Build error context - show all errors with full messages
  const errorContext = unresolvedErrors.length > 0
    ? unresolvedErrors.slice(0, 10).map(e => 
        `- ${e.error}${e.file ? ` (${e.file}${e.line ? `:${e.line}` : ''})` : ''}${e.fixAttempts.length > 0 ? ` [tried ${e.fixAttempts.length}x]` : ''}`
      ).join('\n')
    : 'No unresolved errors';

  // Get recently rejected suggestions to avoid repeating them
  const rejectedSuggestions = tracker.suggestionHistory
    .filter(s => !s.accepted && s.rejectionReason)
    .slice(0, 3)
    .map(s => `- "${s.suggestion.slice(0, 60)}..." → Rejected: ${s.rejectionReason}`)
    .join('\n');
  
  const rejectionContext = rejectedSuggestions 
    ? `\n## Recently Rejected Suggestions (avoid these approaches):\n${rejectedSuggestions}\n`
    : '';

  // =========================================================================
  // OPTIMIZED CONTEXT STACKING FOR MAXIMUM CACHE HITS
  // =========================================================================
  // System prompt (CACHED - 90% savings on repeated calls):
  //   - Full methodology (stable across ALL calls)
  //   - Response format instructions (stable)
  //   - Project conventions (stable per project)
  //
  // User prompt (NOT cached - keep minimal):
  //   - Current state (dynamic)
  //   - Recent errors (dynamic)
  //   - Recent activity (dynamic)
  // =========================================================================
  
  // SYSTEM PROMPT - Large, stable content (will be cached)
  const systemPrompt = `You are Midas, a Golden Code coach. You analyze projects and determine their exact phase in the development lifecycle.

# GOLDEN CODE METHODOLOGY (Stable Reference)

## The 4 Development Phases:

### PLAN (Planning Phase)
Steps: IDEA → RESEARCH → BRAINLIFT → PRD → GAMEPLAN
Purpose: Understand the problem before writing code.
WHY: Code without context is just syntax. The AI doesn't know your domain, constraints, or users. You do.
- IDEA: Capture the core concept and motivation (WHY: Most projects fail from solving the wrong problem)
- RESEARCH: Study existing solutions, dependencies, constraints (WHY: Someone has solved 80% of this already)
- BRAINLIFT: Extract key decisions and mental models (WHY: AI read the internet. You have specific context it doesn't)
- PRD: Define requirements, scope, success criteria (WHY: "I'll know it when I see it" means you'll never finish)
- GAMEPLAN: Break into ordered implementation tasks (WHY: Sequence work so you're never blocked waiting for yourself)

### BUILD (Implementation Phase)
Steps: RULES → INDEX → READ → RESEARCH → IMPLEMENT → TEST → DEBUG
Purpose: Code methodically with verification at each step.
WHY: Jumping straight to code means hours of debugging. Each step reduces the blast radius of mistakes.
- RULES: Set up .cursorrules with project conventions. COMPLETE when .cursorrules exists - move to INDEX.
- INDEX: Understand codebase structure (WHY: You can't extend what you don't understand)
- READ: Study relevant existing code (WHY: Understand before touching to avoid breaking things)
- RESEARCH: Look up APIs, patterns, best practices (WHY: The right library can turn 200 lines into 5)
- IMPLEMENT: Write the code (WHY: Test-first defines "working" before you code)
- TEST: Verify with automated tests (WHY: Full suite catches regressions before production)
- DEBUG: Fix any issues using Tornado (WHY: When stuck, random changes make it worse. Tornado systematically narrows possibilities)

### SHIP (Deployment Phase)
Steps: REVIEW → DEPLOY → MONITOR
Purpose: Get code into production safely.
WHY: "Works on my machine" isn't deployment. Production has constraints, users, and consequences dev doesn't.
- REVIEW: Code review, security audit, performance check (WHY: Fresh eyes catch what tired eyes miss)
- DEPLOY: Analyze package.json/config to determine the RIGHT deployment method:
  * Has "bin" field? → CLI tool → npm/cargo/pip publish (NOT Docker!)
  * Has "main"/"exports" only? → Library → package registry publish
  * Has web framework deps (react, next, express)? → Web app → hosting platform
  * MCP servers are LOCAL tools - they run with the IDE, not on servers
  (WHY: Manual deployment is error-prone. CI/CD ensures same steps every time)
- MONITOR: Watch for errors, performance issues (WHY: Users don't file bug reports. They leave.)

CRITICAL: Analyze the actual project config to determine deployment. Don't assume Docker - many projects deploy to package registries.

### GROW (Graduation Phase)
Step: DONE (single step - project is shipped!)
Purpose: Celebrate and grow usage. The coding is done; now it's time for human actions.
WHY: Most projects die after launch. Growth requires deliberate effort outside the codebase.

The GROW phase is a graduation checklist, not a coached phase:
1. ANNOUNCE - Post to 3 communities (Reddit, Discord, Twitter, Hacker News)
2. NETWORK - DM 10 people who would find this useful
3. FEEDBACK - Ask 5 users: what's confusing? what's missing?
4. PROOF - Get 3 testimonials, screenshot your metrics
5. ITERATE - Ship one improvement based on feedback
6. CONTENT - Write "what I learned building X" post
7. MEASURE - Set up analytics for your key metric
8. AUTOMATE - Set up one recurring growth loop

When user is in GROW, congratulate them and remind them of the checklist. Use 'n' to start a new cycle.

## Key Rules:
1. GATES MUST PASS: Build, tests, and lint must pass before advancing
2. TORNADO DEBUGGING: If stuck on same error 3+ times, use Research + Logs + Tests
3. ONE TASK PER PROMPT: Each suggested prompt should be specific and actionable
4. ERRORS FIRST: If gates are failing, the next action MUST fix them
5. AUTO-ADVANCE: The AI has midas_advance_phase and midas_verify tools - NEVER suggest "advance me to X phase". The AI advances phases itself.
6. ACTIONABLE PROMPTS: Suggest specific work to DO, not phase management commands
7. PHASE FROM GIT: If commits show "bump version", "publish", "release", or "deploy" → project is in SHIP or GROW phase, NOT BUILD!

## Response Format:
Respond ONLY with valid JSON matching this schema:
{
  "phase": "PLAN" | "BUILD" | "SHIP" | "GROW" | "IDLE",
  "step": "step name within phase",
  "summary": "one-line project summary",
  "techStack": ["detected", "technologies"],
  "whatsDone": ["completed item 1", "completed item 2"],
  "whatsNext": "specific next action description",
  "suggestedPrompt": "exact actionable prompt for Cursor",
  "confidence": 0-100
}${getSkillPromptSuffix(getSkillLevel())}`;

  // USER PROMPT - Minimal, dynamic content only (NOT cached)
  const userPrompt = `# CURRENT PROJECT STATE

## Midas Tracking:
- Phase: ${currentState.current.phase}${('step' in currentState.current) ? ` → ${currentState.current.step}` : ''}
- Confidence: ${tracker.confidence}%
- Gates: ${gatesStatus.allPass ? 'ALL PASS' : gatesStatus.failing.length > 0 ? `FAILING: ${gatesStatus.failing.join(', ')}` : 'Not yet run'}
${rejectionContext}
## Unresolved Errors:
${errorContext}

## Recent Activity:
${activityContext}

---

# PROJECT STRUCTURE

## Files (${files.length} total):
${fileList}

## Planning Docs:
- brainlift.md: ${hasbrainlift ? 'exists' : 'missing'}
- prd.md: ${hasPrd ? 'exists' : 'missing'}
- gameplan.md: ${hasGameplan ? 'exists' : 'missing'}
- .cursorrules: ${hasCursorrules ? 'exists (RULES step complete)' : 'missing'}

${brainliftContent ? `## brainlift.md (full):\n${brainliftContent}` : ''}

${prdContent ? `## prd.md (full):\n${prdContent}` : ''}

${gameplanContent ? `## gameplan.md (full):\n${gameplanContent}` : ''}

## Project Configuration (use this to determine project type and deployment):
${packageJsonContent ? `package.json:\n${packageJsonContent}` : 'No package.json'}
${hasCargoToml ? '- Has Cargo.toml (Rust)' : ''}
${hasPyproject ? '- Has pyproject.toml (Python)' : ''}
${hasSetupPy ? '- Has setup.py (Python)' : ''}
${hasGoMod ? '- Has go.mod (Go)' : ''}

## Infrastructure:
- Tests: ${hasTests ? 'yes' : 'no'} (found ${codeResult.testFiles.length} test files)
- Dockerfile/compose: ${hasDockerfile ? 'yes' : 'no'}
- CI/CD: ${hasCI ? 'yes' : 'no'}

## Code Context (${codeResult.files.length} files analyzed):
${codeSamples || 'No code files yet'}

## Recent Conversations (${journalEntries.length} entries):
${journalContext}

---

Analyze this project and provide the JSON response.`;

  try {
    const response = await callAI(userPrompt, systemPrompt);
    
    // Parse JSON from response
    let jsonStr = response;
    if (response.includes('```')) {
      const match = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1];
    }
    
    const data = JSON.parse(jsonStr.trim());
    
    // Convert to Phase type
    let currentPhase: Phase;
    if (data.phase === 'IDLE' || !data.phase) {
      currentPhase = { phase: 'IDLE' };
    } else if (data.phase === 'PLAN') {
      currentPhase = { phase: 'PLAN', step: data.step as PlanStep };
    } else if (data.phase === 'BUILD') {
      currentPhase = { phase: 'BUILD', step: data.step as BuildStep };
    } else if (data.phase === 'SHIP') {
      currentPhase = { phase: 'SHIP', step: data.step as ShipStep };
    } else if (data.phase === 'GROW') {
      currentPhase = { phase: 'GROW', step: data.step as GrowStep };
    } else {
      currentPhase = { phase: 'IDLE' };
    }
    
    // Mark analysis as complete for file change tracking
    markAnalysisComplete(safePath);
    
    return {
      currentPhase,
      summary: data.summary || 'Project analyzed',
      whatsDone: data.whatsDone || [],
      whatsNext: data.whatsNext || 'Continue development',
      suggestedPrompt: data.suggestedPrompt || '',
      confidence: data.confidence || 50,
      techStack: data.techStack || [],
    };
  } catch (error) {
    logger.error('AI analysis failed', error as unknown);
    
    // Preserve error details for debugging
    let errorReason = 'Unknown error';
    if (error instanceof Error) {
      if (error.message.includes('Rate limited')) {
        errorReason = 'Rate limited - wait a moment';
      } else if (error.message.includes('Invalid API key')) {
        errorReason = 'Invalid API key - check config';
      } else if (error.message.includes('overloaded')) {
        errorReason = 'API overloaded - try again';
      } else if (error.message.includes('No API key')) {
        errorReason = 'No API key - run midas config';
      } else if (error.message.includes('timeout') || error.name === 'AbortError') {
        errorReason = 'Request timed out';
      } else {
        // Include first 50 chars of actual error
        errorReason = error.message.slice(0, 50);
      }
    }
    
    return {
      currentPhase: { phase: 'IDLE' },
      summary: `Analysis failed: ${errorReason}`,
      whatsDone: [],
      whatsNext: 'Fix the issue above and try again',
      suggestedPrompt: '',
      confidence: 0,
      techStack: [],
    };
  }
}

// ============================================================================
// STREAMING ANALYSIS (with progress feedback)
// ============================================================================

export interface AnalysisProgress {
  stage: 'gathering' | 'connecting' | 'thinking' | 'streaming' | 'parsing' | 'complete';
  message: string;
  elapsedMs: number;
  tokensReceived?: number;
  partialContent?: string;  // Partial streamed content for early result preview
}

export type AnalysisProgressCallback = (progress: AnalysisProgress) => void;

/**
 * Analyze project with real-time streaming progress
 * Use this for TUI to show accurate progress feedback
 */
export async function analyzeProjectStreaming(
  projectPath: string,
  onProgress?: AnalysisProgressCallback
): Promise<ProjectAnalysis> {
  const startTime = Date.now();
  const elapsed = () => Date.now() - startTime;
  
  // Stage 1: Gathering context (fast, sync)
  onProgress?.({
    stage: 'gathering',
    message: 'Reading files and context...',
    elapsedMs: elapsed(),
  });
  
  const safePath = sanitizePath(projectPath);
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      currentPhase: { phase: 'IDLE' },
      summary: 'No API key - cannot analyze',
      whatsDone: [],
      whatsNext: 'Add API key to ~/.midas/config.json',
      suggestedPrompt: '',
      confidence: 0,
      techStack: [],
    };
  }

  // Get current state for context-aware discovery
  const currentState = loadState(safePath);
  const tracker = loadTracker(safePath);
  const unresolvedErrors = getUnresolvedErrors(safePath);
  
  // Build context for intelligent code discovery
  const codeContext: CodeContext = {
    phase: currentState.current,
    errors: unresolvedErrors.map(e => e.error),
    recentCommits: tracker.gitActivity?.recentCommits || [],
    mentions: tracker.recentFiles.map(f => f.path),
  };
  
  // Intelligent code discovery - reads files based on context, phase, and relevance
  const codeResult = discoverAndReadCode(safePath, codeContext);
  const files = codeResult.files.map(f => f.path);
  const fileList = codeResult.fileList;
  const codeSamples = codeResult.codeContext;
  
  // Discover and classify planning docs (intelligent detection)
  const docsResult = discoverDocsSync(safePath);
  const hasbrainlift = !!docsResult.brainlift;
  const hasPrd = !!docsResult.prd;
  const hasGameplan = !!docsResult.gameplan;
  
  // Check for .cursorrules (RULES step completion)
  const hasCursorrules = existsSync(join(safePath, '.cursorrules'));
  
  const brainliftContent = docsResult.brainlift?.content || '';
  const prdContent = docsResult.prd?.content || '';
  const gameplanContent = docsResult.gameplan?.content || '';
  
  const hasDockerfile = existsSync(join(safePath, 'Dockerfile')) || existsSync(join(safePath, 'docker-compose.yml'));
  const hasCI = existsSync(join(safePath, '.github', 'workflows'));
  const hasTests = codeResult.testFiles.length > 0;

  let packageJsonContent = '';
  const packageJsonPath = join(safePath, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      packageJsonContent = JSON.stringify({
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        bin: pkg.bin,
        main: pkg.main,
        exports: pkg.exports,
        type: pkg.type,
        scripts: pkg.scripts,
        dependencies: Object.keys(pkg.dependencies || {}),
        devDependencies: Object.keys(pkg.devDependencies || {}),
      }, null, 2);
    } catch { /* ignore */ }
  }
  
  const hasCargoToml = existsSync(join(safePath, 'Cargo.toml'));
  const hasPyproject = existsSync(join(safePath, 'pyproject.toml'));
  
  const activityContext = getActivityContext(safePath);
  const journalEntries = getJournalEntries({ projectPath: safePath, limit: 10 });
  const journalContext = journalEntries.length > 0 
    ? journalEntries.map(e => `### ${e.title} (${e.timestamp.slice(0, 10)})\n${limitLength(e.conversation, 2000)}`).join('\n\n')
    : 'No journal entries yet';

  const gatesStatus = getGatesStatus(safePath);
  
  const errorContext = unresolvedErrors.length > 0
    ? unresolvedErrors.slice(0, 10).map(e => 
        `- ${e.error}${e.file ? ` (${e.file}${e.line ? `:${e.line}` : ''})` : ''}${e.fixAttempts.length > 0 ? ` [tried ${e.fixAttempts.length}x]` : ''}`
      ).join('\n')
    : 'No unresolved errors';

  const rejectedSuggestions = tracker.suggestionHistory
    .filter(s => !s.accepted && s.rejectionReason)
    .slice(0, 3)
    .map(s => `- "${s.suggestion.slice(0, 60)}..." → Rejected: ${s.rejectionReason}`)
    .join('\n');
  
  const rejectionContext = rejectedSuggestions 
    ? `\n## Recently Rejected Suggestions (avoid these approaches):\n${rejectedSuggestions}\n`
    : '';

  // Build prompts (same as analyzeProject)
  const systemPrompt = buildSystemPrompt();
  const skillLevel = getSkillLevel() || 'intermediate';
  const skillSuffix = getSkillPromptSuffix(skillLevel);
  
  const userPrompt = buildUserPrompt({
    safePath,
    fileList,
    files,
    hasbrainlift,
    hasPrd,
    hasGameplan,
    hasCursorrules,
    brainliftContent,
    prdContent,
    gameplanContent,
    hasDockerfile,
    hasCI,
    hasTests,
    packageJsonContent,
    hasCargoToml,
    hasPyproject,
    activityContext,
    journalContext,
    journalEntries,
    codeSamples,
    filesAnalyzed: codeResult.files.length,
    testFilesCount: codeResult.testFiles.length,
    currentState,
    gatesStatus,
    errorContext,
    rejectionContext,
    skillSuffix,
  });

  // Stage 2: AI call with streaming
  try {
    const response = await chatStream(userPrompt, {
      systemPrompt,
      onProgress: (streamProgress) => {
        if (streamProgress.stage === 'connecting') {
          onProgress?.({
            stage: 'connecting',
            message: 'Connecting to AI...',
            elapsedMs: elapsed(),
          });
        } else if (streamProgress.stage === 'thinking') {
          onProgress?.({
            stage: 'thinking',
            message: 'AI is thinking...',
            elapsedMs: elapsed(),
          });
        } else if (streamProgress.stage === 'streaming') {
          onProgress?.({
            stage: 'streaming',
            message: `Receiving response...`,
            elapsedMs: elapsed(),
            tokensReceived: streamProgress.tokensReceived,
            partialContent: streamProgress.partialContent,  // Pass partial content for early preview
          });
        }
      },
    });
    
    // Stage 3: Parsing
    onProgress?.({
      stage: 'parsing',
      message: 'Parsing response...',
      elapsedMs: elapsed(),
    });
    
    let jsonStr = response.content;
    if (response.content.includes('```')) {
      const match = response.content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1];
    }
    
    const data = JSON.parse(jsonStr.trim());
    
    let currentPhase: Phase;
    if (data.phase === 'IDLE' || !data.phase) {
      currentPhase = { phase: 'IDLE' };
    } else if (data.phase === 'PLAN') {
      currentPhase = { phase: 'PLAN', step: data.step as PlanStep };
    } else if (data.phase === 'BUILD') {
      currentPhase = { phase: 'BUILD', step: data.step as BuildStep };
    } else if (data.phase === 'SHIP') {
      currentPhase = { phase: 'SHIP', step: data.step as ShipStep };
    } else if (data.phase === 'GROW') {
      currentPhase = { phase: 'GROW', step: data.step as GrowStep };
    } else {
      currentPhase = { phase: 'IDLE' };
    }
    
    markAnalysisComplete(safePath);
    
    // Stage 4: Complete
    onProgress?.({
      stage: 'complete',
      message: 'Analysis complete',
      elapsedMs: elapsed(),
    });
    
    return {
      currentPhase,
      summary: data.summary || 'Project analyzed',
      whatsDone: data.whatsDone || [],
      whatsNext: data.whatsNext || 'Continue development',
      suggestedPrompt: data.suggestedPrompt || '',
      confidence: data.confidence || 50,
      techStack: data.techStack || [],
    };
  } catch (error) {
    logger.error('Streaming analysis failed', error as unknown);
    
    // Notify about fallback
    onProgress?.({
      stage: 'gathering',
      message: 'Streaming failed, trying non-streaming...',
      elapsedMs: elapsed(),
    });
    
    // Fall back to non-streaming analysis
    return analyzeProject(projectPath);
  }
}

// Helper to build system prompt (extracted for reuse)
function buildSystemPrompt(): string {
  return `You are Midas, a Golden Code coach. You analyze projects and determine their exact phase in the development lifecycle.

# GOLDEN CODE METHODOLOGY (Stable Reference)

## The 4 Development Phases:

### PLAN (Planning Phase)
Steps: IDEA → RESEARCH → BRAINLIFT → PRD → GAMEPLAN
Purpose: Understand the problem before writing code.
WHY: Code without context is just syntax. The AI doesn't know your domain, constraints, or users. You do.
- IDEA: Capture the core concept and motivation (WHY: Most projects fail from solving the wrong problem)
- RESEARCH: Study existing solutions, dependencies, constraints (WHY: Someone has solved 80% of this already)
- BRAINLIFT: Extract key decisions and mental models (WHY: AI read the internet. You have specific context it doesn't)
- PRD: Define requirements, scope, success criteria (WHY: "I'll know it when I see it" means you'll never finish)
- GAMEPLAN: Break into ordered implementation tasks (WHY: Sequence work so you're never blocked waiting for yourself)

### BUILD (Implementation Phase)
Steps: RULES → INDEX → READ → RESEARCH → IMPLEMENT → TEST → DEBUG
Purpose: Code methodically with verification at each step.
WHY: Jumping straight to code means hours of debugging. Each step reduces the blast radius of mistakes.
- RULES: Set up .cursorrules with project conventions. COMPLETE when .cursorrules exists - move to INDEX.
- INDEX: Understand codebase structure
- READ: Study relevant existing code
- RESEARCH: Look up APIs, patterns, best practices
- IMPLEMENT: Write the code
- TEST: Verify with automated tests
- DEBUG: Fix any issues using Tornado

### SHIP (Deployment Phase)
Steps: REVIEW → DEPLOY → MONITOR
Purpose: Get code into production safely.
- REVIEW: Code review, security audit, performance check
- DEPLOY: Push to production with proper CI/CD
- MONITOR: Watch for errors, performance issues

### GROW (Graduation Phase)
Step: DONE (single step - project is shipped!)
Purpose: Celebrate and grow usage. The coding is done; now it's time for human actions.
The GROW phase is a graduation checklist:
1. ANNOUNCE - Post to 3 communities
2. NETWORK - DM 10 people
3. FEEDBACK - Ask 5 users
4. PROOF - Get testimonials
5. ITERATE - Ship one improvement
6. CONTENT - Write about it
7. MEASURE - Set up analytics
8. AUTOMATE - Set up growth loop

## Key Rules:
1. GATES MUST PASS: Build, tests, and lint must pass before advancing
2. ONE TASK PER PROMPT: Each suggested prompt should be specific and actionable
3. AUTO-ADVANCE: Use midas_advance_phase tool - never suggest "advance me to X phase"
4. PHASE FROM GIT: Version bump/publish commits → SHIP or GROW phase

## Response Format:
Respond ONLY with valid JSON matching this schema:
{
  "phase": "PLAN" | "BUILD" | "SHIP" | "GROW" | "IDLE",
  "step": "string (step within phase)",
  "summary": "1-2 sentence project summary",
  "whatsDone": ["array of completed items"],
  "whatsNext": "single next action",
  "suggestedPrompt": "specific prompt to paste in Cursor",
  "confidence": 0-100,
  "techStack": ["array of detected technologies"]
}`;
}

// Helper to build user prompt (extracted for reuse)
function buildUserPrompt(ctx: {
  safePath: string;
  fileList: string;
  files: string[];
  hasbrainlift: boolean;
  hasPrd: boolean;
  hasGameplan: boolean;
  hasCursorrules: boolean;
  brainliftContent: string;
  prdContent: string;
  gameplanContent: string;
  hasDockerfile: boolean;
  hasCI: boolean;
  hasTests: boolean;
  packageJsonContent: string;
  hasCargoToml: boolean;
  hasPyproject: boolean;
  activityContext: string;
  journalContext: string;
  journalEntries: Array<{ title: string; timestamp: string; conversation: string }>;
  codeSamples: string;
  filesAnalyzed: number;
  testFilesCount: number;
  currentState: { current: Phase };
  gatesStatus: ReturnType<typeof getGatesStatus>;
  errorContext: string;
  rejectionContext: string;
  skillSuffix: string;
}): string {
  return `Analyze this project:

## Project Structure (${ctx.files.length} files):
${ctx.fileList.slice(0, 3000)}

## Planning Docs:
- brainlift.md: ${ctx.hasbrainlift ? 'exists' : 'missing'}
- prd.md: ${ctx.hasPrd ? 'exists' : 'missing'}
- gameplan.md: ${ctx.hasGameplan ? 'exists' : 'missing'}
- .cursorrules: ${ctx.hasCursorrules ? 'exists (RULES step complete - skip to INDEX)' : 'missing'}

${ctx.brainliftContent ? `## Brainlift Content:\n${ctx.brainliftContent.slice(0, 2000)}\n` : ''}
${ctx.prdContent ? `## PRD Content:\n${ctx.prdContent.slice(0, 2000)}\n` : ''}
${ctx.gameplanContent ? `## Gameplan Content:\n${ctx.gameplanContent.slice(0, 2000)}\n` : ''}

## Project Config:
${ctx.packageJsonContent ? `package.json:\n${ctx.packageJsonContent}\n` : ''}
${ctx.hasCargoToml ? 'Cargo.toml: exists (Rust project)\n' : ''}
${ctx.hasPyproject ? 'pyproject.toml: exists (Python project)\n' : ''}

## Current State:
- Phase: ${ctx.currentState.current.phase}${'step' in ctx.currentState.current ? ` → ${ctx.currentState.current.step}` : ''}
- Gates: ${ctx.gatesStatus.allPass ? 'all passing' : `failing: ${ctx.gatesStatus.failing.join(', ')}`}
- Errors: ${ctx.errorContext}

## Recent Activity:
${ctx.activityContext}
${ctx.rejectionContext}

## Infrastructure:
- Dockerfile: ${ctx.hasDockerfile ? 'yes' : 'no'}
- CI/CD: ${ctx.hasCI ? 'yes' : 'no'}

## Code Context (${ctx.filesAnalyzed} files analyzed, ${ctx.testFilesCount} tests):
${ctx.codeSamples || 'No code files yet'}

## Recent Conversations (${ctx.journalEntries.length} entries):
${ctx.journalContext}

${ctx.skillSuffix}

---

Analyze this project and provide the JSON response.`;
}

// ============================================================================
// ANALYZE AI RESPONSE - Extract insights from pasted chat response
// ============================================================================

export interface ResponseAnalysis {
  summary: string;           // One-line summary of what was done
  accomplished: string[];    // List of things accomplished
  errors: string[];          // Errors or blockers mentioned
  filesChanged: string[];    // Files that were modified
  taskComplete: boolean;     // Whether the current task seems complete
  suggestedNextPrompt: string;
  shouldAdvancePhase: boolean;
  confidence: number;
}

/**
 * Analyze a pasted AI response to extract insights
 * This bridges the gap between Cursor chat and Midas tracking
 */
export async function analyzeResponse(
  projectPath: string,
  userPrompt: string,
  aiResponse: string
): Promise<ResponseAnalysis> {
  const safePath = sanitizePath(projectPath);
  const apiKey = getApiKey();
  
  if (!apiKey) {
    // Return basic analysis without AI
    return {
      summary: 'Response received (no AI analysis - missing API key)',
      accomplished: [],
      errors: [],
      filesChanged: [],
      taskComplete: false,
      suggestedNextPrompt: 'Continue with current task',
      shouldAdvancePhase: false,
      confidence: 0,
    };
  }
  
  const state = loadState(safePath);
  const currentPhase = state.current;
  
  const systemPrompt = `You are Midas, analyzing an AI coding assistant's response to extract actionable insights.

Current project phase: ${currentPhase.phase}${currentPhase.phase !== 'IDLE' ? `:${currentPhase.step}` : ''}

Analyze the response and extract:
1. What was accomplished
2. Any errors, failures, or blockers mentioned
3. Files that were modified
4. Whether the task seems complete
5. What the next logical prompt should be
6. Whether the phase should advance

Respond in JSON format only.`;

  const prompt = `USER PROMPT:
${userPrompt.slice(0, 2000)}

AI RESPONSE:
${aiResponse.slice(0, 8000)}

Analyze this exchange and respond with JSON:
{
  "summary": "One-line summary of what was done",
  "accomplished": ["item1", "item2"],
  "errors": ["error1"] or [],
  "filesChanged": ["path/to/file.ts"] or [],
  "taskComplete": true/false,
  "suggestedNextPrompt": "The next prompt to continue progress",
  "shouldAdvancePhase": true/false,
  "confidence": 0-100
}`;

  try {
    const response = await callAI(prompt, systemPrompt, { 
      maxTokens: 1000, 
      useThinking: false,  // Fast response for this
    });
    
    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || 'Response analyzed',
        accomplished: parsed.accomplished || [],
        errors: parsed.errors || [],
        filesChanged: parsed.filesChanged || [],
        taskComplete: parsed.taskComplete ?? false,
        suggestedNextPrompt: parsed.suggestedNextPrompt || 'Continue with current task',
        shouldAdvancePhase: parsed.shouldAdvancePhase ?? false,
        confidence: parsed.confidence ?? 50,
      };
    }
  } catch (error) {
    logger.error('Failed to analyze response', error as unknown);
  }
  
  // Fallback
  return {
    summary: 'Response received',
    accomplished: [],
    errors: [],
    filesChanged: [],
    taskComplete: false,
    suggestedNextPrompt: 'Continue with current task',
    shouldAdvancePhase: false,
    confidence: 0,
  };
}
