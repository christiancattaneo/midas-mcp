import { getApiKey, getActiveProvider } from './config.js';
import { chat, getProviderCapabilities, getCurrentModel } from './providers.js';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import type { Phase, EagleSightStep, BuildStep, ShipStep, GrowStep } from './state/phase.js';
import { loadState } from './state/phase.js';
import { updateTracker, getActivitySummary, loadTracker, getGatesStatus, getUnresolvedErrors, markAnalysisComplete } from './tracker.js';
import { getJournalEntries } from './tools/journal.js';
import { sanitizePath, limitLength, LIMITS } from './security.js';
import { logger } from './logger.js';
import { buildCompressedContext, contextToString, estimateTokens } from './context.js';

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

function scanFiles(dir: string, maxFiles = 30): string[] {
  const files: string[] = [];
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.swift', '.go', '.rs', '.md'];
  const ignore = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__'];

  function scan(d: string, depth = 0): void {
    if (depth > 3 || files.length >= maxFiles) return;
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (files.length >= maxFiles) break;
        if (entry.name.startsWith('.') || ignore.includes(entry.name)) continue;
        const path = join(d, entry.name);
        if (entry.isDirectory()) scan(path, depth + 1);
        else if (extensions.includes(extname(entry.name))) files.push(path);
      }
    } catch {
      // Directory may be inaccessible
    }
  }
  scan(dir);
  return files;
}

