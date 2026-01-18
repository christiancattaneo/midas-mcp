/**
 * Context Management for Midas
 * 
 * Comprehensive context budget tracking, tier-based content management,
 * and compaction alerts for optimal LLM context window usage.
 * 
 * Key concepts:
 * - Token estimation for prompt building
 * - Global session-wide context budget tracking
 * - Tier-based content aging (hot → warm → cold → frozen)
 * - Compaction threshold monitoring and alerts
 * - Context saturation reporting
 * 
 * Optimal context saturation for Claude Opus 4.5:
 * - 0-60%: Peak quality
 * - 60-80%: Excellent quality (recommended working range)
 * - 80-90%: Good quality, slight drift risk
 * - 90%+: Auto-compaction triggers, quality degrades
 */

import { existsSync, mkdirSync } from 'fs';
import { readFileSync } from 'fs';
import writeFileAtomic from 'write-file-atomic';
import { join } from 'path';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default context window size for Claude Opus 4.5 */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Saturation thresholds as percentages */
export const SATURATION_THRESHOLDS = {
  /** Optimal working range ceiling */
  OPTIMAL: 0.60,
  /** Warning threshold - quality may degrade */
  WARNING: 0.80,
  /** Critical threshold - compaction recommended */
  CRITICAL: 0.90,
  /** Emergency threshold - forced compaction */
  EMERGENCY: 0.95,
} as const;

/** Maximum items in each tier */
export const TIER_LIMITS = {
  HOT: 20,      // Recent active items (full detail)
  WARM: 50,     // Session history (full detail)
  COLD: 100,    // Summarized content
  FROZEN: 200,  // Compressed references only
} as const;

/** Token budgets per tier (approximate) */
export const TIER_BUDGETS = {
  HOT: 40_000,     // 0-40K: current task, active files
  WARM: 40_000,    // 40K-80K: session history
  COLD: 40_000,    // 80K-120K: summaries
  FROZEN: 20_000,  // 120K-140K: compressed refs
} as const;

/** Content types for tier classification */
export type ContentType = 
  | 'task'           // Current task/prompt
  | 'file'           // Source file content
  | 'error'          // Error messages/logs
  | 'response'       // AI responses
  | 'summary'        // Summarized content
  | 'reference'      // Compressed reference
  | 'system'         // System prompts
  | 'metadata';      // Metadata/state info

/** Content tier levels */
export type ContentTier = 'hot' | 'warm' | 'cold' | 'frozen';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A piece of content in the context budget
 */
export interface ContextItem {
  id: string;
  content: string;
  tokens: number;
  type: ContentType;
  tier: ContentTier;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  /** Original content before summarization (for cold/frozen) */
  originalTokens?: number;
  /** Whether this item has been summarized */
  summarized: boolean;
  /** Priority (higher = more important to keep) */
  priority: number;
}

/**
 * Context budget state
 */
export interface ContextBudget {
  /** Maximum tokens available */
  maxTokens: number;
  /** Currently used tokens */
  usedTokens: number;
  /** Items by tier */
  tiers: {
    hot: ContextItem[];
    warm: ContextItem[];
    cold: ContextItem[];
    frozen: ContextItem[];
  };
  /** Last compaction timestamp */
  lastCompaction: number;
  /** Compaction history */
  compactionHistory: Array<{
    timestamp: number;
    beforeTokens: number;
    afterTokens: number;
    itemsCompacted: number;
  }>;
  /** Session start time */
  sessionStart: number;
}

/**
 * Saturation status report
 */
export interface SaturationReport {
  /** Current saturation percentage (0-1) */
  saturation: number;
  /** Current saturation level name */
  level: 'optimal' | 'warning' | 'critical' | 'emergency';
  /** Tokens used */
  usedTokens: number;
  /** Tokens available */
  maxTokens: number;
  /** Tokens remaining */
  remainingTokens: number;
  /** Per-tier breakdown */
  tierBreakdown: {
    hot: { items: number; tokens: number };
    warm: { items: number; tokens: number };
    cold: { items: number; tokens: number };
    frozen: { items: number; tokens: number };
  };
  /** Recommendations */
  recommendations: string[];
  /** Whether compaction is recommended */
  compactionRecommended: boolean;
  /** Estimated tokens that could be freed by compaction */
  potentialSavings: number;
}

