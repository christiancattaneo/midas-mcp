import { describe, it } from 'node:test';
import assert from 'node:assert';

import { estimateTokens } from '../context.js';

describe('Context Module', () => {
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

    it('rounds up fractional tokens', () => {
      // 5 chars = 1.25 tokens, should round to 2
      const tokens = estimateTokens('hello');
      assert.strictEqual(tokens, 2);
    });
  });
});
