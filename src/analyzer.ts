import { getApiKey } from './config.js';
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
// CLAUDE API WITH PROMPT CACHING
// ============================================================================

/**
 * Call Claude with optional prompt caching
 * 
 * Prompt caching saves 90% on repeated system prompts:
 * - First call: Normal price for cache write
 * - Subsequent calls: 90% cheaper for cached portion
 * 
 * Requirements:
 * - System prompt must be identical
 * - Cache expires after ~5 minutes of inactivity
 * - Minimum 1024 tokens for caching to activate
 */
async function callClaude(
  prompt: string, 
  systemPrompt: string, 
  options: { useCache?: boolean; maxTokens?: number } = {}
): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No API key');

  const useCache = options.useCache ?? true;
  const maxTokens = options.maxTokens ?? 2048;

  // Build request body
  const body: Record<string, unknown> = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };

  // Use prompt caching if enabled and system prompt is large enough
  // Caching requires minimum 1024 tokens to be effective
  if (useCache && estimateTokens(systemPrompt) >= 256) {
    body.system = [{
      type: 'text',
      text: systemPrompt,
      cache_control: { type: 'ephemeral' },  // Cache this system prompt
    }];
  } else {
    body.system = systemPrompt;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as { 
    content: Array<{ text: string }>;
    usage?: { 
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  
  // Log cache usage for debugging/monitoring
  if (data.usage?.cache_read_input_tokens) {
    logger.debug('Prompt cache hit', { 
      cached_tokens: data.usage.cache_read_input_tokens 
    });
  }
  
  return data.content[0]?.text || '';
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
    const result = await callClaude(
      `Summarize this in ~${targetTokens} tokens. Preserve: key decisions, technical choices, errors, solutions.\n\n${content.slice(0, 4000)}`,
      'You are a concise technical summarizer. Output only the summary, no preamble.',
      { maxTokens: targetTokens + 50, useCache: false }  // Don't cache summaries
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
  
  // Check for Eagle Sight docs
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

  // Context stacking: STABLE FIRST (high attention at beginning)
  // Then PROJECT CONTEXT (middle, lower attention)
  // Then RECENT ACTIVITY LAST (high attention at end)
  
  const prompt = `# GOLDEN CODE METHODOLOGY (Stable Context - Beginning)

## The 4 Phases with Steps:
EAGLE_SIGHT (Planning): IDEA → RESEARCH → BRAINLIFT → PRD → GAMEPLAN
BUILD (7-step cycle): RULES → INDEX → READ → RESEARCH → IMPLEMENT → TEST → DEBUG
SHIP: REVIEW → DEPLOY → MONITOR
GROW: FEEDBACK → ANALYZE → ITERATE

## Current State (from Midas tracking):
- Phase: ${currentState.current.phase}${('step' in currentState.current) ? ` → ${currentState.current.step}` : ''}
- Confidence: ${tracker.confidence}%
- Gates: ${gatesStatus.allPass ? 'ALL PASS' : gatesStatus.failing.length > 0 ? `FAILING: ${gatesStatus.failing.join(', ')}` : 'Not yet run'}

---

# PROJECT CONTEXT (Middle - Architecture/Docs)

## Project Files (${files.length} total):
${fileList}

## Eagle Sight Docs:
- brainlift.md: ${hasbrainlift ? 'exists' : 'missing'}
- prd.md: ${hasPrd ? 'exists' : 'missing'}  
- gameplan.md: ${hasGameplan ? 'exists' : 'missing'}

${brainliftContent ? `brainlift.md preview:\n${brainliftContent.slice(0, 300)}` : ''}

## Infrastructure:
- Tests: ${hasTests ? 'yes' : 'no'}
- Dockerfile/compose: ${hasDockerfile ? 'yes' : 'no'}
- CI/CD: ${hasCI ? 'yes' : 'no'}

## Code Samples:
${codeSamples || 'No code files yet'}

---

# RECENT CONTEXT (End - High Attention)

## Unresolved Errors:
${errorContext}

## Recent Activity:
${activityContext}

## Journal (Most Recent Conversations):
${journalContext}

---

Based on ALL evidence above, determine:
1. Verify/adjust the current phase and step
2. What's completed
3. What's the single most important next action
4. Specific prompt for Cursor (actionable, one task)

CRITICAL: If gates are failing (build/tests/lint), the next action MUST be to fix them.
If there are unresolved errors with multiple fix attempts, suggest Tornado debugging.

Respond ONLY with valid JSON:
{
  "phase": "EAGLE_SIGHT" | "BUILD" | "SHIP" | "GROW" | "IDLE",
  "step": "step name",
  "summary": "one-line project summary",
  "techStack": ["tech1", "tech2"],
  "whatsDone": ["done1", "done2"],
  "whatsNext": "specific next action",
  "suggestedPrompt": "exact prompt to paste in Cursor",
  "confidence": 0-100
}`;

  try {
    const response = await callClaude(prompt, 
      'You are Midas, a Golden Code coach. Analyze projects and determine their exact phase in the development lifecycle. Be specific and actionable. Respond only with valid JSON.'
    );
    
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
  };
}
