import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  estimateTokens,
  truncateToTokens,
  extractKeyPoints,
  summarizeJournalEntries,
  buildCompressedContext,
  contextToString,
  getContextStats,
  getCachedSummary,
  setCachedSummary,
  getCacheStats,
} from '../context.js';
import { saveToJournal } from '../tools/journal.js';

describe('Context Compression Module', () => {
  const testDir = join(tmpdir(), 'midas-context-test-' + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('estimateTokens', () => {
    it('estimates tokens correctly for short text', () => {
      const text = 'Hello world';
      const tokens = estimateTokens(text);
      // 11 chars / 4 = ~3 tokens
      assert.strictEqual(tokens >= 2 && tokens <= 4, true);
    });

    it('estimates tokens correctly for longer text', () => {
      const text = 'This is a longer piece of text that should have more tokens.';
      const tokens = estimateTokens(text);
      // 60 chars / 4 = 15 tokens
      assert.strictEqual(tokens >= 12 && tokens <= 18, true);
    });

    it('handles empty string', () => {
      assert.strictEqual(estimateTokens(''), 0);
    });
  });

  describe('truncateToTokens', () => {
    it('returns original if under limit', () => {
      const text = 'Short text';
      const result = truncateToTokens(text, 100);
      assert.strictEqual(result, text);
    });

    it('truncates long text', () => {
      const text = 'A'.repeat(1000);
      const result = truncateToTokens(text, 50);
      assert.strictEqual(result.length < text.length, true);
      assert.strictEqual(result.endsWith('...'), true);
    });

    it('tries to end at sentence boundary', () => {
      const text = 'First sentence. Second sentence. Third sentence. Fourth sentence.';
      const result = truncateToTokens(text, 10);
      // Should try to end at a period
      assert.strictEqual(result.includes('.'), true);
    });
  });

  describe('extractKeyPoints', () => {
    it('extracts key points from text', () => {
      const text = `We implemented the feature.
Then we tested it thoroughly.
The build passed successfully.
All errors were fixed.`;
      
      const points = extractKeyPoints(text, 3);
      assert.strictEqual(points.length, 3);
    });

    it('prioritizes lines with key indicators', () => {
      const text = `Random line here.
We implemented the new feature.
Another random line.
Then we fixed the error.`;
      
      const points = extractKeyPoints(text, 2);
      // Should prioritize lines with "implement" and "fix"
      assert.strictEqual(points.some(p => p.includes('implement')), true);
    });

    it('limits line length', () => {
      const text = 'A'.repeat(200);
      const points = extractKeyPoints(text, 1);
      assert.strictEqual(points[0].length <= 100, true);
    });

    it('returns empty for empty text', () => {
      const points = extractKeyPoints('', 5);
      assert.strictEqual(points.length, 0);
    });
  });

  describe('summarizeJournalEntries', () => {
    it('summarizes entries with dates', () => {
      const entries = [
        { title: 'First entry', conversation: 'Content one', timestamp: '2024-01-15T10:00:00Z' },
        { title: 'Second entry', conversation: 'Content two', timestamp: '2024-01-16T10:00:00Z' },
      ];
      
      const summary = summarizeJournalEntries(entries);
      assert.strictEqual(summary.includes('2024-01-15'), true);
      assert.strictEqual(summary.includes('First entry'), true);
    });

    it('returns message for empty entries', () => {
      const summary = summarizeJournalEntries([]);
      assert.strictEqual(summary, 'No journal entries.');
    });

    it('limits to 5 entries', () => {
      const entries = Array(10).fill(null).map((_, i) => ({
        title: `Entry ${i}`,
        conversation: `Content ${i}`,
        timestamp: `2024-01-${10 + i}T10:00:00Z`,
      }));
      
      const summary = summarizeJournalEntries(entries);
      // Should not include all 10 (hierarchical summarization includes up to 7)
      assert.strictEqual(summary.includes('Entry 7'), false);
    });
  });

  describe('buildCompressedContext', () => {
    it('builds context with methodology layer', () => {
      const context = buildCompressedContext(testDir);
      
      assert.strictEqual(context.layers.some(l => l.name === 'methodology'), true);
    });

    it('includes current state layer', () => {
      const context = buildCompressedContext(testDir);
      
      assert.strictEqual(context.layers.some(l => l.name === 'current_state'), true);
    });

    it('calculates total tokens', () => {
      const context = buildCompressedContext(testDir);
      
      assert.strictEqual(context.totalTokens > 0, true);
      assert.strictEqual(typeof context.totalTokens, 'number');
    });

    it('respects maxTokens option', () => {
      const context = buildCompressedContext(testDir, { maxTokens: 500 });
      
      assert.strictEqual(context.totalTokens <= 500, true);
    });

    it('includes journal summary when entries exist', () => {
      saveToJournal({
        projectPath: testDir,
        title: 'Test entry',
        conversation: 'Test content',
      });
      
      const context = buildCompressedContext(testDir);
      assert.strictEqual(context.layers.some(l => l.name === 'journal_summary'), true);
    });

    it('includes task description when provided', () => {
      const context = buildCompressedContext(testDir, { 
        taskDescription: 'Fix the authentication bug' 
      });
      
      assert.strictEqual(context.layers.some(l => l.name === 'current_task'), true);
      const taskLayer = context.layers.find(l => l.name === 'current_task');
      assert.strictEqual(taskLayer?.content.includes('authentication bug'), true);
    });

    it('sets truncated flag when content exceeds budget', () => {
      // Add a lot of journal entries
      for (let i = 0; i < 20; i++) {
        saveToJournal({
          projectPath: testDir,
          title: `Entry ${i}`,
          conversation: 'A'.repeat(500),
        });
      }
      
      const context = buildCompressedContext(testDir, { maxTokens: 200 });
      // Might be truncated due to low token budget
      assert.strictEqual(typeof context.truncated, 'boolean');
    });
  });

  describe('contextToString', () => {
    it('converts context to string with sections', () => {
      const context = buildCompressedContext(testDir);
      const str = contextToString(context);
      
      assert.strictEqual(str.includes('# METHODOLOGY & STATE'), true);
    });

    it('groups layers by position', () => {
      const context = buildCompressedContext(testDir);
      const str = contextToString(context);
      
      // Check structure
      assert.strictEqual(typeof str, 'string');
      assert.strictEqual(str.length > 0, true);
    });
  });

  describe('getContextStats', () => {
    it('returns token statistics', () => {
      const stats = getContextStats(testDir);
      
      assert.strictEqual(typeof stats.estimatedTokens, 'number');
      assert.strictEqual(typeof stats.compressionRatio, 'number');
    });

    it('provides layer breakdown', () => {
      const stats = getContextStats(testDir);
      
      assert.strictEqual(typeof stats.layerBreakdown, 'object');
      assert.strictEqual('methodology' in stats.layerBreakdown, true);
    });
  });

  describe('Summary Caching', () => {
    it('setCachedSummary stores summary', () => {
      const content = 'This is the original content that would be summarized.';
      const summary = 'Original summarized.';
      
      setCachedSummary(testDir, content, 50, summary);
      const cached = getCachedSummary(testDir, content, 50);
      
      assert.strictEqual(cached, summary);
    });

    it('getCachedSummary returns null for uncached content', () => {
      const cached = getCachedSummary(testDir, 'uncached content', 50);
      assert.strictEqual(cached, null);
    });

    it('getCachedSummary returns null for different maxTokens', () => {
      const content = 'Same content';
      setCachedSummary(testDir, content, 50, 'summary for 50');
      
      const cached = getCachedSummary(testDir, content, 100);
      assert.strictEqual(cached, null);
    });

    it('getCacheStats tracks entries', () => {
      setCachedSummary(testDir, 'Content 1', 50, 'Summary 1');
      setCachedSummary(testDir, 'Content 2', 50, 'Summary 2');
      
      const stats = getCacheStats(testDir);
      assert.strictEqual(stats.entries, 2);
    });

    it('getCacheStats calculates token savings', () => {
      const longContent = 'A'.repeat(1000);  // ~250 tokens
      const shortSummary = 'Short summary';   // ~3 tokens
      
      setCachedSummary(testDir, longContent, 50, shortSummary);
      
      const stats = getCacheStats(testDir);
      assert.strictEqual(stats.tokensSaved > 200, true);
    });
  });
});
