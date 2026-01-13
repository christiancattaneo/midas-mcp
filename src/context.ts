/**
 * Context Compression and Management for Midas
 * 
 * Implements the "Lost in the Middle" principle:
 * - BEGINNING: Stable context (methodology, current phase)
 * - MIDDLE: Project context (summarized)
 * - END: Recent context (full detail)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { loadState, type Phase, PHASE_INFO } from './state/phase.js';
import { loadTracker, getGatesStatus, getUnresolvedErrors, type TrackerState } from './tracker.js';
import { getJournalEntries } from './tools/journal.js';
import { sanitizePath } from './security.js';

const MIDAS_DIR = '.midas';
const CACHE_FILE = 'context-cache.json';

// Token estimation (rough: 1 token ≈ 4 chars for English)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ============================================================================
// CONTEXT LAYERS
// ============================================================================

export interface ContextLayer {
  name: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  position: 'beginning' | 'middle' | 'end';
  content: string;
  tokens: number;
}

export interface CompressedContext {
  layers: ContextLayer[];
  totalTokens: number;
  truncated: boolean;
}

// ============================================================================
// SUMMARIZATION CACHE
// ============================================================================

interface SummaryCache {
  [key: string]: {
    summary: string;
    timestamp: number;
    originalTokens: number;
    summaryTokens: number;
  };
}

function getCachePath(projectPath: string): string {
  return join(projectPath, MIDAS_DIR, CACHE_FILE);
}

function loadCache(projectPath: string): SummaryCache {
  const path = getCachePath(projectPath);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveCache(projectPath: string, cache: SummaryCache): void {
  const dir = join(projectPath, MIDAS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getCachePath(projectPath), JSON.stringify(cache, null, 2));
}

export function getCachedSummary(projectPath: string, content: string, maxTokens: number): string | null {
  const cache = loadCache(projectPath);
  const key = `${simpleHash(content)}-${maxTokens}`;
  const entry = cache[key];
  
  if (entry && Date.now() - entry.timestamp < 3600000) { // 1 hour cache
    return entry.summary;
  }
  return null;
}

export function setCachedSummary(projectPath: string, content: string, maxTokens: number, summary: string): void {
  const cache = loadCache(projectPath);
  const key = `${simpleHash(content)}-${maxTokens}`;
  
  cache[key] = {
    summary,
    timestamp: Date.now(),
    originalTokens: estimateTokens(content),
    summaryTokens: estimateTokens(summary),
  };
  
  // Keep cache size reasonable (max 100 entries)
  const keys = Object.keys(cache);
  if (keys.length > 100) {
    const oldest = keys
      .sort((a, b) => cache[a].timestamp - cache[b].timestamp)
      .slice(0, 20);
    oldest.forEach(k => delete cache[k]);
  }
  
  saveCache(projectPath, cache);
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStats(projectPath: string): {
  entries: number;
  totalOriginalTokens: number;
  totalSummaryTokens: number;
  tokensSaved: number;
  hitRate?: number;
} {
  const cache = loadCache(projectPath);
  const entries = Object.values(cache);
  
  const totalOriginal = entries.reduce((sum, e) => sum + e.originalTokens, 0);
  const totalSummary = entries.reduce((sum, e) => sum + e.summaryTokens, 0);
  
  return {
    entries: entries.length,
    totalOriginalTokens: totalOriginal,
    totalSummaryTokens: totalSummary,
    tokensSaved: totalOriginal - totalSummary,
  };
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// ============================================================================
// COMPRESSION STRATEGIES
// ============================================================================

/**
 * Truncate text to approximate token limit, preferring sentence boundaries
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= maxTokens) return text;
  
  const targetChars = maxTokens * 4;
  let truncated = text.slice(0, targetChars);
  
  // Try to end at sentence boundary
  const lastPeriod = truncated.lastIndexOf('. ');
  const lastNewline = truncated.lastIndexOf('\n');
  const boundary = Math.max(lastPeriod, lastNewline);
  
  if (boundary > targetChars * 0.7) {
    truncated = truncated.slice(0, boundary + 1);
  }
  
  return truncated + '...';
}

/**
 * Extract key points from text (simple keyword-based)
 */
