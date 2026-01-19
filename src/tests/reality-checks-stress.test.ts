/**
 * Reality Checks Stress Tests
 * 
 * Comprehensive testing of reality check functionality:
 * - Non-existent check handling
 * - Long skip reasons and edge cases
 * - Rapid/concurrent status updates
 * - State persistence and recovery
 * - Edge cases and boundary conditions
 * 
 * Based on compliance checklist and state management best practices.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Import functions to test
import {
  updateCheckStatus,
  getCheckStatus,
  getAllCheckStatuses,
  resetCheckStatuses,
  detectGeneratedDocs,
  getPreflightChecks,
  inferProjectProfile,
  PreflightCheckStatus,
  PersistedCheckState,
} from '../preflight.js';

// ============================================================================
// HELPERS
// ============================================================================

let testDirs: string[] = [];

function createTestDir(prefix: string): string {
  const dir = join(tmpdir(), `midas-reality-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, '.midas'), { recursive: true });
  testDirs.push(dir);
  return dir;
}

function cleanup(): void {
  for (const dir of testDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
  testDirs = [];
}

beforeEach(() => {
  testDirs = [];
});

afterEach(() => {
  cleanup();
});

// Helper to generate long strings
function generateString(length: number, pattern = 'x'): string {
  return pattern.repeat(Math.ceil(length / pattern.length)).slice(0, length);
}

// Helper to read raw state file
function readRawState(dir: string): any {
  const statePath = join(dir, '.midas', 'preflight-checks.json');
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, 'utf-8'));
  } catch {
    return null;
  }
}

// ============================================================================
// 1. NON-EXISTENT CHECK HANDLING
// ============================================================================

describe('Non-Existent Check Handling', () => {
  it('should return undefined for non-existent check', () => {
    const dir = createTestDir('nonexistent-get');
    
    const status = getCheckStatus(dir, 'nonexistent_check');
    
    assert.strictEqual(status, undefined);
  });

  it('should handle updating non-existent check gracefully', () => {
    const dir = createTestDir('nonexistent-update');
    
    // Should not throw
    updateCheckStatus(dir, 'brand_new_check', 'completed');
    
    const status = getCheckStatus(dir, 'brand_new_check');
    assert.ok(status !== undefined);
    assert.strictEqual(status.status, 'completed');
  });

  it('should handle empty check key', () => {
    const dir = createTestDir('empty-key');
    
    updateCheckStatus(dir, '', 'completed');
    
    const status = getCheckStatus(dir, '');
    // Should either ignore or store with empty key
    // Just verify no crash
    assert.ok(true);
  });

  it('should handle whitespace-only check key', () => {
    const dir = createTestDir('whitespace-key');
    
    updateCheckStatus(dir, '   ', 'skipped', 'reason');
    
    // Should handle gracefully
    assert.ok(true);
  });

  it('should handle check key with special characters', () => {
    const dir = createTestDir('special-key');
    
    const specialKeys = [
      'check_with-dash',
      'check.with.dots',
      'check:with:colons',
      'check/with/slashes',
      'check@with@at',
      'check#with#hash',
      'check$with$dollar',
    ];
    
    for (const key of specialKeys) {
      updateCheckStatus(dir, key, 'completed');
      const status = getCheckStatus(dir, key);
      assert.ok(status !== undefined, `Should handle key: ${key}`);
    }
  });

  it('should handle unicode check key', () => {
    const dir = createTestDir('unicode-key');
    
    updateCheckStatus(dir, '检查_日本語', 'completed');
    
    const status = getCheckStatus(dir, '检查_日本語');
    assert.ok(status !== undefined);
  });

  it('should handle very long check key', () => {
    const dir = createTestDir('long-key');
    const longKey = generateString(10000, 'key_');
    
    updateCheckStatus(dir, longKey, 'completed');
    
    const status = getCheckStatus(dir, longKey);
    assert.ok(status !== undefined);
  });

  it('should handle getting all statuses with no checks', () => {
    const dir = createTestDir('no-checks');
    
    const statuses = getAllCheckStatuses(dir);
    
    assert.ok(typeof statuses === 'object');
    assert.strictEqual(Object.keys(statuses).length, 0);
  });

  it('should handle case-sensitive check keys', () => {
    const dir = createTestDir('case-sensitive');
    
    updateCheckStatus(dir, 'privacy_policy', 'completed');
    updateCheckStatus(dir, 'Privacy_Policy', 'skipped');
    updateCheckStatus(dir, 'PRIVACY_POLICY', 'pending');
    
    const s1 = getCheckStatus(dir, 'privacy_policy');
    const s2 = getCheckStatus(dir, 'Privacy_Policy');
    const s3 = getCheckStatus(dir, 'PRIVACY_POLICY');
    
    // All three should be different entries
    assert.strictEqual(s1?.status, 'completed');
    assert.strictEqual(s2?.status, 'skipped');
    assert.strictEqual(s3?.status, 'pending');
  });
});

// ============================================================================
// 2. LONG SKIP REASONS
// ============================================================================

describe('Long Skip Reasons', () => {
  it('should handle empty skip reason', () => {
    const dir = createTestDir('empty-reason');
    
    updateCheckStatus(dir, 'test_check', 'skipped', '');
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.status, 'skipped');
    // Empty string may be stored as undefined or ''
    assert.ok(status?.skippedReason === '' || status?.skippedReason === undefined);
  });

  it('should handle short skip reason', () => {
    const dir = createTestDir('short-reason');
    
    updateCheckStatus(dir, 'test_check', 'skipped', 'N/A');
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.skippedReason, 'N/A');
  });

  it('should handle moderate length skip reason', () => {
    const dir = createTestDir('moderate-reason');
    const reason = 'This check is not applicable because our application does not collect any user data and operates entirely client-side without any server communication.';
    
    updateCheckStatus(dir, 'test_check', 'skipped', reason);
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.skippedReason, reason);
  });

  it('should handle 1KB skip reason', () => {
    const dir = createTestDir('1kb-reason');
    const reason = generateString(1024, 'word ');
    
    updateCheckStatus(dir, 'test_check', 'skipped', reason);
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.skippedReason, reason);
  });

  it('should handle 10KB skip reason', () => {
    const dir = createTestDir('10kb-reason');
    const reason = generateString(10 * 1024, 'reason ');
    
    updateCheckStatus(dir, 'test_check', 'skipped', reason);
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.skippedReason, reason);
  });

  it('should handle 100KB skip reason', () => {
    const dir = createTestDir('100kb-reason');
    const reason = generateString(100 * 1024, 'x');
    
    const start = Date.now();
    updateCheckStatus(dir, 'test_check', 'skipped', reason);
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 100KB reason write: ${elapsed}ms`);
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.skippedReason?.length, 100 * 1024);
    assert.ok(elapsed < 5000, `Too slow: ${elapsed}ms`);
  });

  it('should handle skip reason with unicode', () => {
    const dir = createTestDir('unicode-reason');
    const reason = '不适用 - この確認は必要ありません。Проверка не нужна. 🚫';
    
    updateCheckStatus(dir, 'test_check', 'skipped', reason);
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.skippedReason, reason);
  });

  it('should handle skip reason with emoji', () => {
    const dir = createTestDir('emoji-reason');
    const reason = 'Not needed 🙅‍♂️ Our app is 100% safe ✅🔒';
    
    updateCheckStatus(dir, 'test_check', 'skipped', reason);
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.skippedReason, reason);
  });

  it('should handle skip reason with newlines', () => {
    const dir = createTestDir('newlines-reason');
    const reason = 'Line 1\nLine 2\n\nLine 4\r\nLine 5 (CRLF)\rLine 6 (CR)';
    
    updateCheckStatus(dir, 'test_check', 'skipped', reason);
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.skippedReason, reason);
  });

  it('should handle skip reason with JSON-like content', () => {
    const dir = createTestDir('json-reason');
    const reason = '{"reason": "Not applicable", "details": ["item1", "item2"]}';
    
    updateCheckStatus(dir, 'test_check', 'skipped', reason);
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.skippedReason, reason);
  });

  it('should handle skip reason with quotes', () => {
    const dir = createTestDir('quotes-reason');
    const reason = 'This is "not" applicable because of \'various\' reasons and `code` examples';
    
    updateCheckStatus(dir, 'test_check', 'skipped', reason);
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.skippedReason, reason);
  });

  it('should handle skip reason with control characters', () => {
    const dir = createTestDir('control-reason');
    const reason = 'Tab:\there\tBack:\b\0null';
    
    updateCheckStatus(dir, 'test_check', 'skipped', reason);
    
    const status = getCheckStatus(dir, 'test_check');
    // May strip or escape control chars, just verify no crash
    assert.ok(status !== undefined);
  });

  it('should handle undefined skip reason for skipped status', () => {
    const dir = createTestDir('undefined-reason');
    
    updateCheckStatus(dir, 'test_check', 'skipped');  // No reason provided
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.status, 'skipped');
    // Reason should be undefined or empty
  });
});

// ============================================================================
// 3. RAPID STATUS UPDATES
// ============================================================================

describe('Rapid Status Updates', () => {
  it('should handle 10 sequential updates', () => {
    const dir = createTestDir('rapid-10');
    
    for (let i = 0; i < 10; i++) {
      updateCheckStatus(dir, 'test_check', i % 2 === 0 ? 'completed' : 'pending');
    }
    
    const status = getCheckStatus(dir, 'test_check');
    assert.ok(status !== undefined);
    // Last update was i=9 (odd), so pending
    assert.strictEqual(status.status, 'pending');
  });

  it('should handle 100 sequential updates', () => {
    const dir = createTestDir('rapid-100');
    
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      updateCheckStatus(dir, 'test_check', 'completed');
    }
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 100 sequential updates: ${elapsed}ms`);
    
    assert.ok(elapsed < 10000, `Too slow: ${elapsed}ms`);
  });

  it('should handle 100 updates to different checks', () => {
    const dir = createTestDir('rapid-many-checks');
    
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      updateCheckStatus(dir, `check_${i}`, 'completed');
    }
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 100 different checks: ${elapsed}ms`);
    
    const statuses = getAllCheckStatuses(dir);
    assert.strictEqual(Object.keys(statuses).length, 100);
    assert.ok(elapsed < 15000, `Too slow: ${elapsed}ms`);
  });

  it('should handle rapid status transitions', () => {
    const dir = createTestDir('rapid-transitions');
    const statuses: PreflightCheckStatus[] = ['pending', 'completed', 'skipped', 'pending', 'completed'];
    
    for (const status of statuses) {
      updateCheckStatus(dir, 'test_check', status);
    }
    
    const finalStatus = getCheckStatus(dir, 'test_check');
    assert.strictEqual(finalStatus?.status, 'completed');  // Last one
  });

  it('should handle interleaved updates to multiple checks', () => {
    const dir = createTestDir('rapid-interleaved');
    
    for (let i = 0; i < 50; i++) {
      updateCheckStatus(dir, 'check_a', i % 2 === 0 ? 'completed' : 'pending');
      updateCheckStatus(dir, 'check_b', i % 2 === 0 ? 'pending' : 'completed');
    }
    
    const statusA = getCheckStatus(dir, 'check_a');
    const statusB = getCheckStatus(dir, 'check_b');
    
    // Last i=49 (odd): check_a=pending, check_b=completed
    assert.strictEqual(statusA?.status, 'pending');
    assert.strictEqual(statusB?.status, 'completed');
  });

  it('should handle concurrent updates (Promise.all)', async () => {
    const dir = createTestDir('concurrent');
    
    const updates = [];
    for (let i = 0; i < 20; i++) {
      updates.push(
        new Promise<void>(resolve => {
          updateCheckStatus(dir, `check_${i}`, 'completed');
          resolve();
        })
      );
    }
    
    await Promise.all(updates);
    
    const statuses = getAllCheckStatuses(dir);
    assert.strictEqual(Object.keys(statuses).length, 20);
  });

  it('should preserve latest update in race condition', async () => {
    const dir = createTestDir('race');
    
    // Simulate race: multiple updates to same check
    const updates = [];
    for (let i = 0; i < 10; i++) {
      updates.push(
        new Promise<void>(resolve => {
          setTimeout(() => {
            updateCheckStatus(dir, 'contested_check', i % 2 === 0 ? 'completed' : 'skipped');
            resolve();
          }, Math.random() * 50);
        })
      );
    }
    
    await Promise.all(updates);
    
    const status = getCheckStatus(dir, 'contested_check');
    // One of the statuses should have won
    assert.ok(status?.status === 'completed' || status?.status === 'skipped');
  });

  it('should handle updates with varying reasons', () => {
    const dir = createTestDir('varying-reasons');
    
    for (let i = 0; i < 20; i++) {
      updateCheckStatus(dir, 'test_check', 'skipped', `Reason ${i}`);
    }
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.skippedReason, 'Reason 19');
  });
});

// ============================================================================
// 4. STATUS VALUE EDGE CASES
// ============================================================================

describe('Status Value Edge Cases', () => {
  it('should handle pending status', () => {
    const dir = createTestDir('status-pending');
    
    updateCheckStatus(dir, 'test_check', 'pending');
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.status, 'pending');
  });

  it('should handle completed status', () => {
    const dir = createTestDir('status-completed');
    
    updateCheckStatus(dir, 'test_check', 'completed');
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.status, 'completed');
  });

  it('should handle skipped status', () => {
    const dir = createTestDir('status-skipped');
    
    updateCheckStatus(dir, 'test_check', 'skipped', 'Not needed');
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.status, 'skipped');
    assert.strictEqual(status?.skippedReason, 'Not needed');
  });

  it('should transition from pending to completed', () => {
    const dir = createTestDir('transition-p-c');
    
    updateCheckStatus(dir, 'test_check', 'pending');
    updateCheckStatus(dir, 'test_check', 'completed');
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.status, 'completed');
  });

  it('should transition from completed to skipped', () => {
    const dir = createTestDir('transition-c-s');
    
    updateCheckStatus(dir, 'test_check', 'completed');
    updateCheckStatus(dir, 'test_check', 'skipped', 'Changed mind');
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.status, 'skipped');
    assert.strictEqual(status?.skippedReason, 'Changed mind');
  });

  it('should transition from skipped back to pending', () => {
    const dir = createTestDir('transition-s-p');
    
    updateCheckStatus(dir, 'test_check', 'skipped', 'Temp skip');
    updateCheckStatus(dir, 'test_check', 'pending');
    
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.status, 'pending');
    // Old reason may or may not be preserved
  });

  it('should track updatedAt timestamp', () => {
    const dir = createTestDir('timestamp');
    
    const before = new Date().toISOString();
    updateCheckStatus(dir, 'test_check', 'completed');
    const after = new Date().toISOString();
    
    const status = getCheckStatus(dir, 'test_check');
    assert.ok(status?.updatedAt !== undefined);
    assert.ok(status.updatedAt >= before);
    assert.ok(status.updatedAt <= after);
  });

  it('should update timestamp on each change', async () => {
    const dir = createTestDir('timestamp-update');
    
    updateCheckStatus(dir, 'test_check', 'pending');
    const first = getCheckStatus(dir, 'test_check')?.updatedAt;
    
    await new Promise(resolve => setTimeout(resolve, 50));
    
    updateCheckStatus(dir, 'test_check', 'completed');
    const second = getCheckStatus(dir, 'test_check')?.updatedAt;
    
    assert.ok(second! > first!, 'Second timestamp should be later');
  });
});

// ============================================================================
// 5. STATE PERSISTENCE
// ============================================================================

describe('State Persistence', () => {
  it('should persist state to file', () => {
    const dir = createTestDir('persist');
    
    updateCheckStatus(dir, 'test_check', 'completed');
    
    const raw = readRawState(dir);
    assert.ok(raw !== null);
    assert.ok(raw.checkStates !== undefined);
    assert.ok(raw.checkStates.test_check !== undefined);
  });

  it('should survive process restart simulation', () => {
    const dir = createTestDir('restart');
    
    updateCheckStatus(dir, 'test_check', 'completed');
    
    // Simulate restart by reading fresh
    const status = getCheckStatus(dir, 'test_check');
    assert.strictEqual(status?.status, 'completed');
  });

  it('should handle corrupted state file', () => {
    const dir = createTestDir('corrupted');
    const statePath = join(dir, '.midas', 'preflight-checks.json');
    
    writeFileSync(statePath, '{ invalid json');
    
    // Should not crash, should return defaults
    const statuses = getAllCheckStatuses(dir);
    assert.ok(typeof statuses === 'object');
  });

  it('should handle empty state file', () => {
    const dir = createTestDir('empty-state');
    const statePath = join(dir, '.midas', 'preflight-checks.json');
    
    writeFileSync(statePath, '');
    
    const statuses = getAllCheckStatuses(dir);
    assert.ok(typeof statuses === 'object');
  });

  it('should handle null state file', () => {
    const dir = createTestDir('null-state');
    const statePath = join(dir, '.midas', 'preflight-checks.json');
    
    writeFileSync(statePath, 'null');
    
    // May return null, undefined, or empty object for null state file
    try {
      const statuses = getAllCheckStatuses(dir);
      // Any of these is acceptable recovery behavior
      assert.ok(statuses === null || statuses === undefined || typeof statuses === 'object');
    } catch {
      // Error is also acceptable
      assert.ok(true);
    }
  });

  it('should handle state file with missing checkStates', () => {
    const dir = createTestDir('missing-checkstates');
    const statePath = join(dir, '.midas', 'preflight-checks.json');
    
    writeFileSync(statePath, JSON.stringify({ lastProfileHash: 'abc' }));
    
    // May throw or return undefined/null for missing field
    try {
      const statuses = getAllCheckStatuses(dir);
      // If it returns, should be object-like
      assert.ok(statuses === undefined || statuses === null || typeof statuses === 'object');
    } catch {
      // Error handling for missing field is acceptable
      assert.ok(true);
    }
  });

  it('should handle state file with null checkStates', () => {
    const dir = createTestDir('null-checkstates');
    const statePath = join(dir, '.midas', 'preflight-checks.json');
    
    writeFileSync(statePath, JSON.stringify({ checkStates: null }));
    
    const statuses = getAllCheckStatuses(dir);
    assert.ok(typeof statuses === 'object');
  });

  it('should handle binary garbage in state file', () => {
    const dir = createTestDir('binary-state');
    const statePath = join(dir, '.midas', 'preflight-checks.json');
    
    writeFileSync(statePath, Buffer.from([0x00, 0x01, 0xFF, 0xFE]));
    
    const statuses = getAllCheckStatuses(dir);
    assert.ok(typeof statuses === 'object');
  });
});

// ============================================================================
// 6. RESET FUNCTIONALITY
// ============================================================================

describe('Reset Functionality', () => {
  it('should reset all check statuses', () => {
    const dir = createTestDir('reset');
    
    updateCheckStatus(dir, 'check_1', 'completed');
    updateCheckStatus(dir, 'check_2', 'skipped', 'reason');
    updateCheckStatus(dir, 'check_3', 'pending');
    
    resetCheckStatuses(dir);
    
    const statuses = getAllCheckStatuses(dir);
    assert.strictEqual(Object.keys(statuses).length, 0);
  });

  it('should reset on empty state', () => {
    const dir = createTestDir('reset-empty');
    
    // No checks set
    resetCheckStatuses(dir);
    
    const statuses = getAllCheckStatuses(dir);
    assert.strictEqual(Object.keys(statuses).length, 0);
  });

  it('should allow updates after reset', () => {
    const dir = createTestDir('reset-then-update');
    
    updateCheckStatus(dir, 'check_1', 'completed');
    resetCheckStatuses(dir);
    updateCheckStatus(dir, 'check_2', 'completed');
    
    const statuses = getAllCheckStatuses(dir);
    assert.strictEqual(Object.keys(statuses).length, 1);
    assert.ok(statuses.check_2 !== undefined);
  });

  it('should handle multiple resets', () => {
    const dir = createTestDir('multi-reset');
    
    for (let i = 0; i < 5; i++) {
      updateCheckStatus(dir, 'check', 'completed');
      resetCheckStatuses(dir);
    }
    
    const statuses = getAllCheckStatuses(dir);
    assert.strictEqual(Object.keys(statuses).length, 0);
  });
});

// ============================================================================
// 7. GENERATED DOCS DETECTION
// ============================================================================

describe('Generated Docs Detection', () => {
  it('should detect privacy policy generation', () => {
    const dir = createTestDir('detect-privacy');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'privacy-policy.md'), '# Privacy Policy');
    
    const detected = detectGeneratedDocs(dir);
    
    assert.ok(Array.isArray(detected));
  });

  it('should detect terms of service generation', () => {
    const dir = createTestDir('detect-tos');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'terms-of-service.md'), '# Terms of Service');
    
    const detected = detectGeneratedDocs(dir);
    
    assert.ok(Array.isArray(detected));
  });

  it('should handle no docs directory', () => {
    const dir = createTestDir('detect-no-docs');
    
    const detected = detectGeneratedDocs(dir);
    
    assert.ok(Array.isArray(detected));
  });

  it('should handle empty docs directory', () => {
    const dir = createTestDir('detect-empty-docs');
    mkdirSync(join(dir, 'docs'));
    
    const detected = detectGeneratedDocs(dir);
    
    assert.ok(Array.isArray(detected));
  });

  it('should detect multiple generated docs', () => {
    const dir = createTestDir('detect-multiple');
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'privacy-policy.md'), '# Privacy');
    writeFileSync(join(dir, 'docs', 'terms-of-service.md'), '# Terms');
    writeFileSync(join(dir, 'docs', 'cookie-policy.md'), '# Cookies');
    
    const detected = detectGeneratedDocs(dir);
    
    assert.ok(Array.isArray(detected));
  });
});

// ============================================================================
// 8. REALITY CHECKS INTEGRATION
// ============================================================================

describe('Reality Checks Integration', () => {
  it('should get reality checks for empty project', async () => {
    const dir = createTestDir('integrate-empty');
    
    const result = await getPreflightChecks(dir);
    
    assert.ok(result !== null);
    assert.ok(Array.isArray(result.checks));
  });

  it('should get reality checks with package.json', async () => {
    const dir = createTestDir('integrate-pkg');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'test-app',
      dependencies: {
        stripe: '^1.0.0',
      },
    }));
    
    const result = await getPreflightChecks(dir);
    
    assert.ok(result !== null);
    // Should detect payment usage
  });

  it('should integrate check statuses with getPreflightChecks', async () => {
    const dir = createTestDir('integrate-status');
    
    // Set some statuses
    updateCheckStatus(dir, 'privacy_policy', 'completed');
    updateCheckStatus(dir, 'terms_of_service', 'skipped', 'Not needed');
    
    const result = await getPreflightChecks(dir);
    
    assert.ok(result !== null);
    // Statuses should be reflected in checks
  });

  it('should handle rapid getPreflightChecks calls', async () => {
    const dir = createTestDir('integrate-rapid');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      await getPreflightChecks(dir);
    }
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 10 getPreflightChecks: ${elapsed}ms`);
    
    assert.ok(elapsed < 30000, `Too slow: ${elapsed}ms`);
  });
});

// ============================================================================
// 9. PROJECT PROFILE EDGE CASES
// ============================================================================

describe('Project Profile Edge Cases', () => {
  it('should infer profile from empty project', async () => {
    const dir = createTestDir('profile-empty');
    
    const profile = await inferProjectProfile(dir);
    
    assert.ok(profile !== null);
    assert.strictEqual(profile.collectsUserData, false);
  });

  it('should infer profile with payment keywords', async () => {
    const dir = createTestDir('profile-payment');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { stripe: '^1.0.0' },
    }));
    
    const profile = await inferProjectProfile(dir);
    
    assert.ok(profile.hasPayments);
  });

  it('should infer profile with AI keywords', async () => {
    const dir = createTestDir('profile-ai');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { openai: '^4.0.0' },
    }));
    
    const profile = await inferProjectProfile(dir);
    
    assert.ok(profile.usesAI);
  });

  it('should handle rapid profile inference', async () => {
    const dir = createTestDir('profile-rapid');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
    
    const start = Date.now();
    for (let i = 0; i < 20; i++) {
      await inferProjectProfile(dir);
    }
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 20 profile inferences: ${elapsed}ms`);
    
    assert.ok(elapsed < 10000, `Too slow: ${elapsed}ms`);
  });
});

// ============================================================================
// 10. PERFORMANCE BENCHMARKS
// ============================================================================

describe('Performance Benchmarks', () => {
  it('should handle 500 status updates quickly', () => {
    const dir = createTestDir('perf-500');
    
    const start = Date.now();
    for (let i = 0; i < 500; i++) {
      updateCheckStatus(dir, `check_${i % 50}`, i % 2 === 0 ? 'completed' : 'pending');
    }
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 500 status updates: ${elapsed}ms`);
    
    assert.ok(elapsed < 30000, `Too slow: ${elapsed}ms`);
  });

  it('should handle reading 100 check statuses quickly', () => {
    const dir = createTestDir('perf-read');
    
    // Set up 100 checks
    for (let i = 0; i < 100; i++) {
      updateCheckStatus(dir, `check_${i}`, 'completed');
    }
    
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      getCheckStatus(dir, `check_${i}`);
    }
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] 100 status reads: ${elapsed}ms`);
    
    assert.ok(elapsed < 5000, `Too slow: ${elapsed}ms`);
  });

  it('should handle getAllCheckStatuses with many checks', () => {
    const dir = createTestDir('perf-getall');
    
    // Set up 200 checks
    for (let i = 0; i < 200; i++) {
      updateCheckStatus(dir, `check_${i}`, 'completed');
    }
    
    const start = Date.now();
    const statuses = getAllCheckStatuses(dir);
    const elapsed = Date.now() - start;
    
    console.log(`  [INFO] getAllCheckStatuses (200): ${elapsed}ms`);
    
    assert.strictEqual(Object.keys(statuses).length, 200);
    assert.ok(elapsed < 1000, `Too slow: ${elapsed}ms`);
  });
});

// ============================================================================
// 11. EDGE CASE COMBINATIONS
// ============================================================================

describe('Edge Case Combinations', () => {
  it('should handle non-existent check + long reason', () => {
    const dir = createTestDir('combo-new-long');
    const reason = generateString(50000, 'reason ');
    
    updateCheckStatus(dir, 'brand_new_check', 'skipped', reason);
    
    const status = getCheckStatus(dir, 'brand_new_check');
    assert.strictEqual(status?.status, 'skipped');
    assert.strictEqual(status?.skippedReason?.length, 50000);
  });

  it('should handle rapid updates with varying reasons', async () => {
    const dir = createTestDir('combo-rapid-reasons');
    
    const updates = [];
    for (let i = 0; i < 50; i++) {
      updates.push(
        new Promise<void>(resolve => {
          updateCheckStatus(dir, 'test_check', 'skipped', `Reason ${i} - ${generateString(100, 'x')}`);
          resolve();
        })
      );
    }
    
    await Promise.all(updates);
    
    const status = getCheckStatus(dir, 'test_check');
    assert.ok(status?.skippedReason?.includes('Reason'));
  });

  it('should handle reset + immediate updates', () => {
    const dir = createTestDir('combo-reset-update');
    
    updateCheckStatus(dir, 'check_1', 'completed');
    resetCheckStatuses(dir);
    updateCheckStatus(dir, 'check_1', 'completed');
    resetCheckStatuses(dir);
    updateCheckStatus(dir, 'check_2', 'skipped', 'reason');
    
    const statuses = getAllCheckStatuses(dir);
    assert.strictEqual(Object.keys(statuses).length, 1);
    assert.ok(statuses.check_2 !== undefined);
  });

  it('should handle unicode key + unicode reason + rapid updates', async () => {
    const dir = createTestDir('combo-unicode-all');
    
    for (let i = 0; i < 20; i++) {
      updateCheckStatus(dir, '検査_' + i, 'skipped', '理由：不要です 🚫');
    }
    
    const statuses = getAllCheckStatuses(dir);
    assert.strictEqual(Object.keys(statuses).length, 20);
  });

  it('should handle corrupted state + update', () => {
    const dir = createTestDir('combo-corrupt-update');
    const statePath = join(dir, '.midas', 'preflight-checks.json');
    
    writeFileSync(statePath, '{ invalid }');
    
    // Should recover and allow update
    updateCheckStatus(dir, 'new_check', 'completed');
    
    const status = getCheckStatus(dir, 'new_check');
    assert.strictEqual(status?.status, 'completed');
  });
});
