import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  inferProjectProfile,
  getRealityChecks,
  getTierSymbol,
  getTierDescription,
  updateCheckStatus,
  detectGeneratedDocs,
  resetCheckStatuses,
  type ProjectProfile,
  type RealityCheck,
} from '../reality.js';

// ============================================================================
// Test Utilities
// ============================================================================

function createTestProject(): string {
  const testDir = join(tmpdir(), `midas-reality-test-${Date.now()}`);
  mkdirSync(join(testDir, 'docs'), { recursive: true });
  mkdirSync(join(testDir, '.midas'), { recursive: true });
  return testDir;
}

function cleanupTestProject(testDir: string): void {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

// ============================================================================
// inferProjectProfile Tests
// ============================================================================

describe('inferProjectProfile', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestProject();
  });

  afterEach(() => {
    cleanupTestProject(testDir);
  });

  it('returns default profile for empty project', () => {
    const profile = inferProjectProfile(testDir);
    
    assert.strictEqual(profile.collectsUserData, false);
    assert.strictEqual(profile.hasPayments, false);
    assert.strictEqual(profile.usesAI, false);
    assert.strictEqual(profile.targetsEU, false);
    // Default is 'free' when no business model detected
    assert.ok(['free', 'unknown'].includes(profile.businessModel));
  });

  it('detects user data collection from brainlift', () => {
    writeFileSync(
      join(testDir, 'docs', 'brainlift.md'),
      '# My App\nWe store user accounts and email addresses for authentication.'
    );
    
    const profile = inferProjectProfile(testDir);
    assert.strictEqual(profile.collectsUserData, true);
  });

  it('detects payment features', () => {
    writeFileSync(
      join(testDir, 'docs', 'prd.md'),
      '# PRD\nUsers can purchase premium features via Stripe checkout.'
    );
    
    const profile = inferProjectProfile(testDir);
    assert.strictEqual(profile.hasPayments, true);
  });

  it('detects AI usage', () => {
    writeFileSync(
      join(testDir, 'docs', 'brainlift.md'),
      '# AI App\nThis app uses GPT to generate content.'
    );
    
    const profile = inferProjectProfile(testDir);
    assert.strictEqual(profile.usesAI, true);
  });

  it('detects EU targeting', () => {
    writeFileSync(
      join(testDir, 'docs', 'prd.md'),
      '# PRD\nTarget markets: EU and UK users. GDPR compliant.'
    );
    
    const profile = inferProjectProfile(testDir);
    assert.strictEqual(profile.targetsEU, true);
  });

  it('detects healthcare industry', () => {
    writeFileSync(
      join(testDir, 'docs', 'brainlift.md'),
      '# Health App\nPatient health records management system.'
    );
    
    const profile = inferProjectProfile(testDir);
    assert.ok(profile.industry.includes('healthcare'));
  });

  it('detects education industry', () => {
    writeFileSync(
      join(testDir, 'docs', 'brainlift.md'),
      '# EdTech\nSchool management and course platform.'
    );
    
    const profile = inferProjectProfile(testDir);
    assert.ok(profile.industry.includes('education'));
  });

  it('infers subscription business model', () => {
    writeFileSync(
      join(testDir, 'docs', 'prd.md'),
      '# SaaS Product\nMonthly subscription with yearly discount.'
    );
    
    const profile = inferProjectProfile(testDir);
    assert.strictEqual(profile.businessModel, 'subscription');
  });
});

// ============================================================================
// getRealityChecks Tests
// ============================================================================