export function extractKeyPoints(text: string, maxPoints: number = 5): string[] {
  const lines = text.split('\n').filter(l => l.trim());
  const points: string[] = [];
  
  // Prioritize lines with key indicators
  const keyIndicators = ['error', 'fix', 'implement', 'test', 'build', 'deploy', 'decision', 'chose', 'because'];
  
  for (const line of lines) {
    if (points.length >= maxPoints) break;
    const lower = line.toLowerCase();
    if (keyIndicators.some(k => lower.includes(k))) {
      points.push(line.trim().slice(0, 100));
    }
  }
  
  // Fill with first lines if not enough
  for (const line of lines) {
    if (points.length >= maxPoints) break;
    if (!points.includes(line.trim().slice(0, 100))) {
      points.push(line.trim().slice(0, 100));
    }
  }
  
  return points;
}

/**
 * Summarize journal entries to titles + key decisions
 */
export function summarizeJournalEntries(entries: Array<{ title: string; conversation: string; timestamp: string }>): string {
  if (entries.length === 0) return 'No journal entries.';
  
  const lines: string[] = [];
  for (const entry of entries.slice(0, 5)) {
    const date = entry.timestamp.slice(0, 10);
    const keyPoints = extractKeyPoints(entry.conversation, 2);
    lines.push(`- ${date}: ${entry.title}`);
    keyPoints.forEach(p => lines.push(`  > ${p.slice(0, 80)}`));
  }
  
  return lines.join('\n');
}

// ============================================================================
// CONTEXT BUILDING
// ============================================================================

const METHODOLOGY_COMPRESSED = `Golden Code: PLAN (plan) → BUILD (code) → SHIP (deploy) → GROW (iterate)
BUILD cycle: RULES → INDEX → READ → RESEARCH → IMPLEMENT → TEST → DEBUG
If stuck: Tornado (research + logs + tests). If output doesn't fit: Horizon (expand context).
Gates must pass (build/test/lint) before advancing.`;

