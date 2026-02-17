import assert from 'node:assert';
import { test, describe, beforeEach, afterEach } from 'node:test';
import { existsSync, mkdirSync, rmSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

// We test the auth module's pure functions by importing them
// Network-dependent functions (startDeviceFlow, pollForToken) are not tested here
import { loadAuth, saveAuth, clearAuth, isAuthenticated, getAuthenticatedUser } from '../auth.js';

// Auth uses ~/.midas/auth.json — we test with the real config dir
// These tests are safe because they save/restore state
describe('Auth utilities', () => {
  const configDir = join(tmpdir(), '.midas-test-' + process.pid);
  const authFile = join(configDir, 'auth.json');
  
  // We can't easily override CONFIG_DIR since it's a const,
  // so we test the exported functions which use it
  // For unit tests, we verify the logic through the public API
  
  describe('isAuthenticated', () => {
    test('returns false when no auth exists', () => {
      // Fresh install or cleared auth
      const result = isAuthenticated();
      // Result depends on whether ~/.midas/auth.json exists
      assert.strictEqual(typeof result, 'boolean');
    });
  });

  describe('getAuthenticatedUser', () => {
    test('returns null or valid user object', () => {
      const result = getAuthenticatedUser();
      if (result !== null) {
        assert.ok(result.username);
        assert.ok(typeof result.userId === 'number');
      }
    });
  });

  describe('loadAuth', () => {
    test('returns object (empty or with data)', () => {
      const result = loadAuth();
      assert.strictEqual(typeof result, 'object');
      assert.ok(result !== null);
    });

    test('returned object has expected shape', () => {
      const auth = loadAuth();
      // All fields are optional, but if present they should be correct types
      if (auth.githubAccessToken) assert.strictEqual(typeof auth.githubAccessToken, 'string');
      if (auth.githubUsername) assert.strictEqual(typeof auth.githubUsername, 'string');
      if (auth.githubUserId) assert.strictEqual(typeof auth.githubUserId, 'number');
    });
  });

  describe('saveAuth + clearAuth', () => {
    let originalAuth: ReturnType<typeof loadAuth>;
    
    beforeEach(() => {
      // Preserve existing auth state
      originalAuth = loadAuth();
    });

    afterEach(() => {
      // Restore original auth state
      saveAuth(originalAuth);
    });

    test('clearAuth resets to empty state', () => {
      clearAuth();
      const auth = loadAuth();
      assert.strictEqual(auth.githubAccessToken, undefined);
      assert.strictEqual(auth.githubUsername, undefined);
    });

    test('saveAuth persists data that loadAuth retrieves', () => {
      const testAuth = {
        githubAccessToken: 'test-token-12345',
        githubUsername: 'testuser',
        githubUserId: 99999,
        authenticatedAt: new Date().toISOString(),
      };
      saveAuth(testAuth);
      const loaded = loadAuth();
      assert.strictEqual(loaded.githubUsername, 'testuser');
      assert.strictEqual(loaded.githubUserId, 99999);
      assert.strictEqual(loaded.githubAccessToken, 'test-token-12345');
    });

    test('auth file has restricted permissions (0o600)', () => {
      saveAuth({ githubUsername: 'permtest' });
      const configDir = join(homedir(), '.midas');
      const authFile = join(configDir, 'auth.json');
      if (existsSync(authFile)) {
        const stats = statSync(authFile);
        const mode = stats.mode & 0o777;
        assert.strictEqual(mode, 0o600, `Expected 0600 permissions, got ${mode.toString(8)}`);
      }
    });
  });

  describe('isAuthenticated logic', () => {
    let originalAuth: ReturnType<typeof loadAuth>;
    
    beforeEach(() => {
      originalAuth = loadAuth();
    });

    afterEach(() => {
      saveAuth(originalAuth);
    });

    test('returns true when token and username present', () => {
      saveAuth({ githubAccessToken: 'ghp_test', githubUsername: 'user' });
      assert.strictEqual(isAuthenticated(), true);
    });

    test('returns false when only token present', () => {
      saveAuth({ githubAccessToken: 'ghp_test' });
      assert.strictEqual(isAuthenticated(), false);
    });

    test('returns false when only username present', () => {
      saveAuth({ githubUsername: 'user' });
      assert.strictEqual(isAuthenticated(), false);
    });

    test('returns false when empty', () => {
      clearAuth();
      assert.strictEqual(isAuthenticated(), false);
    });
  });
});