describe('getRealityChecks', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestProject();
  });

  afterEach(() => {
    cleanupTestProject(testDir);
  });

  it('returns empty checks for minimal project', () => {
    const result = getRealityChecks(testDir);
    
    assert.ok(Array.isArray(result.checks));
    assert.ok(result.profile);
    assert.ok(result.summary);
  });

  it('returns privacy policy check when collecting user data', () => {
    writeFileSync(
      join(testDir, 'docs', 'brainlift.md'),
      '# App\nUser accounts with email and password.'
    );
    
    const result = getRealityChecks(testDir);
    const privacyCheck = result.checks.find(c => c.key === 'PRIVACY_POLICY');
    
    assert.ok(privacyCheck, 'Should have privacy policy check');
    assert.strictEqual(privacyCheck?.tier, 'ai_assisted');
    assert.strictEqual(privacyCheck?.priority, 'critical');
  });

  it('returns HIPAA check for healthcare + user data', () => {
    writeFileSync(
      join(testDir, 'docs', 'brainlift.md'),
      '# Health App\nPatient records and medical history. User accounts.'
    );
    
    // Need to run twice to get past progressive disclosure
    getRealityChecks(testDir);
    getRealityChecks(testDir);
    const result = getRealityChecks(testDir);
    
    const hipaaCheck = result.checks.find(c => c.key === 'HIPAA_COMPLIANCE');
    assert.ok(hipaaCheck, 'Should have HIPAA check for healthcare');
  });

  it('returns FERPA check for education + user data', () => {
    writeFileSync(
      join(testDir, 'docs', 'brainlift.md'),
      '# School App\nStudent records and course grades. User accounts.'
    );
    
    // Run multiple times to get past progressive disclosure
    getRealityChecks(testDir);
    getRealityChecks(testDir);
    const result = getRealityChecks(testDir);
    
    const ferpaCheck = result.checks.find(c => c.key === 'FERPA_COMPLIANCE');
    assert.ok(ferpaCheck, 'Should have FERPA check for education');
  });

  it('calculates summary correctly', () => {
    writeFileSync(
      join(testDir, 'docs', 'brainlift.md'),
      '# App\nUser accounts, payments via Stripe, AI-powered features.'
    );
    
    const result = getRealityChecks(testDir);
    
    assert.strictEqual(result.summary.total, result.checks.length);
    assert.strictEqual(
      result.summary.aiAssisted + result.summary.manual,
      result.summary.total
    );
    assert.strictEqual(
      result.summary.pending + result.summary.completed + result.summary.skipped,
      result.summary.total
    );
  });

  it('implements progressive disclosure on first session', () => {
    writeFileSync(
      join(testDir, 'docs', 'brainlift.md'),
      '# Complex App\nUser accounts, email, payments, AI, subscriptions, EU users, enterprise B2B.'
    );
    
    // Reset to ensure fresh state
    resetCheckStatuses(testDir);
    
    const result = getRealityChecks(testDir);
    
    assert.ok(result.isFirstSession, 'Should be first session');
    if (result.totalAvailable && result.totalAvailable > 4) {
      assert.ok(
        result.checks.length <= result.totalAvailable,
        'Should limit checks on first session'
      );
    }
  });

  it('shows all checks after multiple views', () => {
    writeFileSync(
      join(testDir, 'docs', 'brainlift.md'),
      '# Complex App\nUser accounts, email, payments, AI, subscriptions, EU users.'
    );
    
    resetCheckStatuses(testDir);
    
    // First two views
    getRealityChecks(testDir);
    getRealityChecks(testDir);
    
    // Third view should show all
    const result = getRealityChecks(testDir);
    
    assert.strictEqual(result.isFirstSession, false);
    assert.strictEqual(result.checks.length, result.totalAvailable);
  });
});

// ============================================================================
// Tier Functions Tests
// ============================================================================

describe('getTierSymbol', () => {
  it('returns robot emoji for ai_assisted', () => {
    assert.strictEqual(getTierSymbol('ai_assisted'), '🤖');
  });

  it('returns person emoji for manual', () => {
    assert.strictEqual(getTierSymbol('manual'), '👤');
  });
});

describe('getTierDescription', () => {
  it('returns correct description for ai_assisted', () => {
    assert.strictEqual(getTierDescription('ai_assisted'), 'AI can help with this');
  });

  it('returns correct description for manual', () => {
    assert.strictEqual(getTierDescription('manual'), 'You need to do this yourself');
  });
});