export function buildCompressedContext(
  projectPath: string,
  options: {
    maxTokens?: number;
    includeCode?: boolean;
    taskDescription?: string;
  } = {}
): CompressedContext {
  const safePath = sanitizePath(projectPath);
  const maxTokens = options.maxTokens || 4000;
  
  const layers: ContextLayer[] = [];
  let totalTokens = 0;
  
  // ─────────────────────────────────────────────────────────────────────────
  // BEGINNING: Stable context (high attention)
  // ─────────────────────────────────────────────────────────────────────────
  
  // Layer 1: Methodology (always, ~100 tokens)
  layers.push({
    name: 'methodology',
    priority: 'critical',
    position: 'beginning',
    content: METHODOLOGY_COMPRESSED,
    tokens: estimateTokens(METHODOLOGY_COMPRESSED),
  });
  
  // Layer 2: Current state
  const state = loadState(safePath);
  const tracker = loadTracker(safePath);
  const gatesStatus = getGatesStatus(safePath);
  
  const stateContent = [
    `Phase: ${state.current.phase}${'step' in state.current ? ` → ${state.current.step}` : ''}`,
    `Gates: ${gatesStatus.allPass ? 'ALL PASS' : gatesStatus.failing.length > 0 ? `FAILING: ${gatesStatus.failing.join(', ')}` : 'not run'}`,
    tracker.currentTask ? `Task: ${tracker.currentTask.description}` : '',
  ].filter(Boolean).join('\n');
  
  layers.push({
    name: 'current_state',
    priority: 'critical',
    position: 'beginning',
    content: stateContent,
    tokens: estimateTokens(stateContent),
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // MIDDLE: Project context (lower attention, summarized)
  // ─────────────────────────────────────────────────────────────────────────
  
  // Layer 3: Journal summaries
  const journalEntries = getJournalEntries({ projectPath: safePath, limit: 5 });
  const journalSummary = summarizeJournalEntries(journalEntries);
  
  layers.push({
    name: 'journal_summary',
    priority: 'medium',
    position: 'middle',
    content: `Past sessions:\n${journalSummary}`,
    tokens: estimateTokens(journalSummary),
  });
  
  // Layer 4: Recent files (just names)
  if (tracker.recentFiles.length > 0) {
    const fileList = tracker.recentFiles.slice(0, 10).map(f => f.path).join(', ');
    layers.push({
      name: 'recent_files',
      priority: 'low',
      position: 'middle',
      content: `Recently modified: ${fileList}`,
      tokens: estimateTokens(fileList) + 20,
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // END: Recent context (high attention, full detail)
  // ─────────────────────────────────────────────────────────────────────────
  
  // Layer 5: Unresolved errors (FULL - critical for debugging)
  const errors = getUnresolvedErrors(safePath);
  if (errors.length > 0) {
    const errorContent = errors.slice(0, 3).map(e => {
      const attempts = e.fixAttempts.length > 0 
        ? ` (tried ${e.fixAttempts.length}x: ${e.fixAttempts.map(a => a.approach).join(', ')})`
        : '';
      return `ERROR: ${e.error}${attempts}`;
    }).join('\n\n');
    
    layers.push({
      name: 'errors',
      priority: 'high',
      position: 'end',
      content: errorContent,
      tokens: estimateTokens(errorContent),
    });
  }
  
  // Layer 6: Recent tool calls
  if (tracker.recentToolCalls.length > 0) {
    const toolContent = tracker.recentToolCalls.slice(0, 5).map(t => {
      const ago = Math.round((Date.now() - t.timestamp) / 60000);
      return `${t.tool} (${ago}m ago)`;
    }).join('\n');
    
    layers.push({
      name: 'recent_tools',
      priority: 'medium',
      position: 'end',
      content: `Recent actions:\n${toolContent}`,
      tokens: estimateTokens(toolContent) + 20,
    });
  }
  
  // Layer 7: Current task (if set)
  if (options.taskDescription) {
    layers.push({
      name: 'current_task',
      priority: 'critical',
      position: 'end',
      content: `CURRENT TASK: ${options.taskDescription}`,
      tokens: estimateTokens(options.taskDescription) + 20,
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // ASSEMBLE: Fit within token budget
  // ─────────────────────────────────────────────────────────────────────────
  
  // Sort by priority and position
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const positionOrder = { beginning: 0, end: 1, middle: 2 };
  
  layers.sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return positionOrder[a.position] - positionOrder[b.position];
  });
  
  // Include layers until token limit
  const included: ContextLayer[] = [];
  let usedTokens = 0;
  let truncated = false;
  
  for (const layer of layers) {
    if (usedTokens + layer.tokens <= maxTokens) {
      included.push(layer);
      usedTokens += layer.tokens;
    } else if (layer.priority === 'critical') {
      // Always include critical, even if truncated
      const available = maxTokens - usedTokens;
      if (available > 100) {
        const truncatedContent = truncateToTokens(layer.content, available);
        included.push({
          ...layer,
          content: truncatedContent,
          tokens: estimateTokens(truncatedContent),
        });
        usedTokens += estimateTokens(truncatedContent);
        truncated = true;
      }
    } else {
      truncated = true;
    }
  }
  
  // Re-sort by position for final output
  included.sort((a, b) => positionOrder[a.position] - positionOrder[b.position]);
  
  return {
    layers: included,
    totalTokens: usedTokens,
    truncated,
  };
}

/**
 * Convert compressed context to a single string for the API
 */
export function contextToString(context: CompressedContext): string {
  const sections: string[] = [];
  
  const beginning = context.layers.filter(l => l.position === 'beginning');
  const middle = context.layers.filter(l => l.position === 'middle');
  const end = context.layers.filter(l => l.position === 'end');
  
  if (beginning.length > 0) {
    sections.push('# METHODOLOGY & STATE\n' + beginning.map(l => l.content).join('\n\n'));
  }
  
  if (middle.length > 0) {
    sections.push('# PROJECT CONTEXT\n' + middle.map(l => l.content).join('\n\n'));
  }
  
  if (end.length > 0) {
    sections.push('# CURRENT SITUATION\n' + end.map(l => l.content).join('\n\n'));
  }
  
  return sections.join('\n\n---\n\n');
}

/**
 * Get context stats for debugging/monitoring
 */
export function getContextStats(projectPath: string): {
  estimatedTokens: number;
  layerBreakdown: Record<string, number>;
  compressionRatio: number;
} {
  const context = buildCompressedContext(projectPath);
  
  const layerBreakdown: Record<string, number> = {};
  for (const layer of context.layers) {
    layerBreakdown[layer.name] = layer.tokens;
  }
  
  // Estimate what full context would be
  const tracker = loadTracker(projectPath);
  const journal = getJournalEntries({ projectPath, limit: 10 });
  const fullEstimate = 
    estimateTokens(METHODOLOGY_COMPRESSED) * 5 + // Full methodology
    tracker.recentFiles.length * 500 + // File contents
    journal.reduce((sum, j) => sum + estimateTokens(j.conversation), 0);
  
  return {
    estimatedTokens: context.totalTokens,
    layerBreakdown,
    compressionRatio: fullEstimate > 0 ? context.totalTokens / fullEstimate : 1,
  };
}