function readFile(path: string, maxLines = 30): string {
  try {
    return readFileSync(path, 'utf-8').split('\n').slice(0, maxLines).join('\n');
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
    
    // Recent file activity
    if (tracker.recentFiles.length > 0) {
      lines.push('## Recent File Activity:');
      for (const f of tracker.recentFiles.slice(0, 10)) {
        const ago = Math.round((Date.now() - f.lastModified) / 60000);
        lines.push(`- ${f.path} (${ago}min ago)`);
      }
    }
    
    // Git activity
    if (tracker.gitActivity) {
      lines.push('\n## Git Activity:');
      lines.push(`- Branch: ${tracker.gitActivity.branch}`);
      lines.push(`- Uncommitted changes: ${tracker.gitActivity.uncommittedChanges}`);
      if (tracker.gitActivity.lastCommitMessage) {
        lines.push(`- Last commit: "${tracker.gitActivity.lastCommitMessage}"`);
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

  // Gather context
  const files = scanFiles(safePath);
  const fileList = files.map(f => f.replace(safePath + '/', '')).join('\n');
  
  // Check for planning docs
  const hasbrainlift = existsSync(join(safePath, 'docs', 'brainlift.md'));
  const hasPrd = existsSync(join(safePath, 'docs', 'prd.md'));
  const hasGameplan = existsSync(join(safePath, 'docs', 'gameplan.md'));
  
  const brainliftContent = hasbrainlift ? readFile(join(safePath, 'docs', 'brainlift.md')) : '';
  const prdContent = hasPrd ? readFile(join(safePath, 'docs', 'prd.md')) : '';
  const gameplanContent = hasGameplan ? readFile(join(safePath, 'docs', 'gameplan.md')) : '';
  
  // Check for deployment/monitoring
  const hasDockerfile = existsSync(join(safePath, 'Dockerfile')) || existsSync(join(safePath, 'docker-compose.yml'));
  const hasCI = existsSync(join(safePath, '.github', 'workflows'));
  const hasTests = files.some(f => f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__'));
  
  // Get activity context (replaces broken chat history)
  const activityContext = getActivityContext(safePath);
  
  // Get journal entries for conversation history
  const journalEntries = getJournalEntries({ projectPath: safePath, limit: 5 });
  const journalContext = journalEntries.length > 0 
    ? journalEntries.map(e => `### ${e.title} (${e.timestamp.slice(0, 10)})\n${limitLength(e.conversation, 500)}`).join('\n\n')
    : 'No journal entries yet';
  
  // Sample some code files
  const codeSamples = files.slice(0, 5).map(f => {
    const content = readFile(f, 20);
    return `--- ${f.replace(safePath + '/', '')} ---\n${content}`;
  }).join('\n\n');

  // Get current state for context
  const currentState = loadState(safePath);
  const tracker = loadTracker(safePath);
  const gatesStatus = getGatesStatus(safePath);
  const unresolvedErrors = getUnresolvedErrors(safePath);
  
  // Build error context
  const errorContext = unresolvedErrors.length > 0
    ? unresolvedErrors.slice(0, 3).map(e => 
        `- ${e.error.slice(0, 100)}${e.fixAttempts.length > 0 ? ` (tried ${e.fixAttempts.length}x)` : ''}`
      ).join('\n')
    : 'No unresolved errors';

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
- IDEA: Capture the core concept and motivation
- RESEARCH: Study existing solutions, dependencies, constraints
- BRAINLIFT: Extract key decisions and mental models
- PRD: Define requirements, scope, success criteria
- GAMEPLAN: Break into ordered implementation tasks

### BUILD (Implementation Phase)
Steps: RULES → INDEX → READ → RESEARCH → IMPLEMENT → TEST → DEBUG
Purpose: Code methodically with verification at each step.
- RULES: Set up .cursorrules with project conventions
- INDEX: Understand codebase structure
- READ: Study relevant existing code
- RESEARCH: Look up APIs, patterns, best practices
- IMPLEMENT: Write the code
- TEST: Verify with automated tests
- DEBUG: Fix any issues (use Tornado if stuck)

### SHIP (Deployment Phase)
Steps: REVIEW → DEPLOY → MONITOR
Purpose: Get code into production safely.
- REVIEW: Code review, security audit, performance check
- DEPLOY: Push to production with proper CI/CD
- MONITOR: Watch for errors, performance issues

### GROW (Iteration Phase)
Steps: MONITOR → COLLECT → TRIAGE → RETROSPECT → PLAN_NEXT → LOOP
Purpose: Learn from production and improve.
- MONITOR: Track error rates, performance, engagement
- COLLECT: Gather user feedback, bug reports
- TRIAGE: Prioritize by impact/effort
- RETROSPECT: What worked, what didn't
- PLAN_NEXT: Define next iteration scope
- LOOP: Return to PLAN with new context

## Key Rules:
1. GATES MUST PASS: Build, tests, and lint must pass before advancing
2. TORNADO DEBUGGING: If stuck on same error 3+ times, use Research + Logs + Tests
3. ONE TASK PER PROMPT: Each suggested prompt should be specific and actionable
4. ERRORS FIRST: If gates are failing, the next action MUST fix them

## Response Format:
Respond ONLY with valid JSON matching this schema:
{
  "phase": "EAGLE_SIGHT" | "BUILD" | "SHIP" | "GROW" | "IDLE",
  "step": "step name within phase",
  "summary": "one-line project summary",
  "techStack": ["detected", "technologies"],
  "whatsDone": ["completed item 1", "completed item 2"],
  "whatsNext": "specific next action description",
  "suggestedPrompt": "exact actionable prompt for Cursor",
  "confidence": 0-100
}`;

  // USER PROMPT - Minimal, dynamic content only (NOT cached)
  const userPrompt = `# CURRENT PROJECT STATE

## Midas Tracking:
- Phase: ${currentState.current.phase}${('step' in currentState.current) ? ` → ${currentState.current.step}` : ''}
- Confidence: ${tracker.confidence}%
- Gates: ${gatesStatus.allPass ? 'ALL PASS' : gatesStatus.failing.length > 0 ? `FAILING: ${gatesStatus.failing.join(', ')}` : 'Not yet run'}

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

${brainliftContent ? `brainlift.md preview:\n${brainliftContent.slice(0, 200)}` : ''}

## Infrastructure:
- Tests: ${hasTests ? 'yes' : 'no'}
- Dockerfile/compose: ${hasDockerfile ? 'yes' : 'no'}
- CI/CD: ${hasCI ? 'yes' : 'no'}

## Recent Code (samples):
${(codeSamples || 'No code files yet').slice(0, 500)}

## Recent Conversations:
${journalContext.slice(0, 400)}

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
    } else if (data.phase === 'EAGLE_SIGHT') {
      currentPhase = { phase: 'EAGLE_SIGHT', step: data.step as EagleSightStep };
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
    return {
      currentPhase: { phase: 'IDLE' },
      summary: 'Analysis failed',
      whatsDone: [],
      whatsNext: 'Try again or check API key',
      suggestedPrompt: '',
      confidence: 0,
      techStack: [],
    };
  }
}

// ============================================================================
// QUICK ANALYSIS (for frequent re-checks)
// ============================================================================

/**
 * Fast analysis using pre-compressed context
 * Use this for file-change triggered re-analysis
 */
export async function quickAnalyze(projectPath: string): Promise<{
  suggestedPrompt: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  reason: string;
  explanation: string;
}> {
  const safePath = sanitizePath(projectPath);
  
  // Build compressed context (fast, no AI needed)
  buildCompressedContext(safePath, { maxTokens: 2000 });
  
  // Get smart suggestion based on gates/errors
  const { getSmartPromptSuggestion } = await import('./tracker.js');
  const suggestion = getSmartPromptSuggestion(safePath);
  
  // Mark analysis complete
  markAnalysisComplete(safePath);
  
  return {
    suggestedPrompt: suggestion.prompt,
    priority: suggestion.priority,
    reason: suggestion.reason,
    explanation: suggestion.explanation,
  };
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
${userPrompt.slice(0, 500)}

AI RESPONSE:
${aiResponse.slice(0, 3000)}

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
