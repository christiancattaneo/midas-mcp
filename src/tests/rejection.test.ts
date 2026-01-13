import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { 
  recordSuggestion, 
  recordSuggestionOutcome, 
  getSuggestionAcceptanceRate,
  loadTracker,
} from '../tracker.js';

describe('Rejection and Re-analyze Functionality', () => {
  const testDir = join(process.cwd(), 'test-rejection-temp');
  const midasDir = join(testDir, '.midas');

  beforeEach(() => {
    mkdirSync(midasDir, { recursive: true });
    // loadTracker creates default tracker if none exists
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('recordSuggestion', () => {
    it('records a suggestion in history', () => {
      recordSuggestion(testDir, 'Create a Dockerfile');
      
      const tracker = loadTracker(testDir);
      assert.strictEqual(tracker.suggestionHistory.length, 1);
      assert.strictEqual(tracker.suggestionHistory[0].suggestion, 'Create a Dockerfile');
      assert.strictEqual(tracker.suggestionHistory[0].accepted, false);
    });

    it('keeps suggestions in order with most recent first', () => {
      recordSuggestion(testDir, 'First suggestion');
      recordSuggestion(testDir, 'Second suggestion');
      recordSuggestion(testDir, 'Third suggestion');
      
      const tracker = loadTracker(testDir);
      assert.strictEqual(tracker.suggestionHistory.length, 3);
      assert.strictEqual(tracker.suggestionHistory[0].suggestion, 'Third suggestion');
      assert.strictEqual(tracker.suggestionHistory[2].suggestion, 'First suggestion');
    });

    it('limits history to 20 entries', () => {
      for (let i = 0; i < 25; i++) {
        recordSuggestion(testDir, `Suggestion ${i}`);
      }
      
      const tracker = loadTracker(testDir);
      assert.strictEqual(tracker.suggestionHistory.length, 20);
      assert.strictEqual(tracker.suggestionHistory[0].suggestion, 'Suggestion 24');
    });
  });

  describe('recordSuggestionOutcome', () => {
    it('marks suggestion as accepted', () => {
      recordSuggestion(testDir, 'Run npm publish');
      recordSuggestionOutcome(testDir, true);
      
      const tracker = loadTracker(testDir);
      assert.strictEqual(tracker.suggestionHistory[0].accepted, true);
    });

    it('marks suggestion as declined with reason', () => {
      recordSuggestion(testDir, 'Create a Dockerfile');
      recordSuggestionOutcome(testDir, false, undefined, 'This is a CLI tool, not a web app');
      
      const tracker = loadTracker(testDir);
      assert.strictEqual(tracker.suggestionHistory[0].accepted, false);
      assert.strictEqual(tracker.suggestionHistory[0].rejectionReason, 'This is a CLI tool, not a web app');
    });

    it('stores user prompt when provided', () => {
      recordSuggestion(testDir, 'Implement feature X');
      recordSuggestionOutcome(testDir, true, 'Actually implement feature Y instead');
      
      const tracker = loadTracker(testDir);
      assert.strictEqual(tracker.suggestionHistory[0].userPrompt, 'Actually implement feature Y instead');
    });
  });

  describe('getSuggestionAcceptanceRate', () => {
    it('returns 0 for empty history', () => {
      const rate = getSuggestionAcceptanceRate(testDir);
      assert.strictEqual(rate, 0);
    });

    it('calculates correct acceptance rate', () => {
      recordSuggestion(testDir, 'Suggestion 1');
      recordSuggestionOutcome(testDir, true);
      recordSuggestion(testDir, 'Suggestion 2');
      recordSuggestionOutcome(testDir, false);
      recordSuggestion(testDir, 'Suggestion 3');
      recordSuggestionOutcome(testDir, true);
      recordSuggestion(testDir, 'Suggestion 4');
      recordSuggestionOutcome(testDir, true);
      
      const rate = getSuggestionAcceptanceRate(testDir);
      assert.strictEqual(rate, 75); // 3 out of 4 = 75%
    });

    it('only considers recent 10 suggestions', () => {
      // Add 5 accepted, then 10 rejected
      for (let i = 0; i < 5; i++) {
        recordSuggestion(testDir, `Accepted ${i}`);
        recordSuggestionOutcome(testDir, true);
      }
      for (let i = 0; i < 10; i++) {
        recordSuggestion(testDir, `Rejected ${i}`);
        recordSuggestionOutcome(testDir, false);
      }
      
      // Only the 10 most recent (all rejected) should be considered
      const rate = getSuggestionAcceptanceRate(testDir);
      assert.strictEqual(rate, 0);
    });
  });

  describe('Rejection reason in context', () => {
    it('stores rejection reason that can be retrieved', () => {
      recordSuggestion(testDir, 'Create Docker deployment');
      recordSuggestionOutcome(testDir, false, undefined, 'npm package, not a web service');
      
      recordSuggestion(testDir, 'Add CI/CD pipeline');
      recordSuggestionOutcome(testDir, false, undefined, 'already have GitHub Actions');
      
      const tracker = loadTracker(testDir);
      
      // Get rejected suggestions with reasons
      const rejectedWithReasons = tracker.suggestionHistory
        .filter(s => !s.accepted && s.rejectionReason);
      
      assert.strictEqual(rejectedWithReasons.length, 2);
      assert.ok(rejectedWithReasons.some(s => s.rejectionReason === 'npm package, not a web service'));
      assert.ok(rejectedWithReasons.some(s => s.rejectionReason === 'already have GitHub Actions'));
    });

    it('formats rejection reasons for analyzer context', () => {
      recordSuggestion(testDir, 'Create Dockerfile for deployment');
      recordSuggestionOutcome(testDir, false, undefined, 'CLI tool uses npm publish');
      
      const tracker = loadTracker(testDir);
      
      // Simulate what analyzer.ts does
      const rejectedSuggestions = tracker.suggestionHistory
        .filter(s => !s.accepted && s.rejectionReason)
        .slice(0, 3)
        .map(s => `- "${s.suggestion.slice(0, 60)}..." → Rejected: ${s.rejectionReason}`)
        .join('\n');
      
      assert.ok(rejectedSuggestions.includes('Create Dockerfile'));
      assert.ok(rejectedSuggestions.includes('CLI tool uses npm publish'));
    });
  });
});
