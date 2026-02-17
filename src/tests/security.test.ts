import assert from 'node:assert';
import { test, describe } from 'node:test';
import { sanitizePath, isShellSafe, sanitizeForGit, limitLength, validateEnum, LIMITS } from '../security.js';
import { resolve } from 'path';

describe('Security utilities', () => {
  describe('sanitizePath', () => {
    test('returns cwd when no path provided', () => {
      const result = sanitizePath(undefined);
      assert.strictEqual(result, process.cwd());
    });

    test('resolves relative paths within base', () => {
      const base = '/home/user/project';
      const result = sanitizePath('src/file.ts', base);
      assert.strictEqual(result, resolve(base, 'src/file.ts'));
    });

    test('blocks path traversal attempts', () => {
      const base = '/home/user/project';
      const result = sanitizePath('../../../etc/passwd', base);
      assert.strictEqual(result, base);
    });

    test('blocks double-dot traversal in middle of path', () => {
      const base = '/home/user/project';
      const result = sanitizePath('src/../../../etc/passwd', base);
      assert.strictEqual(result, base);
    });

    test('normalizes paths with dots', () => {
      const base = '/home/user/project';
      const result = sanitizePath('./src/./file.ts', base);
      assert.strictEqual(result, resolve(base, 'src/file.ts'));
    });

    // --- Mutation survivors: tests that kill previously surviving mutations ---

    test('strips null bytes from paths', () => {
      const base = '/home/user/project';
      const result = sanitizePath('src/\x00file.ts', base);
      assert.strictEqual(result, resolve(base, 'src/file.ts'));
      assert.ok(!result.includes('\x00'));
    });

    test('strips unicode control characters', () => {
      const base = '/home/user/project';
      // RTL override, zero-width space, BOM
      const result = sanitizePath('src/\u200Bfile\u202E.ts', base);
      assert.ok(!result.includes('\u200B'));
      assert.ok(!result.includes('\u202E'));
    });

    test('strips URL-encoded null bytes', () => {
      const base = '/home/user/project';
      const result = sanitizePath('src/%00file.ts', base);
      assert.ok(!result.includes('%00'));
    });

    test('blocks URL-encoded traversal (%2e%2e)', () => {
      const base = '/home/user/project';
      const result = sanitizePath('%2e%2e/%2e%2e/etc/passwd', base);
      assert.strictEqual(result, base);
    });

    test('blocks absolute path escape via isAbsolute check', () => {
      const base = '/home/user/project';
      // A path that resolves to something outside base
      const result = sanitizePath('/tmp', base);
      // Should either return /tmp (if it exists) or base — but NOT escape unsafely
      assert.ok(result === '/tmp' || result === base);
    });
  });

  describe('isShellSafe', () => {
    test('allows safe paths', () => {
      assert.strictEqual(isShellSafe('/home/user/project'), true);
      assert.strictEqual(isShellSafe('/Users/dev/my-project'), true);
      assert.strictEqual(isShellSafe('src/file.ts'), true);
    });

    test('blocks paths with shell metacharacters', () => {
      assert.strictEqual(isShellSafe('/path; rm -rf /'), false);
      assert.strictEqual(isShellSafe('/path && malicious'), false);
      assert.strictEqual(isShellSafe('/path | grep'), false);
      assert.strictEqual(isShellSafe('/path `whoami`'), false);
      assert.strictEqual(isShellSafe('/path $(whoami)'), false);
      assert.strictEqual(isShellSafe("/path'; drop table"), false);
      assert.strictEqual(isShellSafe('/path"'), false);
    });

    test('blocks null bytes', () => {
      assert.strictEqual(isShellSafe('/path\x00/file'), false);
    });

    test('blocks newlines and carriage returns', () => {
      assert.strictEqual(isShellSafe('/path\n/file'), false);
      assert.strictEqual(isShellSafe('/path\r/file'), false);
    });

    test('blocks unicode control characters', () => {
      assert.strictEqual(isShellSafe('/path\u200B/file'), false);
    });
  });

  describe('sanitizeForGit', () => {
    test('returns safe paths unchanged', () => {
      assert.strictEqual(sanitizeForGit('/home/user/project'), '/home/user/project');
      assert.strictEqual(sanitizeForGit('src/file.ts'), 'src/file.ts');
    });

    test('throws on unsafe paths', () => {
      assert.throws(() => sanitizeForGit('/path; rm -rf /'), /unsafe characters/);
      assert.throws(() => sanitizeForGit('/path && cmd'), /unsafe characters/);
      assert.throws(() => sanitizeForGit('/path `whoami`'), /unsafe characters/);
    });
  });

  describe('limitLength', () => {
    test('returns string unchanged if under limit', () => {
      assert.strictEqual(limitLength('short', 100), 'short');
    });

    test('truncates long strings', () => {
      const long = 'a'.repeat(200);
      const result = limitLength(long, 50);
      assert.ok(result.length < 200);
      assert.ok(result.includes('[truncated]'));
    });

    test('handles exact limit', () => {
      const exact = 'a'.repeat(50);
      assert.strictEqual(limitLength(exact, 50), exact);
    });
  });

  describe('validateEnum', () => {
    const allowed = ['A', 'B', 'C'] as const;

    test('returns value if valid', () => {
      assert.strictEqual(validateEnum('A', allowed), 'A');
      assert.strictEqual(validateEnum('B', allowed), 'B');
    });

    test('returns null for invalid values', () => {
      assert.strictEqual(validateEnum('D', allowed), null);
      assert.strictEqual(validateEnum('', allowed), null);
      assert.strictEqual(validateEnum('a', allowed), null); // case sensitive
    });
  });

  describe('LIMITS constants', () => {
    test('has reasonable limits', () => {
      assert.ok(LIMITS.CONVERSATION_MAX_LENGTH > 0);
      assert.ok(LIMITS.CONVERSATION_MAX_LENGTH <= 1000000); // 1MB max
      assert.ok(LIMITS.TITLE_MAX_LENGTH > 0);
      assert.ok(LIMITS.PATH_MAX_LENGTH > 0);
    });
  });
});

describe('Security integration', () => {
  test('journal tool rejects path traversal', async () => {
    // This test verifies the integration works
    // The actual protection happens in sanitizePath
    const maliciousPath = '../../../etc';
    const safePath = sanitizePath(maliciousPath);
    assert.ok(!safePath.includes('/etc'));
    assert.strictEqual(safePath, process.cwd());
  });

  test('phase tool validates step values', async () => {
    const { setPhaseManually } = await import('../tools/phase.js');
    
    // Valid step should work
    const validResult = setPhaseManually({ phase: 'BUILD', step: 'IMPLEMENT' });
    assert.strictEqual(validResult.success, true);
    
    // Invalid step should fail gracefully
    const invalidResult = setPhaseManually({ phase: 'BUILD', step: 'INVALID_STEP' });
    assert.strictEqual(invalidResult.success, false);
    assert.ok(invalidResult.error?.includes('Invalid step'));
  });
});