/**
 * Compaction result
 */
export interface CompactionResult {
  success: boolean;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  itemsCompacted: number;
  itemsDropped: number;
  duration: number;
}

// ============================================================================
// TOKEN ESTIMATION
// ============================================================================

/**
 * Estimate token count for text
 * Uses 1 token ≈ 4 chars for English as baseline,
 * with adjustments for code and special characters
 */
export function estimateTokens(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  
  const length = text.length;
  if (length === 0) return 0;
  
  // Base estimate: 4 chars per token
  let estimate = Math.ceil(length / 4);
  
  // Adjust for code (more symbols = more tokens)
  // Only apply adjustment for strings with enough chars to matter
  if (length > 10) {
    const symbolDensity = countSymbols(text) / length;
    if (symbolDensity > 0.15) {
      // High symbol density (likely code): 3 chars per token
      estimate = Math.ceil(length / 3);
    }
    
    // Adjust for unicode (non-ASCII uses more tokens)
    // Only apply for significant unicode content
    const unicodeRatio = countUnicode(text) / length;
    if (unicodeRatio > 0.1) {
      estimate = Math.ceil(estimate * (1 + unicodeRatio));
    }
  }
  
  // Minimum 1 token for non-empty strings
  return Math.max(1, estimate);
}

/**
 * Count programming symbols in text
 */
function countSymbols(text: string): number {
  const symbols = text.match(/[{}()\[\]<>;:,.!?@#$%^&*+=|\\\/~`'"]/g);
  return symbols ? symbols.length : 0;
}

/**
 * Count non-ASCII characters
 */
function countUnicode(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) count++;
  }
  return count;
}

/**
 * Estimate tokens for structured data (JSON-like)
 */
export function estimateStructuredTokens(data: unknown): number {
  try {
    const json = JSON.stringify(data);
    return estimateTokens(json);
  } catch {
    return 0;
  }
}

// ============================================================================
// CONTEXT BUDGET MANAGEMENT
// ============================================================================

/**
 * Create a new context budget
 */
export function createContextBudget(maxTokens: number = DEFAULT_CONTEXT_WINDOW): ContextBudget {
  return {
    maxTokens,
    usedTokens: 0,
    tiers: {
      hot: [],
      warm: [],
      cold: [],
      frozen: [],
    },
    lastCompaction: 0,
    compactionHistory: [],
    sessionStart: Date.now(),
  };
}

/**
 * Calculate current saturation
 */
export function calculateSaturation(budget: ContextBudget): number {
  if (budget.maxTokens <= 0) return 1;
  return budget.usedTokens / budget.maxTokens;
}

/**
 * Get saturation level name
 */
export function getSaturationLevel(saturation: number): 'optimal' | 'warning' | 'critical' | 'emergency' {
  if (saturation >= SATURATION_THRESHOLDS.EMERGENCY) return 'emergency';
  if (saturation >= SATURATION_THRESHOLDS.CRITICAL) return 'critical';
  if (saturation >= SATURATION_THRESHOLDS.WARNING) return 'warning';
  return 'optimal';
}

/**
 * Generate saturation report
 */