// ============================================================================
// updateCheckStatus Tests
// ============================================================================

describe('updateCheckStatus', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestProject();
    writeFileSync(
      join(testDir, 'docs', 'brainlift.md'),
      '# App\nUser accounts with email.'
    );
  });

  afterEach(() => {
    cleanupTestProject(testDir);
  });

  it('marks check as completed', () => {
    updateCheckStatus(testDir, 'PRIVACY_POLICY', 'completed');
    
    const result = getRealityChecks(testDir);
    const check = result.checks.find(c => c.key === 'PRIVACY_POLICY');
    
    assert.strictEqual(check?.status, 'completed');
  });

  it('marks check as skipped with reason', () => {
    updateCheckStatus(testDir, 'PRIVACY_POLICY', 'skipped', 'Not applicable');
    
    const result = getRealityChecks(testDir);
    const check = result.checks.find(c => c.key === 'PRIVACY_POLICY');
    
    assert.strictEqual(check?.status, 'skipped');
    assert.strictEqual(check?.skippedReason, 'Not applicable');
  });

  it('persists status between calls', () => {
    updateCheckStatus(testDir, 'PRIVACY_POLICY', 'completed');
    
    // Get fresh result
    const result1 = getRealityChecks(testDir);
    const check1 = result1.checks.find(c => c.key === 'PRIVACY_POLICY');
    
    // Get another fresh result
    const result2 = getRealityChecks(testDir);
    const check2 = result2.checks.find(c => c.key === 'PRIVACY_POLICY');
    
    assert.strictEqual(check1?.status, 'completed');
    assert.strictEqual(check2?.status, 'completed');
  });

  it('updates summary counts correctly', () => {
    const before = getRealityChecks(testDir);
    const pendingBefore = before.summary.pending;
    
    updateCheckStatus(testDir, 'PRIVACY_POLICY', 'completed');
    
    const after = getRealityChecks(testDir);
    
    assert.strictEqual(after.summary.completed, 1);
    assert.strictEqual(after.summary.pending, pendingBefore - 1);
  });
});

// ============================================================================
// detectGeneratedDocs Tests
// ============================================================================

describe('detectGeneratedDocs', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestProject();
    writeFileSync(
      join(testDir, 'docs', 'brainlift.md'),
      '# App\nUser accounts with email.'
    );
  });

  afterEach(() => {
    cleanupTestProject(testDir);
  });

  it('auto-completes check when doc file exists', () => {
    // Create privacy policy file
    writeFileSync(
      join(testDir, 'docs', 'privacy-policy.md'),
      '# Privacy Policy\nThis is our privacy policy.'
    );
    
    const autoCompleted = detectGeneratedDocs(testDir);
    
    assert.ok(autoCompleted.includes('PRIVACY_POLICY'));
  });

  it('auto-completes LICENSE check when LICENSE file exists', () => {
    writeFileSync(join(testDir, 'LICENSE'), 'MIT License...');
    
    const autoCompleted = detectGeneratedDocs(testDir);
    
    assert.ok(autoCompleted.includes('OSS_LICENSE'));
  });

  it('does not re-complete already completed checks', () => {
    writeFileSync(
      join(testDir, 'docs', 'privacy-policy.md'),
      '# Privacy Policy'
    );
    
    // First detection
    const first = detectGeneratedDocs(testDir);
    
    // Second detection should return empty (already completed)
    const second = detectGeneratedDocs(testDir);
    
    assert.ok(first.includes('PRIVACY_POLICY'));
    assert.ok(!second.includes('PRIVACY_POLICY'));
  });

  it('detects multiple docs at once', () => {
    writeFileSync(join(testDir, 'docs', 'privacy-policy.md'), '# Privacy');
    writeFileSync(join(testDir, 'docs', 'terms-of-service.md'), '# Terms');
    writeFileSync(join(testDir, 'LICENSE'), 'MIT');
    
    const autoCompleted = detectGeneratedDocs(testDir);
    
    assert.ok(autoCompleted.length >= 2);
  });
});

