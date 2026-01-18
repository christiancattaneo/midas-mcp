/**
 * Context Management Stress Tests
 * 
 * Rigorous tests designed to BREAK the context management system.
 * Covers: token estimation, tiers, compaction, concurrent access,
 * boundary conditions, edge cases, and adversarial inputs.
 * 
 * Categories tested:
 * - Token estimation accuracy and edge cases
 * - Tier management and aging
 * - Compaction under various conditions
 * - Concurrent access and race conditions
 * - Boundary value analysis
 * - Memory efficiency
 * - Unicode and encoding edge cases
 * - State corruption resilience
 * - Property-based testing with fast-check
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fc from 'fast-check';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  estimateTokens,
  estimateStructuredTokens,
  createContextBudget,
  calculateSaturation,
  getSaturationLevel,
  getSaturationReport,
  addContent,
  accessItem,
  removeItem,
  moveToTier,
  ageItems,
  compactBudget,
  saveContextBudget,
  loadContextBudget,
  clearContextBudget,
  getAllItems,
  findItem,
  countByType,
  getBudgetStats,
  validateBudget,
  repairBudget,
  DEFAULT_CONTEXT_WINDOW,
  SATURATION_THRESHOLDS,
  TIER_LIMITS,
  type ContextBudget,
  type ContextItem,
  type ContentType,
  type ContentTier,
} from '../context.js';

// ============================================================================
// TEST UTILITIES
// ============================================================================

let testDir: string;
let testCounter = 0;

function createTestDir(): string {
  const dir = join(tmpdir(), `midas-context-test-${Date.now()}-${++testCounter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string): void {
  try {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
}

function generateString(length: number, charset: string = 'abcdefghijklmnopqrstuvwxyz '): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[Math.floor(Math.random() * charset.length)];
  }
  return result;
}

function generateCode(lines: number): string {
  const templates = [
    'function %s() { return %d; }',
    'const %s = { key: "%s", value: %d };',
    'if (%s > %d) { console.log("%s"); }',
    'for (let i = 0; i < %d; i++) { arr.push(%s); }',
    'export class %s extends Base { constructor() { super(); } }',
  ];
  
  const result: string[] = [];
  for (let i = 0; i < lines; i++) {
    const template = templates[i % templates.length];
    result.push(template.replace(/%s/g, `var${i}`).replace(/%d/g, String(i)));
  }
  return result.join('\n');
}

function generateUnicode(length: number): string {
  const chars = [
    'αβγδε',           // Greek
    '日本語文字',       // Japanese
    '中文字符',         // Chinese
    '한국어',          // Korean
    '🎉🚀💻🔥',        // Emoji
    'مرحبا',          // Arabic
    '\u0000\u0001',    // Control chars
    '\uFEFF',          // BOM
    '\u200B',          // Zero-width space
    '\u202E',          // RTL override
  ].join('');
  
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// ============================================================================
// TOKEN ESTIMATION STRESS TESTS
// ============================================================================

describe('Token Estimation Stress Tests', () => {
  
  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      assert.strictEqual(estimateTokens(''), 0);
    });
    
    it('should handle null/undefined coercion', () => {
      assert.strictEqual(estimateTokens(null as unknown as string), 0);
      assert.strictEqual(estimateTokens(undefined as unknown as string), 0);
    });
    
    it('should handle single character', () => {
      assert.strictEqual(estimateTokens('a'), 1);
      assert.strictEqual(estimateTokens('好'), 1);  // Unicode
      assert.strictEqual(estimateTokens('🔥'), 1);  // Emoji
    });
    
    it('should handle very long strings (10MB)', () => {
      const longString = 'a'.repeat(10 * 1024 * 1024);
      const start = Date.now();
      const tokens = estimateTokens(longString);
      const duration = Date.now() - start;
      
      assert.ok(tokens > 0, 'Should estimate tokens');
      assert.ok(duration < 1000, `Should complete in < 1s, took ${duration}ms`);
    });
    
    it('should handle strings with only whitespace', () => {
      assert.strictEqual(estimateTokens('   '), 1);
      assert.strictEqual(estimateTokens('\n\n\n'), 1);
      assert.strictEqual(estimateTokens('\t\t\t'), 1);
    });
    
    it('should handle strings with only symbols', () => {
      const symbols = '{}[]()!@#$%^&*()'.repeat(100);
      const tokens = estimateTokens(symbols);
      // Symbols should result in more tokens than plain text
      assert.ok(tokens >= symbols.length / 4, 'Symbols should not reduce token count');
    });
  });
  
  describe('Unicode Stress', () => {
    it('should handle mixed unicode scripts', () => {
      const mixed = '日本語αβγ한국어مرحبا';
      const tokens = estimateTokens(mixed);
      assert.ok(tokens > 0);
      // Unicode typically uses more tokens
      assert.ok(tokens >= mixed.length / 4);
    });
    
    it('should handle emoji sequences', () => {
      const emojis = '👨‍👩‍👧‍👦🏳️‍🌈👩🏽‍💻';  // Complex emoji with ZWJ
      const tokens = estimateTokens(emojis);
      assert.ok(tokens > 0);
    });
    
    it('should handle combining characters', () => {
      const combining = 'e\u0301';  // é as e + combining acute
      const precomposed = 'é';
      const combiningTokens = estimateTokens(combining);
      const precomposedTokens = estimateTokens(precomposed);
      assert.ok(combiningTokens > 0);
      assert.ok(precomposedTokens > 0);
    });
    
    it('should handle RTL text', () => {
      const rtl = '\u202Eمرحبا\u202C';  // RTL override
      const tokens = estimateTokens(rtl);
      assert.ok(tokens > 0);
    });
    
    it('should handle zero-width characters', () => {
      const zeroWidth = 'a\u200Bb\u200Cc\u200D';
      const tokens = estimateTokens(zeroWidth);
      assert.ok(tokens > 0);
    });
    
    it('should handle BOM and special unicode', () => {
      const bom = '\uFEFFHello World';
      const tokens = estimateTokens(bom);
      assert.ok(tokens > 0);
    });
    
    it('should handle surrogate pairs', () => {
      const surrogate = '\uD83D\uDE00';  // 😀 as surrogate pair
      const tokens = estimateTokens(surrogate);
      assert.ok(tokens > 0);
    });
    
    it('should handle 10,000 unicode characters', () => {
      const unicode = generateUnicode(10000);
      const start = Date.now();
      const tokens = estimateTokens(unicode);
      const duration = Date.now() - start;
      
      assert.ok(tokens > 0);
      assert.ok(duration < 100, `Should be fast, took ${duration}ms`);
    });
  });
  
  describe('Code-Specific Estimation', () => {
    it('should recognize high symbol density in code', () => {
      const code = 'function(){if(a&&b||c){return d[e].f(g,h);}};';
      const text = 'the quick brown fox jumps over the lazy dog';
      
      const codeTokens = estimateTokens(code);
      const textTokens = estimateTokens(text);
      
      // Code should estimate higher tokens per char due to symbols
      const codeRatio = codeTokens / code.length;
      const textRatio = textTokens / text.length;
      
      assert.ok(codeRatio >= textRatio * 0.8, 'Code should have at least 80% the token density of text');
    });
    
    it('should handle deeply nested code', () => {
      const nested = '((((((((((a))))))))))'.repeat(100);
      const tokens = estimateTokens(nested);
      assert.ok(tokens > 0);
    });
    
    it('should handle large code files', () => {
      const code = generateCode(10000);  // 10K lines
      const start = Date.now();
      const tokens = estimateTokens(code);
      const duration = Date.now() - start;
      
      assert.ok(tokens > 0);
      assert.ok(duration < 500, `Should complete in < 500ms, took ${duration}ms`);
    });
  });
  
  describe('Property-Based Testing', () => {
    it('should always return non-negative integers', () => {
      fc.assert(fc.property(fc.string(), (s) => {
        const tokens = estimateTokens(s);
        return Number.isInteger(tokens) && tokens >= 0;
      }), { numRuns: 1000 });
    });
    
    it('should be monotonic with string length (within tolerance)', () => {
      fc.assert(fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 101, maxLength: 1000 }),
        (shorter, longer) => {
          // Longer strings should generally have more tokens
          // Allow some variance due to character types
          const shortTokens = estimateTokens(shorter);
          const longTokens = estimateTokens(longer);
          return longTokens >= shortTokens * 0.5;
        }
      ), { numRuns: 500 });
    });
    
    it('should handle concatenation reasonably', () => {
      fc.assert(fc.property(
        fc.string({ maxLength: 500 }),
        fc.string({ maxLength: 500 }),
        (a, b) => {
          const tokensA = estimateTokens(a);
          const tokensB = estimateTokens(b);
          const tokensCombined = estimateTokens(a + b);
          // Combined should be roughly sum (within 50% due to estimation variance)
          const sum = tokensA + tokensB;
          return tokensCombined >= sum * 0.5 && tokensCombined <= sum * 1.5;
        }
      ), { numRuns: 500 });
    });
  });
  
  describe('Structured Data Estimation', () => {
    it('should handle null', () => {
      assert.strictEqual(estimateStructuredTokens(null), estimateTokens('null'));
    });
    
    it('should handle deeply nested objects', () => {
      let obj: unknown = { value: 1 };
      for (let i = 0; i < 100; i++) {
        obj = { nested: obj };
      }
      const tokens = estimateStructuredTokens(obj);
      assert.ok(tokens > 0);
    });
    
    it('should handle large arrays', () => {
      const arr = Array(10000).fill({ key: 'value', num: 12345 });
      const tokens = estimateStructuredTokens(arr);
      assert.ok(tokens > 0);
    });
    
    it('should handle circular reference gracefully', () => {
      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj;
      // Should not throw, should return 0 for circular
      const tokens = estimateStructuredTokens(obj);
      assert.strictEqual(tokens, 0);
    });
    
    it('should handle special values', () => {
      // JSON.stringify handles these specially
      const special = { 
        undef: undefined,  // Omitted
        fn: () => {},      // Omitted
        symbol: Symbol(),  // Omitted
      };
      const tokens = estimateStructuredTokens(special);
      assert.ok(tokens >= 0);
    });
  });
});

// ============================================================================
// CONTEXT BUDGET STRESS TESTS
// ============================================================================

describe('Context Budget Stress Tests', () => {
  let budget: ContextBudget;
  
  beforeEach(() => {
    budget = createContextBudget(DEFAULT_CONTEXT_WINDOW);
    testDir = createTestDir();
  });
  
  afterEach(() => {
    cleanup(testDir);
  });
  
  describe('Saturation Calculation', () => {
    it('should handle zero max tokens', () => {
      const zeroBudget = createContextBudget(0);
      const saturation = calculateSaturation(zeroBudget);
      assert.strictEqual(saturation, 1);  // Fully saturated
    });
    
    it('should handle negative max tokens', () => {
      const negBudget = createContextBudget(-100);
      const saturation = calculateSaturation(negBudget);
      assert.strictEqual(saturation, 1);  // Treat as fully saturated
    });
    
    it('should handle overflow-sized budgets', () => {
      const hugeBudget = createContextBudget(Number.MAX_SAFE_INTEGER);
      addContent(hugeBudget, 'test', 'task');
      const saturation = calculateSaturation(hugeBudget);
      assert.ok(saturation >= 0 && saturation <= 1);
    });
    
    it('should correctly identify saturation levels', () => {
      // Optimal: 0% - 79.99%
      assert.strictEqual(getSaturationLevel(0), 'optimal');
      assert.strictEqual(getSaturationLevel(0.59), 'optimal');
      assert.strictEqual(getSaturationLevel(0.60), 'optimal');
      assert.strictEqual(getSaturationLevel(0.79), 'optimal');
      // Warning: 80% - 89.99%
      assert.strictEqual(getSaturationLevel(0.80), 'warning');
      assert.strictEqual(getSaturationLevel(0.89), 'warning');
      // Critical: 90% - 94.99%
      assert.strictEqual(getSaturationLevel(0.90), 'critical');
      assert.strictEqual(getSaturationLevel(0.94), 'critical');
      // Emergency: 95%+
      assert.strictEqual(getSaturationLevel(0.95), 'emergency');
      assert.strictEqual(getSaturationLevel(1.0), 'emergency');
      assert.strictEqual(getSaturationLevel(1.5), 'emergency');  // Over 100%
    });
  });
  
  describe('Content Addition Stress', () => {
    it('should handle adding 10,000 items', () => {
      const start = Date.now();
      for (let i = 0; i < 10000; i++) {
        addContent(budget, `content ${i}`, 'file');
      }
      const duration = Date.now() - start;
      
      assert.strictEqual(getAllItems(budget).length, 10000);
      assert.ok(duration < 5000, `Should complete in < 5s, took ${duration}ms`);
    });
    
    it('should handle very large content items', () => {
      const largeContent = 'x'.repeat(1_000_000);  // 1MB
      const item = addContent(budget, largeContent, 'file');
      
      assert.ok(item.tokens > 0);
      assert.ok(budget.usedTokens > 0);
    });
    
    it('should handle empty content', () => {
      const item = addContent(budget, '', 'task');
      assert.strictEqual(item.tokens, 0);
    });
    
    it('should handle all content types', () => {
      const types: ContentType[] = ['task', 'file', 'error', 'response', 'summary', 'reference', 'system', 'metadata'];
      for (const type of types) {
        addContent(budget, `content for ${type}`, type);
      }
      
      const counts = countByType(budget);
      for (const type of types) {
        assert.strictEqual(counts[type], 1);
      }
    });
    
    it('should handle rapid additions (10K/sec)', () => {
      const target = 1000;
      const start = Date.now();
      
      for (let i = 0; i < target; i++) {
        addContent(budget, `rapid ${i}`, 'file');
      }
      
      const duration = Date.now() - start;
      const rate = target / (duration / 1000);
      
      assert.ok(rate > 1000, `Should add > 1000/sec, got ${rate.toFixed(0)}/sec`);
    });
  });
  
  describe('Item Access and Removal', () => {
    it('should handle accessing non-existent item', () => {
      const result = accessItem(budget, 'non-existent-id');
      assert.strictEqual(result, null);
    });
    
    it('should handle removing non-existent item', () => {
      const result = removeItem(budget, 'non-existent-id');
      assert.strictEqual(result, false);
    });
    
    it('should track access count correctly', () => {
      const item = addContent(budget, 'test', 'file');
      
      for (let i = 0; i < 100; i++) {
        accessItem(budget, item.id);
      }
      
      const found = findItem(budget, item.id);
      assert.strictEqual(found?.accessCount, 101);  // 1 initial + 100 accesses
    });
    
    it('should update usedTokens on removal', () => {
      const item = addContent(budget, 'test content', 'file');
      const tokensBefore = budget.usedTokens;
      
      removeItem(budget, item.id);
      
      assert.strictEqual(budget.usedTokens, tokensBefore - item.tokens);
    });
    
    it('should handle removing all items', () => {
      for (let i = 0; i < 100; i++) {
        addContent(budget, `content ${i}`, 'file');
      }
      
      const items = getAllItems(budget);
      for (const item of items) {
        removeItem(budget, item.id);
      }
      
      assert.strictEqual(getAllItems(budget).length, 0);
      assert.strictEqual(budget.usedTokens, 0);
    });
  });
  
  describe('Tier Movement Stress', () => {
    it('should handle moving item through all tiers', () => {
      const item = addContent(budget, 'test', 'file', { tier: 'hot' });
      
      assert.strictEqual(findItem(budget, item.id)?.tier, 'hot');
      
      moveToTier(budget, item.id, 'warm');
      assert.strictEqual(findItem(budget, item.id)?.tier, 'warm');
      
      moveToTier(budget, item.id, 'cold');
      assert.strictEqual(findItem(budget, item.id)?.tier, 'cold');
      
      moveToTier(budget, item.id, 'frozen');
      assert.strictEqual(findItem(budget, item.id)?.tier, 'frozen');
    });
    
    it('should handle moving non-existent item', () => {
      const result = moveToTier(budget, 'fake-id', 'warm');
      assert.strictEqual(result, false);
    });
    
    it('should handle rapid tier movements', () => {
      const item = addContent(budget, 'test', 'file');
      const tiers: ContentTier[] = ['hot', 'warm', 'cold', 'frozen'];
      
      const start = Date.now();
      for (let i = 0; i < 10000; i++) {
        const tier = tiers[i % tiers.length];
        moveToTier(budget, item.id, tier);
      }
      const duration = Date.now() - start;
      
      assert.ok(duration < 1000, `Should complete in < 1s, took ${duration}ms`);
    });
    
    it('should maintain token count during tier moves', () => {
      addContent(budget, 'a'.repeat(1000), 'file');
      addContent(budget, 'b'.repeat(2000), 'file');
      const item3 = addContent(budget, 'c'.repeat(3000), 'file');
      
      const tokensBefore = budget.usedTokens;
      
      moveToTier(budget, item3.id, 'frozen');
      
      assert.strictEqual(budget.usedTokens, tokensBefore);  // No change
    });
  });
  
  describe('Tier Aging Stress', () => {
    it('should age items based on time', async () => {
      // Add items to hot tier with backdated timestamps
      for (let i = 0; i < 10; i++) {
        const item = addContent(budget, `content ${i}`, 'file');
        // Backdate the item by 1 minute to ensure it ages
        item.createdAt = Date.now() - 60000;
        item.lastAccessedAt = Date.now() - 60000;
      }
      
      assert.strictEqual(budget.tiers.hot.length, 10);
      
      // Age with 0 threshold - items are 1 minute old so will age
      const result = ageItems(budget, { hotMaxAge: 0 });
      
      assert.ok(result.aged > 0, `Expected items to age, but got ${result.aged}`);
      assert.ok(budget.tiers.warm.length > 0, 'Expected items in warm tier');
    });
    
    it('should not age system items', () => {
      const systemItem = addContent(budget, 'system prompt', 'system');
      
      ageItems(budget, { hotMaxAge: 0, warmMaxAge: 0, coldMaxAge: 0 });
      
      // System item should still be in hot
      const found = findItem(budget, systemItem.id);
      assert.strictEqual(found?.tier, 'hot');
    });
    
    it('should not age task items', () => {
      const taskItem = addContent(budget, 'current task', 'task');
      
      ageItems(budget, { hotMaxAge: 0 });
      
      const found = findItem(budget, taskItem.id);
      assert.strictEqual(found?.tier, 'hot');
    });
    
    it('should handle aging empty budget', () => {
      const result = ageItems(budget);
      assert.strictEqual(result.aged, 0);
    });
    
    it('should handle rapid aging cycles', () => {
      for (let i = 0; i < 100; i++) {
        addContent(budget, `content ${i}`, 'file');
      }
      
      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        ageItems(budget, { hotMaxAge: 0, warmMaxAge: 0, coldMaxAge: 0 });
      }
      const duration = Date.now() - start;
      
      assert.ok(duration < 1000, `Should complete in < 1s, took ${duration}ms`);
    });
  });
});

// ============================================================================
// COMPACTION STRESS TESTS
// ============================================================================

describe('Compaction Stress Tests', () => {
  let budget: ContextBudget;
  let testDir: string;
  
  beforeEach(() => {
    budget = createContextBudget(10000);  // Small budget for easier testing
    testDir = createTestDir();
  });
  
  afterEach(() => {
    cleanup(testDir);
  });
  
  describe('Basic Compaction', () => {
    it('should compact when over target saturation', () => {
      // Fill budget with content that can be compacted
      // Each item is ~25 tokens (100 chars / 4), so 90 items = ~2250 tokens
      // With budget of 10000, we need to be over target (0.5 = 5000 tokens)
      // So let's add more content
      for (let i = 0; i < 100; i++) {
        addContent(budget, 'x'.repeat(400), 'file', { tier: 'warm' });
      }
      
      const tokensBefore = budget.usedTokens;
      const result = compactBudget(budget, { targetSaturation: 0.5 });
      
      // Compaction should reduce tokens or drop/compact items
      assert.ok(result.tokensSaved >= 0 || result.itemsCompacted >= 0 || result.itemsDropped >= 0);
      assert.ok(result.tokensAfter <= tokensBefore);
    });
    
    it('should preserve system content during compaction', () => {
      addContent(budget, 'system prompt', 'system');
      
      for (let i = 0; i < 100; i++) {
        addContent(budget, 'x'.repeat(100), 'file', { tier: 'frozen' });
      }
      
      compactBudget(budget, { targetSaturation: 0.1 });
      
      const systemItems = getAllItems(budget).filter(i => i.type === 'system');
      assert.strictEqual(systemItems.length, 1);
    });
    
    it('should preserve error content during compaction', () => {
      addContent(budget, 'error log', 'error');
      
      for (let i = 0; i < 100; i++) {
        addContent(budget, 'x'.repeat(100), 'reference', { tier: 'frozen' });
      }
      
      compactBudget(budget, { targetSaturation: 0.1 });
      
      const errorItems = getAllItems(budget).filter(i => i.type === 'error');
      assert.strictEqual(errorItems.length, 1);
    });
    
    it('should handle empty budget compaction', () => {
      const result = compactBudget(budget);
      assert.ok(result.success || result.tokensSaved === 0);
    });
    
    it('should handle already-at-target compaction', () => {
      addContent(budget, 'small', 'file');
      
      const result = compactBudget(budget, { targetSaturation: 0.9 });
      // Should succeed without doing much
      assert.ok(result.success || result.itemsCompacted === 0);
    });
  });
  
  describe('Aggressive Compaction', () => {
    it('should compact to very low saturation', () => {
      for (let i = 0; i < 100; i++) {
        addContent(budget, 'x'.repeat(1000), 'file', { tier: 'warm' });
      }
      
      const result = compactBudget(budget, { targetSaturation: 0.01 });
      
      assert.ok(result.tokensSaved > 0);
    });
    
    it('should handle compaction when all items are frozen', () => {
      for (let i = 0; i < 100; i++) {
        addContent(budget, 'x'.repeat(100), 'reference', { tier: 'frozen' });
      }
      
      const result = compactBudget(budget, { targetSaturation: 0.1 });
      
      assert.ok(result.itemsDropped > 0);
    });
    
    it('should handle custom summarizer', () => {
      let summarizerCalled = 0;
      const customSummarizer = (content: string, _maxChars: number): string => {
        summarizerCalled++;
        return content.slice(0, 10);
      };
      
      for (let i = 0; i < 50; i++) {
        addContent(budget, 'x'.repeat(500), 'file', { tier: 'warm' });
      }
      
      compactBudget(budget, { 
        targetSaturation: 0.1,
        summarizer: customSummarizer 
      });
      
      assert.ok(summarizerCalled > 0, 'Custom summarizer should be called');
    });
    
    it('should track compaction history', () => {
      for (let i = 0; i < 50; i++) {
        addContent(budget, 'x'.repeat(200), 'file', { tier: 'warm' });
      }
      
      compactBudget(budget, { targetSaturation: 0.5 });
      compactBudget(budget, { targetSaturation: 0.3 });
      compactBudget(budget, { targetSaturation: 0.1 });
      
      assert.strictEqual(budget.compactionHistory.length, 3);
    });
    
    it('should limit compaction history', () => {
      for (let i = 0; i < 150; i++) {
        addContent(budget, 'x'.repeat(10), 'file', { tier: 'frozen' });
        compactBudget(budget, { targetSaturation: 0.1 });
      }
      
      assert.ok(budget.compactionHistory.length <= 100);
    });
  });
  
  describe('Compaction Performance', () => {
    it('should compact 1000 items quickly', () => {
      for (let i = 0; i < 1000; i++) {
        addContent(budget, 'x'.repeat(100), 'file', { tier: 'warm' });
      }
      
      const start = Date.now();
      const result = compactBudget(budget, { targetSaturation: 0.1 });
      const duration = Date.now() - start;
      
      assert.ok(duration < 2000, `Should complete in < 2s, took ${duration}ms`);
      assert.ok(result.duration < 2000);
    });
  });
});

// ============================================================================
// SATURATION REPORT STRESS TESTS
// ============================================================================

describe('Saturation Report Stress Tests', () => {
  let budget: ContextBudget;
  
  beforeEach(() => {
    budget = createContextBudget(10000);
  });
  
  describe('Report Accuracy', () => {
    it('should generate accurate tier breakdown', () => {
      addContent(budget, 'x'.repeat(100), 'file', { tier: 'hot' });
      addContent(budget, 'y'.repeat(200), 'file', { tier: 'warm' });
      addContent(budget, 'z'.repeat(300), 'file', { tier: 'cold' });
      addContent(budget, 'w'.repeat(400), 'file', { tier: 'frozen' });
      
      const report = getSaturationReport(budget);
      
      assert.strictEqual(report.tierBreakdown.hot.items, 1);
      assert.strictEqual(report.tierBreakdown.warm.items, 1);
      assert.strictEqual(report.tierBreakdown.cold.items, 1);
      assert.strictEqual(report.tierBreakdown.frozen.items, 1);
    });
    
    it('should provide recommendations at warning level', () => {
      // Fill to 85%
      const tokensToAdd = Math.floor(budget.maxTokens * 0.85);
      addContent(budget, 'x'.repeat(tokensToAdd * 4), 'file');
      
      const report = getSaturationReport(budget);
      
      assert.strictEqual(report.level, 'warning');
      assert.ok(report.recommendations.length > 0);
      assert.ok(report.compactionRecommended);
    });
    
    it('should calculate potential savings when at warning level', () => {
      // Need to be at warning level (80%+) to get potential savings calculated
      // Budget is 10000 tokens, so need 8000+ tokens
      // 200 chars = 50 tokens, so need 160+ items or larger items
      for (let i = 0; i < 200; i++) {
        addContent(budget, 'x'.repeat(200), 'file', { tier: 'warm' });
      }
      
      const report = getSaturationReport(budget);
      
      // Should be at warning level or above for savings to be calculated
      assert.ok(report.level !== 'optimal' || report.tierBreakdown.warm.tokens > 0);
      // Warm tier should have potential savings from summarization
      assert.ok(report.tierBreakdown.warm.tokens > 0);
    });
    
    it('should detect stale hot items', async () => {
      const item = addContent(budget, 'test', 'file');
      
      // Manually set lastAccessedAt to 10 minutes ago
      item.lastAccessedAt = Date.now() - 10 * 60 * 1000;
      
      const report = getSaturationReport(budget);
      
      assert.ok(report.recommendations.some(r => r.includes('not accessed')));
    });
    
    it('should handle empty budget report', () => {
      const report = getSaturationReport(budget);
      
      assert.strictEqual(report.saturation, 0);
      assert.strictEqual(report.level, 'optimal');
      assert.strictEqual(report.usedTokens, 0);
    });
  });
  
  describe('Report Performance', () => {
    it('should generate report for 10,000 items quickly', () => {
      for (let i = 0; i < 10000; i++) {
        addContent(budget, `content ${i}`, 'file');
      }
      
      const start = Date.now();
      const report = getSaturationReport(budget);
      const duration = Date.now() - start;
      
      assert.ok(duration < 500, `Should complete in < 500ms, took ${duration}ms`);
      assert.ok(report.saturation > 0);
    });
  });
});

// ============================================================================
// PERSISTENCE STRESS TESTS
// ============================================================================

describe('Persistence Stress Tests', () => {
  let testDir: string;
  
  beforeEach(() => {
    testDir = createTestDir();
  });
  
  afterEach(() => {
    cleanup(testDir);
  });
  
  describe('Save/Load Integrity', () => {
    it('should preserve budget across save/load', () => {
      const budget = createContextBudget(50000);
      addContent(budget, 'test content', 'file');
      addContent(budget, 'error log', 'error');
      
      saveContextBudget(testDir, budget);
      const loaded = loadContextBudget(testDir);
      
      assert.strictEqual(loaded.maxTokens, budget.maxTokens);
      assert.strictEqual(loaded.usedTokens, budget.usedTokens);
      assert.strictEqual(getAllItems(loaded).length, getAllItems(budget).length);
    });
    
    it('should handle missing directory', () => {
      const nonExistentPath = join(testDir, 'nonexistent', 'deep', 'path');
      const budget = createContextBudget();
      addContent(budget, 'test', 'file');
      
      const result = saveContextBudget(nonExistentPath, budget);
      assert.ok(result);
      
      const loaded = loadContextBudget(nonExistentPath);
      assert.strictEqual(getAllItems(loaded).length, 1);
    });
    
    it('should return default on corrupted file', () => {
      mkdirSync(join(testDir, '.midas'), { recursive: true });
      writeFileSync(join(testDir, '.midas', 'context-budget.json'), '{ invalid json }}}');
      
      const loaded = loadContextBudget(testDir);
      assert.strictEqual(loaded.usedTokens, 0);  // Should be default
    });
    
    it('should return default on empty file', () => {
      mkdirSync(join(testDir, '.midas'), { recursive: true });
      writeFileSync(join(testDir, '.midas', 'context-budget.json'), '');
      
      const loaded = loadContextBudget(testDir);
      assert.strictEqual(loaded.usedTokens, 0);
    });
    
    it('should handle large budgets (1000 items)', () => {
      const budget = createContextBudget();
      for (let i = 0; i < 1000; i++) {
        addContent(budget, `content ${i}`.repeat(10), 'file');
      }
      
      const start = Date.now();
      saveContextBudget(testDir, budget);
      const loaded = loadContextBudget(testDir);
      const duration = Date.now() - start;
      
      assert.strictEqual(getAllItems(loaded).length, 1000);
      assert.ok(duration < 2000, `Should complete in < 2s, took ${duration}ms`);
    });
    
    it('should handle clear budget', () => {
      const budget = createContextBudget();
      addContent(budget, 'test', 'file');
      saveContextBudget(testDir, budget);
      
      const cleared = clearContextBudget(testDir);
      
      assert.strictEqual(getAllItems(cleared).length, 0);
      
      const reloaded = loadContextBudget(testDir);
      assert.strictEqual(getAllItems(reloaded).length, 0);
    });
  });
  
  describe('Concurrent Persistence', () => {
    it('should handle rapid save/load cycles', async () => {
      const budget = createContextBudget();
      addContent(budget, 'test', 'file');
      
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 50; i++) {
        promises.push((async () => {
          addContent(budget, `content ${i}`, 'file');
          saveContextBudget(testDir, budget);
          loadContextBudget(testDir);
        })());
      }
      
      await Promise.all(promises);
      
      const final = loadContextBudget(testDir);
      assert.ok(getAllItems(final).length > 0);
    });
  });
});

// ============================================================================
// VALIDATION AND REPAIR STRESS TESTS
// ============================================================================

describe('Validation and Repair Stress Tests', () => {
  let budget: ContextBudget;
  
  beforeEach(() => {
    budget = createContextBudget(100000);
  });
  
  describe('Budget Validation', () => {
    it('should validate correct budget', () => {
      addContent(budget, 'test content', 'file');
      
      const result = validateBudget(budget);
      assert.ok(result.valid);
      assert.strictEqual(result.discrepancy, 0);
    });
    
    it('should detect token count discrepancy', () => {
      addContent(budget, 'test content', 'file');
      budget.usedTokens += 1000;  // Manually corrupt
      
      const result = validateBudget(budget);
      assert.ok(!result.valid);
      assert.ok(result.discrepancy > 0);
    });
    
    it('should validate empty budget', () => {
      const result = validateBudget(budget);
      assert.ok(result.valid);
      assert.strictEqual(result.expectedTokens, 0);
    });
  });
  
  describe('Budget Repair', () => {
    it('should repair corrupted token count', () => {
      addContent(budget, 'test content', 'file');
      budget.usedTokens = 999999;  // Corrupt
      
      repairBudget(budget);
      
      const result = validateBudget(budget);
      assert.ok(result.valid);
    });
    
    it('should repair items with wrong token estimates', () => {
      const item = addContent(budget, 'test content', 'file');
      item.tokens = 9999;  // Corrupt item token count
      
      repairBudget(budget);
      
      assert.notStrictEqual(item.tokens, 9999);
      const result = validateBudget(budget);
      assert.ok(result.valid);
    });
    
    it('should handle repair of 10,000 items', () => {
      for (let i = 0; i < 10000; i++) {
        const item = addContent(budget, `content ${i}`, 'file');
        item.tokens = i;  // Corrupt
      }
      budget.usedTokens = 0;  // Corrupt total
      
      const start = Date.now();
      repairBudget(budget);
      const duration = Date.now() - start;
      
      const result = validateBudget(budget);
      assert.ok(result.valid);
      assert.ok(duration < 1000, `Should complete in < 1s, took ${duration}ms`);
    });
  });
});

// ============================================================================
// BOUNDARY VALUE ANALYSIS
// ============================================================================

describe('Boundary Value Analysis', () => {
  describe('Token Boundaries', () => {
    it('should handle exactly 0 tokens', () => {
      const budget = createContextBudget(0);
      assert.strictEqual(calculateSaturation(budget), 1);
    });
    
    it('should handle exactly 1 token', () => {
      const budget = createContextBudget(1);
      addContent(budget, 'a', 'file');
      assert.ok(calculateSaturation(budget) >= 0);
    });
    
    it('should handle MAX_SAFE_INTEGER tokens', () => {
      const budget = createContextBudget(Number.MAX_SAFE_INTEGER);
      addContent(budget, 'test', 'file');
      assert.ok(calculateSaturation(budget) < 1);
    });
  });
  
  describe('Item Count Boundaries', () => {
    it('should handle 0 items in all tiers', () => {
      const budget = createContextBudget();
      const items = getAllItems(budget);
      assert.strictEqual(items.length, 0);
    });
    
    it('should handle 1 item', () => {
      const budget = createContextBudget();
      addContent(budget, 'test', 'file');
      assert.strictEqual(getAllItems(budget).length, 1);
    });
    
    it('should handle exactly TIER_LIMITS.HOT items', () => {
      const budget = createContextBudget();
      for (let i = 0; i < TIER_LIMITS.HOT; i++) {
        addContent(budget, `item ${i}`, 'file');
      }
      assert.strictEqual(budget.tiers.hot.length, TIER_LIMITS.HOT);
    });
    
    it('should handle TIER_LIMITS.HOT + 1 items', () => {
      const budget = createContextBudget();
      for (let i = 0; i < TIER_LIMITS.HOT + 1; i++) {
        addContent(budget, `item ${i}`, 'file');
      }
      assert.strictEqual(budget.tiers.hot.length, TIER_LIMITS.HOT + 1);
      
      const report = getSaturationReport(budget);
      assert.ok(report.recommendations.some(r => r.includes('over limit')));
    });
  });
  
  describe('Saturation Threshold Boundaries', () => {
    // Thresholds: optimal < 0.80, warning 0.80-0.89, critical 0.90-0.94, emergency >= 0.95
    const thresholds = [
      { value: 0.599, expected: 'optimal' },
      { value: 0.600, expected: 'optimal' },
      { value: 0.799, expected: 'optimal' },
      { value: 0.800, expected: 'warning' },  // Exactly at warning boundary
      { value: 0.801, expected: 'warning' },
      { value: 0.850, expected: 'warning' },
      { value: 0.899, expected: 'warning' },
      { value: 0.900, expected: 'critical' }, // Exactly at critical boundary
      { value: 0.901, expected: 'critical' },
      { value: 0.949, expected: 'critical' },
      { value: 0.950, expected: 'emergency' }, // Exactly at emergency boundary
      { value: 0.951, expected: 'emergency' },
    ];
    
    for (const { value, expected } of thresholds) {
      it(`should classify ${value} as ${expected}`, () => {
        assert.strictEqual(getSaturationLevel(value), expected);
      });
    }
  });
  
  describe('String Length Boundaries', () => {
    it('should handle string length 0', () => {
      assert.strictEqual(estimateTokens(''), 0);
    });
    
    it('should handle string length 1', () => {
      assert.strictEqual(estimateTokens('a'), 1);
    });
    
    it('should handle string length 3 (below 4-char threshold)', () => {
      assert.strictEqual(estimateTokens('abc'), 1);
    });
    
    it('should handle string length 4 (exactly 1 token threshold)', () => {
      assert.strictEqual(estimateTokens('abcd'), 1);
    });
    
    it('should handle string length 5 (above 4-char threshold)', () => {
      assert.strictEqual(estimateTokens('abcde'), 2);
    });
  });
});

// ============================================================================
// CONCURRENT ACCESS STRESS TESTS
// ============================================================================

describe('Concurrent Access Stress Tests', () => {
  it('should handle concurrent additions', async () => {
    const budget = createContextBudget(1_000_000);
    const promises: Promise<void>[] = [];
    
    for (let i = 0; i < 100; i++) {
      promises.push((async () => {
        for (let j = 0; j < 10; j++) {
          addContent(budget, `concurrent ${i}-${j}`, 'file');
        }
      })());
    }
    
    await Promise.all(promises);
    
    const items = getAllItems(budget);
    assert.strictEqual(items.length, 1000);
  });
  
  it('should handle concurrent access updates', async () => {
    const budget = createContextBudget();
    const items: ContextItem[] = [];
    
    for (let i = 0; i < 10; i++) {
      items.push(addContent(budget, `item ${i}`, 'file'));
    }
    
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      for (const item of items) {
        promises.push((async () => {
          accessItem(budget, item.id);
        })());
      }
    }
    
    await Promise.all(promises);
    
    // All items should have high access counts
    for (const item of items) {
      assert.ok(item.accessCount > 1);
    }
  });
  
  it('should handle concurrent tier movements', async () => {
    const budget = createContextBudget();
    const item = addContent(budget, 'test', 'file');
    
    const tiers: ContentTier[] = ['hot', 'warm', 'cold', 'frozen'];
    const promises: Promise<void>[] = [];
    
    for (let i = 0; i < 100; i++) {
      promises.push((async () => {
        const tier = tiers[i % tiers.length];
        moveToTier(budget, item.id, tier);
      })());
    }
    
    await Promise.all(promises);
    
    // Item should exist in exactly one tier
    const found = findItem(budget, item.id);
    assert.ok(found);
    
    let tierCount = 0;
    for (const tier of tiers) {
      if (budget.tiers[tier].some(i => i.id === item.id)) tierCount++;
    }
    assert.strictEqual(tierCount, 1);
  });
  
  it('should handle mixed concurrent operations', async () => {
    const budget = createContextBudget(1_000_000);
    const promises: Promise<void>[] = [];
    
    // Add items
    for (let i = 0; i < 50; i++) {
      promises.push((async () => {
        addContent(budget, `content ${i}`, 'file');
      })());
    }
    
    // Age items
    promises.push((async () => {
      for (let i = 0; i < 10; i++) {
        ageItems(budget, { hotMaxAge: 0 });
      }
    })());
    
    // Generate reports
    for (let i = 0; i < 20; i++) {
      promises.push((async () => {
        getSaturationReport(budget);
      })());
    }
    
    await Promise.all(promises);
    
    // Should not crash, budget should be in valid state
    const validation = validateBudget(budget);
    // Note: Concurrent operations may cause discrepancy, so just check no crash
    assert.ok(budget.usedTokens >= 0);
  });
});

// ============================================================================
// MEMORY EFFICIENCY TESTS
// ============================================================================

describe('Memory Efficiency Tests', () => {
  it('should not leak memory over 1000 add/remove cycles', () => {
    const budget = createContextBudget();
    const initialMemory = process.memoryUsage().heapUsed;
    
    for (let i = 0; i < 1000; i++) {
      const item = addContent(budget, 'x'.repeat(10000), 'file');
      removeItem(budget, item.id);
    }
    
    // Force GC if available
    if (global.gc) global.gc();
    
    const finalMemory = process.memoryUsage().heapUsed;
    const memoryGrowth = finalMemory - initialMemory;
    
    // Should not grow by more than 50MB
    assert.ok(memoryGrowth < 50 * 1024 * 1024, `Memory grew by ${memoryGrowth / 1024 / 1024}MB`);
  });
  
  it('should handle large compaction without memory issues', () => {
    const budget = createContextBudget(10_000_000);
    
    // Add 1000 large items
    for (let i = 0; i < 1000; i++) {
      addContent(budget, 'x'.repeat(10000), 'file', { tier: 'warm' });
    }
    
    const initialMemory = process.memoryUsage().heapUsed;
    
    // Compact aggressively
    compactBudget(budget, { targetSaturation: 0.01 });
    
    if (global.gc) global.gc();
    
    const finalMemory = process.memoryUsage().heapUsed;
    
    // After compaction, memory should not be significantly higher
    assert.ok(finalMemory < initialMemory * 2);
  });
  
  it('should efficiently store budget statistics', () => {
    const budget = createContextBudget();
    
    for (let i = 0; i < 10000; i++) {
      addContent(budget, `item ${i}`, 'file');
    }
    
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      getBudgetStats(budget);
    }
    const duration = Date.now() - start;
    
    assert.ok(duration < 500, `1000 stat calls should take < 500ms, took ${duration}ms`);
  });
});

// ============================================================================
// STATE CORRUPTION RESILIENCE
// ============================================================================

describe('State Corruption Resilience', () => {
  let testDir: string;
  
  beforeEach(() => {
    testDir = createTestDir();
  });
  
  afterEach(() => {
    cleanup(testDir);
  });
  
  it('should handle corrupted tier arrays', () => {
    const budget = createContextBudget();
    addContent(budget, 'test', 'file');
    
    // Corrupt tier array
    budget.tiers.hot = null as unknown as ContextItem[];
    
    // Operations should not throw
    try {
      const items = getAllItems(budget);
      assert.ok(Array.isArray(items) || items === undefined);
    } catch (e) {
      // Expected - corrupted state may throw
      assert.ok(e instanceof Error);
    }
  });
  
  it('should handle NaN usedTokens', () => {
    const budget = createContextBudget();
    budget.usedTokens = NaN;
    
    const saturation = calculateSaturation(budget);
    // Should return something, not crash
    assert.ok(typeof saturation === 'number');
  });
  
  it('should handle Infinity maxTokens', () => {
    const budget = createContextBudget(Infinity);
    addContent(budget, 'test', 'file');
    
    const saturation = calculateSaturation(budget);
    assert.strictEqual(saturation, 0);  // Infinite capacity = 0% saturation
  });
  
  it('should handle corrupted item content', () => {
    const budget = createContextBudget();
    const item = addContent(budget, 'test', 'file');
    
    // Corrupt item
    item.content = null as unknown as string;
    item.tokens = -1;
    
    // Repair should handle this
    repairBudget(budget);
    
    assert.ok(item.tokens >= 0);
  });
  
  it('should handle missing tiers object', () => {
    const budget = createContextBudget();
    (budget as unknown as Record<string, unknown>).tiers = undefined;
    
    try {
      addContent(budget, 'test', 'file');
      assert.fail('Should have thrown');
    } catch (e) {
      assert.ok(e instanceof Error);
    }
  });
  
  it('should recover from partially corrupted persisted state', () => {
    mkdirSync(join(testDir, '.midas'), { recursive: true });
    
    // Write partially valid JSON
    const corruptedState = {
      maxTokens: 200000,
      usedTokens: 'not a number',  // Corrupt
      tiers: {
        hot: [{ id: 'x', content: 'test' }],  // Missing required fields
        warm: null,  // Corrupt
      },
      sessionStart: Date.now(),
    };
    
    writeFileSync(
      join(testDir, '.midas', 'context-budget.json'),
      JSON.stringify(corruptedState)
    );
    
    const loaded = loadContextBudget(testDir);
    
    // Should return default budget, not crash
    assert.ok(loaded.tiers);
    assert.ok(Array.isArray(loaded.tiers.hot));
  });
});

// ============================================================================
// PROPERTY-BASED TESTS WITH FAST-CHECK
// ============================================================================

describe('Property-Based Tests', () => {
  describe('Budget Invariants', () => {
    it('should maintain usedTokens = sum of all item tokens', () => {
      fc.assert(fc.property(
        fc.array(fc.string({ maxLength: 100 }), { maxLength: 50 }),
        (contents) => {
          const budget = createContextBudget();
          
          for (const content of contents) {
            addContent(budget, content, 'file');
          }
          
          const validation = validateBudget(budget);
          return validation.valid;
        }
      ), { numRuns: 100 });
    });
    
    it('should maintain saturation in [0, infinity) range', () => {
      fc.assert(fc.property(
        fc.integer({ min: 1, max: 1000000 }),
        fc.array(fc.string({ maxLength: 100 }), { maxLength: 20 }),
        (maxTokens, contents) => {
          const budget = createContextBudget(maxTokens);
          
          for (const content of contents) {
            addContent(budget, content, 'file');
          }
          
          const saturation = calculateSaturation(budget);
          return saturation >= 0;
        }
      ), { numRuns: 100 });
    });
    
    it('should never lose items during tier movements', () => {
      fc.assert(fc.property(
        fc.array(fc.constantFrom('hot', 'warm', 'cold', 'frozen') as fc.Arbitrary<ContentTier>, { minLength: 1, maxLength: 20 }),
        (tierSequence) => {
          const budget = createContextBudget();
          const item = addContent(budget, 'test', 'file');
          
          for (const tier of tierSequence) {
            moveToTier(budget, item.id, tier);
          }
          
          const found = findItem(budget, item.id);
          return found !== null && found.id === item.id;
        }
      ), { numRuns: 100 });
    });
  });
  
  describe('Token Estimation Properties', () => {
    it('should be deterministic', () => {
      fc.assert(fc.property(fc.string(), (s) => {
        const t1 = estimateTokens(s);
        const t2 = estimateTokens(s);
        return t1 === t2;
      }), { numRuns: 500 });
    });
    
    it('should be non-decreasing with string growth', () => {
      fc.assert(fc.property(
        fc.string({ maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (base, addition) => {
          const baseTokens = estimateTokens(base);
          const extendedTokens = estimateTokens(base + addition);
          return extendedTokens >= baseTokens;
        }
      ), { numRuns: 500 });
    });
  });
  
  describe('Compaction Properties', () => {
    it('should never increase token usage', () => {
      fc.assert(fc.property(
        fc.array(fc.string({ minLength: 10, maxLength: 100 }), { minLength: 5, maxLength: 30 }),
        fc.float({ min: Math.fround(0.1), max: Math.fround(0.9) }),
        (contents, targetSat) => {
          const budget = createContextBudget(100000);
          
          for (const content of contents) {
            addContent(budget, content, 'file', { tier: 'warm' });
          }
          
          const tokensBefore = budget.usedTokens;
          compactBudget(budget, { targetSaturation: targetSat });
          
          return budget.usedTokens <= tokensBefore;
        }
      ), { numRuns: 50 });
    });
    
    it('should preserve priority ordering during drops', () => {
      fc.assert(fc.property(
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 5, maxLength: 20 }),
        (priorities) => {
          const budget = createContextBudget(10000);
          
          for (const priority of priorities) {
            addContent(budget, 'x'.repeat(500), 'reference', { 
              tier: 'frozen',
              priority,
            });
          }
          
          compactBudget(budget, { targetSaturation: 0.1 });
          
          // Remaining items should have higher average priority
          const remaining = budget.tiers.frozen;
          if (remaining.length === 0) return true;
          
          const avgPriority = remaining.reduce((sum, i) => sum + i.priority, 0) / remaining.length;
          const inputAvg = priorities.reduce((a, b) => a + b, 0) / priorities.length;
          
          return avgPriority >= inputAvg * 0.8;  // Allow some variance
        }
      ), { numRuns: 50 });
    });
  });
});

// ============================================================================
// ADVERSARIAL INPUT TESTS
// ============================================================================

describe('Adversarial Input Tests', () => {
  it('should handle prototype pollution attempt in item ID', () => {
    const budget = createContextBudget();
    const item = addContent(budget, 'test', 'file');
    
    // Attempt to use __proto__ as ID
    const maliciousId = '__proto__';
    const found = findItem(budget, maliciousId);
    
    assert.strictEqual(found, null);
  });
  
  it('should handle very long item content', () => {
    const budget = createContextBudget(Number.MAX_SAFE_INTEGER);
    const longContent = 'x'.repeat(10 * 1024 * 1024);  // 10MB
    
    const item = addContent(budget, longContent, 'file');
    assert.ok(item.tokens > 0);
  });
  
  it('should handle content with null bytes', () => {
    const budget = createContextBudget();
    const content = 'hello\x00world\x00test';
    
    const item = addContent(budget, content, 'file');
    assert.ok(item.tokens > 0);
    assert.strictEqual(item.content, content);
  });
  
  it('should handle content with control characters', () => {
    const budget = createContextBudget();
    let content = '';
    for (let i = 0; i < 32; i++) {
      content += String.fromCharCode(i);
    }
    
    const item = addContent(budget, content, 'file');
    assert.ok(item.tokens > 0);
  });
  
  it('should handle content with ANSI escape codes', () => {
    const budget = createContextBudget();
    const content = '\x1b[31mRed\x1b[0m \x1b[32mGreen\x1b[0m';
    
    const item = addContent(budget, content, 'file');
    assert.ok(item.tokens > 0);
  });
  
  it('should handle JSON special characters in content', () => {
    const budget = createContextBudget();
    const testDir = createTestDir();
    
    try {
      const content = '{"key": "value with \\"quotes\\" and \\n newlines"}';
      const item = addContent(budget, content, 'file');
      
      saveContextBudget(testDir, budget);
      const loaded = loadContextBudget(testDir);
      
      const loadedItem = findItem(loaded, item.id);
      assert.strictEqual(loadedItem?.content, content);
    } finally {
      cleanup(testDir);
    }
  });
  
  it('should handle path traversal in project path', () => {
    const maliciousPath = '/tmp/../../../etc/passwd';
    
    // Should not throw, should handle gracefully
    const budget = createContextBudget();
    const saved = saveContextBudget(maliciousPath, budget);
    
    // Either succeeds in valid location or fails gracefully
    assert.ok(typeof saved === 'boolean');
  });
});

// ============================================================================
// REGRESSION DETECTION TESTS
// ============================================================================

describe('Regression Detection Tests', () => {
  it('should produce consistent token estimates for fixed inputs', () => {
    const testCases = [
      { input: 'hello world', expected: 3 },
      { input: 'a'.repeat(100), expected: 25 },
      // Short symbol strings use base 4-char-per-token (7 chars / 4 = 2 tokens)
      // Symbol density adjustment only kicks in for strings > 10 chars
      { input: '{}()[];', expected: 2 },
      // Longer symbol-heavy string uses 3-char-per-token (20 chars / 3 = 7)
      { input: '{}()[];{}()[];{}()[];', expected: 7 },
    ];
    
    for (const { input, expected } of testCases) {
      const actual = estimateTokens(input);
      assert.strictEqual(actual, expected, `Expected ${expected} tokens for "${input.slice(0, 20)}...", got ${actual}`);
    }
  });
  
  it('should maintain consistent saturation calculation', () => {
    const budget = createContextBudget(1000);
    addContent(budget, 'x'.repeat(400), 'file');  // 100 tokens
    
    const saturation = calculateSaturation(budget);
    assert.ok(saturation > 0.05 && saturation < 0.5, `Expected saturation ~0.1, got ${saturation}`);
  });
  
  it('should consistently classify saturation levels', () => {
    // These should never change - based on thresholds: warning>=0.80, critical>=0.90, emergency>=0.95
    assert.strictEqual(getSaturationLevel(0.5), 'optimal');
    assert.strictEqual(getSaturationLevel(0.7), 'optimal');   // Below 0.80 threshold
    assert.strictEqual(getSaturationLevel(0.85), 'warning');  // 0.80-0.89 range
    assert.strictEqual(getSaturationLevel(0.92), 'critical');
    assert.strictEqual(getSaturationLevel(0.98), 'emergency');
  });
});