export function getSaturationReport(budget: ContextBudget): SaturationReport {
  const saturation = calculateSaturation(budget);
  const level = getSaturationLevel(saturation);
  
  const tierBreakdown = {
    hot: { items: budget.tiers.hot.length, tokens: sumTokens(budget.tiers.hot) },
    warm: { items: budget.tiers.warm.length, tokens: sumTokens(budget.tiers.warm) },
    cold: { items: budget.tiers.cold.length, tokens: sumTokens(budget.tiers.cold) },
    frozen: { items: budget.tiers.frozen.length, tokens: sumTokens(budget.tiers.frozen) },
  };
  
  const recommendations: string[] = [];
  let potentialSavings = 0;
  
  // Check each tier for issues
  if (budget.tiers.hot.length > TIER_LIMITS.HOT) {
    recommendations.push(`Hot tier over limit (${budget.tiers.hot.length}/${TIER_LIMITS.HOT}). Age oldest items to warm.`);
  }
  
  if (budget.tiers.warm.length > TIER_LIMITS.WARM) {
    recommendations.push(`Warm tier over limit. Consider summarizing to cold tier.`);
    potentialSavings += Math.floor(tierBreakdown.warm.tokens * 0.5); // Summarization saves ~50%
  }
  
  if (level === 'warning') {
    recommendations.push('Approaching 80% saturation. Consider proactive compaction.');
    potentialSavings += estimatePotentialSavings(budget);
  }
  
  if (level === 'critical') {
    recommendations.push('At 90%+ saturation. Compaction strongly recommended.');
    potentialSavings += estimatePotentialSavings(budget);
  }
  
  if (level === 'emergency') {
    recommendations.push('EMERGENCY: At 95%+ saturation. Immediate compaction required.');
    potentialSavings += estimatePotentialSavings(budget);
  }
  
  // Check for stale hot items
  const now = Date.now();
  const staleHot = budget.tiers.hot.filter(item => now - item.lastAccessedAt > 5 * 60 * 1000);
  if (staleHot.length > 0) {
    recommendations.push(`${staleHot.length} hot items not accessed in 5+ minutes. Consider aging.`);
  }
  
  return {
    saturation,
    level,
    usedTokens: budget.usedTokens,
    maxTokens: budget.maxTokens,
    remainingTokens: budget.maxTokens - budget.usedTokens,
    tierBreakdown,
    recommendations,
    compactionRecommended: level !== 'optimal' || recommendations.length > 2,
    potentialSavings,
  };
}

/**
 * Sum tokens in item array
 */
function sumTokens(items: ContextItem[]): number {
  return items.reduce((sum, item) => sum + item.tokens, 0);
}

/**
 * Estimate potential savings from compaction
 */
function estimatePotentialSavings(budget: ContextBudget): number {
  let savings = 0;
  
  // Warm items can be summarized (save ~50%)
  savings += Math.floor(sumTokens(budget.tiers.warm) * 0.5);
  
  // Cold items can be compressed (save ~70%)
  savings += Math.floor(sumTokens(budget.tiers.cold) * 0.7);
  
  // Frozen items can be dropped
  savings += sumTokens(budget.tiers.frozen);
  
  return savings;
}

// ============================================================================
// CONTENT MANAGEMENT
// ============================================================================

/**
 * Generate unique ID for context item
 */