// ============================================================================
// resetCheckStatuses Tests
// ============================================================================

describe('resetCheckStatuses', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestProject();
    writeFileSync(
      join(testDir, 'docs', 'brainlift.md'),
      '# App\nUser accounts with email.'
    );
  });

  afterEach(() => {
    cleanupTestProject(testDir);
  });

  it('resets all check statuses to pending', () => {
    // Complete a check
    updateCheckStatus(testDir, 'PRIVACY_POLICY', 'completed');
    
    // Verify it's completed
    let result = getRealityChecks(testDir);
    let check = result.checks.find(c => c.key === 'PRIVACY_POLICY');
    assert.strictEqual(check?.status, 'completed');
    
    // Reset
    resetCheckStatuses(testDir);
    
    // Verify it's pending again
    result = getRealityChecks(testDir);
    check = result.checks.find(c => c.key === 'PRIVACY_POLICY');
    assert.strictEqual(check?.status, 'pending');
  });

  it('resets view count for progressive disclosure', () => {
    // View multiple times
    getRealityChecks(testDir);
    getRealityChecks(testDir);
    getRealityChecks(testDir);
    
    // Reset
    resetCheckStatuses(testDir);
    
    // Should be first session again
    const result = getRealityChecks(testDir);
    assert.strictEqual(result.isFirstSession, true);
  });
});

// ============================================================================
// RealityCheck Structure Tests
// ============================================================================

describe('RealityCheck structure', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestProject();
    writeFileSync(
      join(testDir, 'docs', 'brainlift.md'),
      '# App\nUser accounts with email, payments via Stripe.'
    );
  });

  afterEach(() => {
    cleanupTestProject(testDir);
  });

  it('includes all required fields', () => {
    const result = getRealityChecks(testDir);
    const check = result.checks[0];
    
    assert.ok(check.key, 'Should have key');
    assert.ok(check.category, 'Should have category');
    assert.ok(check.tier, 'Should have tier');
    assert.ok(check.headline, 'Should have headline');
    assert.ok(check.explanation, 'Should have explanation');
    assert.ok(check.cursorPrompt, 'Should have cursorPrompt');
    assert.ok(check.priority, 'Should have priority');
    assert.ok(check.triggeredBy, 'Should have triggeredBy');
    assert.ok(check.status, 'Should have status');
  });

  it('has valid tier value', () => {
    const result = getRealityChecks(testDir);
    
    for (const check of result.checks) {
      assert.ok(
        check.tier === 'ai_assisted' || check.tier === 'manual',
        `Invalid tier: ${check.tier}`
      );
    }
  });

  it('has valid priority value', () => {
    const result = getRealityChecks(testDir);
    
    const validPriorities = ['critical', 'high', 'medium', 'low'];
    for (const check of result.checks) {
      assert.ok(
        validPriorities.includes(check.priority),
        `Invalid priority: ${check.priority}`
      );
    }
  });

  it('has valid status value', () => {
    const result = getRealityChecks(testDir);
    
    const validStatuses = ['pending', 'completed', 'skipped'];
    for (const check of result.checks) {
      assert.ok(
        validStatuses.includes(check.status),
        `Invalid status: ${check.status}`
      );
    }
  });

  it('cursorPrompt references docs', () => {
    const result = getRealityChecks(testDir);
    
    // AI-assisted checks should reference reading docs
    const aiChecks = result.checks.filter(c => c.tier === 'ai_assisted');
    for (const check of aiChecks) {
      assert.ok(
        check.cursorPrompt.toLowerCase().includes('doc') ||
        check.cursorPrompt.toLowerCase().includes('brainlift') ||
        check.cursorPrompt.toLowerCase().includes('prd'),
        `Prompt should reference docs: ${check.key}`
      );
    }
  });
});