function generateId(): string {
  return `ctx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Add content to the context budget
 */
export function addContent(
  budget: ContextBudget,
  content: string,
  type: ContentType,
  options: { priority?: number; tier?: ContentTier } = {}
): ContextItem {
  const tokens = estimateTokens(content);
  const now = Date.now();
  const tier = options.tier ?? 'hot';
  
  const item: ContextItem = {
    id: generateId(),
    content,
    tokens,
    type,
    tier,
    createdAt: now,
    lastAccessedAt: now,
    accessCount: 1,
    summarized: false,
    priority: options.priority ?? getPriorityForType(type),
  };
  
  // Add to appropriate tier
  budget.tiers[tier].push(item);
  budget.usedTokens += tokens;
  
  return item;
}

/**
 * Get default priority for content type
 */
function getPriorityForType(type: ContentType): number {
  const priorities: Record<ContentType, number> = {
    system: 100,     // Never drop system prompts
    task: 90,        // Current task is critical
    error: 80,       // Errors are important for debugging
    file: 70,        // Source files are valuable
    response: 60,    // AI responses provide continuity
    summary: 50,     // Summaries are already condensed
    metadata: 40,    // Metadata is recoverable
    reference: 30,   // References can be re-fetched
  };
  return priorities[type] ?? 50;
}

/**
 * Access an item (updates access time and count)
 */
export function accessItem(budget: ContextBudget, itemId: string): ContextItem | null {
  for (const tier of ['hot', 'warm', 'cold', 'frozen'] as const) {
    const item = budget.tiers[tier].find(i => i.id === itemId);
    if (item) {
      item.lastAccessedAt = Date.now();
      item.accessCount++;
      return item;
    }
  }
  return null;
}

/**
 * Remove an item from the budget
 */
export function removeItem(budget: ContextBudget, itemId: string): boolean {
  for (const tier of ['hot', 'warm', 'cold', 'frozen'] as const) {
    const index = budget.tiers[tier].findIndex(i => i.id === itemId);
    if (index !== -1) {
      const item = budget.tiers[tier][index];
      budget.tiers[tier].splice(index, 1);
      budget.usedTokens -= item.tokens;
      return true;
    }
  }
  return false;
}

/**
 * Move item to a different tier
 */
export function moveToTier(
  budget: ContextBudget,
  itemId: string,
  targetTier: ContentTier
): boolean {
  for (const tier of ['hot', 'warm', 'cold', 'frozen'] as const) {
    const index = budget.tiers[tier].findIndex(i => i.id === itemId);
    if (index !== -1) {
      const item = budget.tiers[tier].splice(index, 1)[0];
      item.tier = targetTier;
      budget.tiers[targetTier].push(item);
      return true;
    }
  }
  return false;
}

// ============================================================================
// TIER AGING
// ============================================================================

/**
 * Age items based on access patterns and time
 * Moves items down tiers: hot → warm → cold → frozen
 */
export function ageItems(
  budget: ContextBudget,
  options: {
    hotMaxAge?: number;    // Max ms before hot → warm (default: 5 min)
    warmMaxAge?: number;   // Max ms before warm → cold (default: 15 min)
    coldMaxAge?: number;   // Max ms before cold → frozen (default: 30 min)
    maxAccessAge?: number; // Max ms since last access (default: 10 min)
  } = {}
): { aged: number; byTier: Record<ContentTier, number> } {
  const {
    hotMaxAge = 5 * 60 * 1000,
    warmMaxAge = 15 * 60 * 1000,
    coldMaxAge = 30 * 60 * 1000,
    maxAccessAge = 10 * 60 * 1000,
  } = options;
  
  const now = Date.now();
  const result = { aged: 0, byTier: { hot: 0, warm: 0, cold: 0, frozen: 0 } };
  
  // Process hot → warm
  const hotToAge = budget.tiers.hot.filter(item => {
    const age = now - item.createdAt;
    const accessAge = now - item.lastAccessedAt;
    // System and task items don't age
    if (item.type === 'system' || item.type === 'task') return false;
    return age > hotMaxAge || accessAge > maxAccessAge;
  });
  
  for (const item of hotToAge) {
    moveToTier(budget, item.id, 'warm');
    result.aged++;
    result.byTier.hot++;
  }
  
  // Process warm → cold
  const warmToAge = budget.tiers.warm.filter(item => {
    const age = now - item.createdAt;
    const accessAge = now - item.lastAccessedAt;
    if (item.type === 'system') return false;
    return age > warmMaxAge || accessAge > maxAccessAge * 2;
  });
  
  for (const item of warmToAge) {
    moveToTier(budget, item.id, 'cold');
    result.aged++;
    result.byTier.warm++;
  }
  
  // Process cold → frozen
  const coldToAge = budget.tiers.cold.filter(item => {
    const age = now - item.createdAt;
    if (item.type === 'system') return false;
    return age > coldMaxAge;
  });
  
  for (const item of coldToAge) {
    moveToTier(budget, item.id, 'frozen');
    result.aged++;
    result.byTier.cold++;
  }
  
  return result;
}

// ============================================================================
// COMPACTION
// ============================================================================

/**
 * Compact the context budget by summarizing and dropping content
 * 
 * Strategy:
 * 1. Drop frozen items with low priority
 * 2. Compress cold items to references
 * 3. Summarize warm items
 * 4. Age hot items if needed
 */
export function compactBudget(
  budget: ContextBudget,
  options: {
    targetSaturation?: number;  // Target saturation after compaction (default: 0.6)
    preserveTypes?: ContentType[];  // Types to never drop
    summarizer?: (content: string, targetTokens: number) => string;  // Custom summarizer
  } = {}
): CompactionResult {
  const startTime = Date.now();
  const {
    targetSaturation = SATURATION_THRESHOLDS.OPTIMAL,
    preserveTypes = ['system', 'task', 'error'],
    summarizer = (c, t) => truncateWithPreservation(c, t),
  } = options;
  
  const tokensBefore = budget.usedTokens;
  let itemsCompacted = 0;
  let itemsDropped = 0;
  
  const targetTokens = Math.floor(budget.maxTokens * targetSaturation);
  
  // Phase 1: Drop frozen items (lowest priority first)
  if (budget.usedTokens > targetTokens) {
    const frozenSorted = [...budget.tiers.frozen].sort((a, b) => a.priority - b.priority);
    for (const item of frozenSorted) {
      if (budget.usedTokens <= targetTokens) break;
      if (preserveTypes.includes(item.type)) continue;
      removeItem(budget, item.id);
      itemsDropped++;
    }
  }
  
  // Phase 2: Compress cold items to minimal references
  if (budget.usedTokens > targetTokens) {
    for (const item of [...budget.tiers.cold]) {
      if (budget.usedTokens <= targetTokens) break;
      if (preserveTypes.includes(item.type)) continue;
      
      // Compress to ~10% of original
      const targetSize = Math.max(20, Math.floor(item.tokens * 0.1));
      const compressed = summarizer(item.content, targetSize * 4); // chars, not tokens
      
      const tokenSaved = item.tokens - estimateTokens(compressed);
      item.originalTokens = item.tokens;
      item.content = compressed;
      item.tokens = estimateTokens(compressed);
      item.summarized = true;
      budget.usedTokens -= tokenSaved;
      
      moveToTier(budget, item.id, 'frozen');
      itemsCompacted++;
    }
  }
  
  // Phase 3: Summarize warm items to ~30% size
  if (budget.usedTokens > targetTokens) {
    for (const item of [...budget.tiers.warm]) {
      if (budget.usedTokens <= targetTokens) break;
      if (preserveTypes.includes(item.type)) continue;
      if (item.summarized) continue;
      
      const targetSize = Math.max(50, Math.floor(item.tokens * 0.3));
      const summarized = summarizer(item.content, targetSize * 4);
      
      const tokenSaved = item.tokens - estimateTokens(summarized);
      item.originalTokens = item.tokens;
      item.content = summarized;
      item.tokens = estimateTokens(summarized);
      item.summarized = true;
      budget.usedTokens -= tokenSaved;
      
      moveToTier(budget, item.id, 'cold');
      itemsCompacted++;
    }
  }
  
  // Phase 4: Force age hot items if still over budget
  if (budget.usedTokens > targetTokens) {
    ageItems(budget, { hotMaxAge: 0, warmMaxAge: 0, coldMaxAge: 0 });
  }
  
  // Record compaction in history
  const tokensAfter = budget.usedTokens;
  budget.lastCompaction = Date.now();
  budget.compactionHistory.push({
    timestamp: budget.lastCompaction,
    beforeTokens: tokensBefore,
    afterTokens: tokensAfter,
    itemsCompacted: itemsCompacted + itemsDropped,
  });
  
  // Keep history bounded
  if (budget.compactionHistory.length > 100) {
    budget.compactionHistory = budget.compactionHistory.slice(-50);
  }
  
  return {
    success: tokensAfter < tokensBefore || itemsCompacted > 0 || itemsDropped > 0,
    tokensBefore,
    tokensAfter,
    tokensSaved: tokensBefore - tokensAfter,
    itemsCompacted,
    itemsDropped,
    duration: Date.now() - startTime,
  };
}

/**
 * Truncate content while preserving important parts
 */
function truncateWithPreservation(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  
  const lines = content.split('\n');
  
  // If just a few lines, take from beginning
  if (lines.length <= 5) {
    return content.slice(0, maxChars - 3) + '...';
  }
  
  // Take first and last lines (often most important)
  const firstLines = lines.slice(0, 2).join('\n');
  const lastLines = lines.slice(-2).join('\n');
  
  const available = maxChars - firstLines.length - lastLines.length - 10;
  if (available > 50) {
    // Add some middle context
    const middleStart = Math.floor(lines.length / 2) - 1;
    const middleLines = lines.slice(middleStart, middleStart + 2).join('\n').slice(0, available);
    return `${firstLines}\n...\n${middleLines}\n...\n${lastLines}`;
  }
  
  return `${firstLines}\n...\n${lastLines}`;
}

// ============================================================================
// PERSISTENCE
// ============================================================================

const CONTEXT_FILE = 'context-budget.json';
const MIDAS_DIR = '.midas';

/**
 * Get context budget file path
 */
function getContextPath(projectPath: string): string {
  return join(projectPath, MIDAS_DIR, CONTEXT_FILE);
}

/**
 * Save context budget to disk
 */
export function saveContextBudget(projectPath: string, budget: ContextBudget): boolean {
  try {
    const dir = join(projectPath, MIDAS_DIR);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    const path = getContextPath(projectPath);
    writeFileAtomic.sync(path, JSON.stringify(budget, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load context budget from disk
 */
export function loadContextBudget(
  projectPath: string,
  defaultMaxTokens: number = DEFAULT_CONTEXT_WINDOW
): ContextBudget {
  try {
    const path = getContextPath(projectPath);
    if (!existsSync(path)) {
      return createContextBudget(defaultMaxTokens);
    }
    
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    
    // Validate structure
    if (!data || typeof data.usedTokens !== 'number' || !data.tiers) {
      return createContextBudget(defaultMaxTokens);
    }
    
    return data as ContextBudget;
  } catch {
    return createContextBudget(defaultMaxTokens);
  }
}

/**
 * Clear context budget (for new session)
 */
export function clearContextBudget(projectPath: string): ContextBudget {
  const budget = createContextBudget();
  saveContextBudget(projectPath, budget);
  return budget;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get all items across all tiers
 */
export function getAllItems(budget: ContextBudget): ContextItem[] {
  return [
    ...budget.tiers.hot,
    ...budget.tiers.warm,
    ...budget.tiers.cold,
    ...budget.tiers.frozen,
  ];
}

/**
 * Find item by ID
 */
export function findItem(budget: ContextBudget, itemId: string): ContextItem | null {
  for (const tier of ['hot', 'warm', 'cold', 'frozen'] as const) {
    const item = budget.tiers[tier].find(i => i.id === itemId);
    if (item) return item;
  }
  return null;
}

/**
 * Count items by type
 */
export function countByType(budget: ContextBudget): Record<ContentType, number> {
  const counts: Record<ContentType, number> = {
    task: 0,
    file: 0,
    error: 0,
    response: 0,
    summary: 0,
    reference: 0,
    system: 0,
    metadata: 0,
  };
  
  for (const item of getAllItems(budget)) {
    counts[item.type]++;
  }
  
  return counts;
}

/**
 * Get budget statistics
 */
export function getBudgetStats(budget: ContextBudget): {
  totalItems: number;
  usedTokens: number;
  maxTokens: number;
  saturation: number;
  sessionAge: number;
  compactionCount: number;
  averageItemSize: number;
} {
  const items = getAllItems(budget);
  return {
    totalItems: items.length,
    usedTokens: budget.usedTokens,
    maxTokens: budget.maxTokens,
    saturation: calculateSaturation(budget),
    sessionAge: Date.now() - budget.sessionStart,
    compactionCount: budget.compactionHistory.length,
    averageItemSize: items.length > 0 ? Math.floor(budget.usedTokens / items.length) : 0,
  };
}

/**
 * Validate budget integrity (recalculate tokens)
 */
export function validateBudget(budget: ContextBudget): {
  valid: boolean;
  expectedTokens: number;
  actualTokens: number;
  discrepancy: number;
} {
  let expectedTokens = 0;
  for (const item of getAllItems(budget)) {
    expectedTokens += item.tokens;
  }
  
  const discrepancy = Math.abs(expectedTokens - budget.usedTokens);
  
  return {
    valid: discrepancy === 0,
    expectedTokens,
    actualTokens: budget.usedTokens,
    discrepancy,
  };
}

/**
 * Repair budget by recalculating tokens
 */
export function repairBudget(budget: ContextBudget): void {
  let total = 0;
  for (const item of getAllItems(budget)) {
    // Recalculate token count
    item.tokens = estimateTokens(item.content);
    total += item.tokens;
  }
  budget.usedTokens = total;
}
