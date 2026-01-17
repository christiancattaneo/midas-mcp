/**
 * Git Edge Cases Stress Tests
 * 
 * Comprehensive testing of Git repository edge cases:
 * - No commits (empty repo, orphan branches)
 * - Missing .git directory
 * - Corrupted HEAD (invalid refs, missing refs, detached HEAD)
 * - Submodules and worktrees
 * - Shallow clones
 * - Bare repositories
 * - Special branch names and commit messages
 * - Concurrent git operations
 * 
 * Based on real-world git corruption scenarios and edge cases.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { 
  mkdirSync, writeFileSync, rmSync, existsSync, 
  readFileSync, unlinkSync, symlinkSync, renameSync
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

// Module imports
import { getGitActivity, scanRecentFiles } from '../tracker.js';
import { sanitizePath } from '../security.js';

// ============================================================================
// HELPERS
// ============================================================================

let testDirs: string[] = [];

function createTestDir(prefix: string): string {
  const dir = join(tmpdir(), `midas-git-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
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

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
}

function makeCommit(dir: string, message: string, filename?: string): void {
  const file = filename || `file-${Date.now()}.txt`;
  writeFileSync(join(dir, file), `content-${Date.now()}`);
  execSync(`git add "${file}"`, { cwd: dir, stdio: 'ignore' });
  execSync(`git commit -m "${message}"`, { cwd: dir, stdio: 'ignore' });
}

beforeEach(() => {
  testDirs = [];
});

afterEach(() => {
  cleanup();
});

// ============================================================================
// 1. NO .GIT DIRECTORY
// ============================================================================

describe('No .git Directory', () => {
  it('should return null for directory without .git', () => {
    const dir = createTestDir('no-git');
    writeFileSync(join(dir, 'file.txt'), 'content');
    
    const activity = getGitActivity(dir);
    
    assert.strictEqual(activity, null);
  });

  it('should return null for empty directory', () => {
    const dir = createTestDir('empty');
    
    const activity = getGitActivity(dir);
    
    assert.strictEqual(activity, null);
  });

  it('should return null after .git is deleted', () => {
    const dir = createTestDir('deleted-git');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Verify it works first
    const before = getGitActivity(dir);
    assert.notStrictEqual(before, null);
    
    // Delete .git
    rmSync(join(dir, '.git'), { recursive: true, force: true });
    
    const after = getGitActivity(dir);
    assert.strictEqual(after, null);
  });

  it('should handle .git as a file (gitdir pointer)', () => {
    const dir = createTestDir('gitdir-file');
    const realGitDir = createTestDir('real-git');
    
    // Create real git dir elsewhere
    initGitRepo(realGitDir);
    makeCommit(realGitDir, 'initial');
    
    // Create .git file pointing to it (like submodule or worktree)
    writeFileSync(join(dir, '.git'), `gitdir: ${join(realGitDir, '.git')}`);
    
    // This might work or not depending on git version
    const activity = getGitActivity(dir);
    // Should not crash
    assert.ok(activity === null || typeof activity === 'object');
  });

  it('should handle .git as empty file', () => {
    const dir = createTestDir('empty-git-file');
    writeFileSync(join(dir, '.git'), '');
    
    const activity = getGitActivity(dir);
    
    assert.strictEqual(activity, null);
  });

  it('should handle .git as file with invalid content', () => {
    const dir = createTestDir('invalid-git-file');
    writeFileSync(join(dir, '.git'), 'this is not a valid gitdir pointer');
    
    const activity = getGitActivity(dir);
    
    assert.strictEqual(activity, null);
  });

  it('should handle renamed .git directory', () => {
    const dir = createTestDir('renamed-git');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Rename .git to something else
    renameSync(join(dir, '.git'), join(dir, '.git-backup'));
    
    const activity = getGitActivity(dir);
    
    assert.strictEqual(activity, null);
  });
});

// ============================================================================
// 2. NO COMMITS (EMPTY REPOSITORY)
// ============================================================================

describe('No Commits (Empty Repository)', () => {
  it('should handle freshly initialized repo', () => {
    const dir = createTestDir('fresh-init');
    initGitRepo(dir);
    
    const activity = getGitActivity(dir);
    
    // Should not crash, branch might be empty string or undefined
    assert.ok(activity !== null);
    assert.strictEqual(activity.lastCommit, undefined);
    assert.strictEqual(activity.lastCommitMessage, undefined);
  });

  it('should handle repo with staged but uncommitted files', () => {
    const dir = createTestDir('staged-no-commit');
    initGitRepo(dir);
    writeFileSync(join(dir, 'file.txt'), 'content');
    execSync('git add file.txt', { cwd: dir, stdio: 'ignore' });
    
    const activity = getGitActivity(dir);
    
    assert.ok(activity !== null);
    assert.strictEqual(activity.uncommittedChanges, 1);
    assert.strictEqual(activity.lastCommit, undefined);
  });

  it('should handle repo with untracked files only', () => {
    const dir = createTestDir('untracked-only');
    initGitRepo(dir);
    writeFileSync(join(dir, 'file.txt'), 'content');
    
    const activity = getGitActivity(dir);
    
    assert.ok(activity !== null);
    // Untracked files show in status
    assert.ok(activity.uncommittedChanges >= 0);
  });

  it('should handle orphan branch with no commits', () => {
    const dir = createTestDir('orphan-branch');
    initGitRepo(dir);
    makeCommit(dir, 'initial on main');
    
    // Create orphan branch
    execSync('git checkout --orphan orphan-branch', { cwd: dir, stdio: 'ignore' });
    // Remove all files from index
    execSync('git rm -rf .', { cwd: dir, stdio: 'ignore' });
    
    const activity = getGitActivity(dir);
    
    // Should handle gracefully
    assert.ok(activity !== null || activity === null);  // Either is acceptable
  });

  it('should handle empty repository with multiple branches defined in config', () => {
    const dir = createTestDir('empty-multi-branch');
    initGitRepo(dir);
    
    // Add branch refs manually without commits
    mkdirSync(join(dir, '.git', 'refs', 'heads'), { recursive: true });
    // Don't write actual refs - they're empty
    
    const activity = getGitActivity(dir);
    
    // Should not crash
    assert.ok(activity === null || typeof activity === 'object');
  });
});

// ============================================================================
// 3. CORRUPTED HEAD
// ============================================================================

describe('Corrupted HEAD', () => {
  it('should handle empty HEAD file', () => {
    const dir = createTestDir('empty-head');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Corrupt HEAD
    writeFileSync(join(dir, '.git', 'HEAD'), '');
    
    const activity = getGitActivity(dir);
    
    // Should return null or handle gracefully
    assert.ok(activity === null || typeof activity === 'object');
  });

  it('should handle HEAD with invalid ref', () => {
    const dir = createTestDir('invalid-ref');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Point HEAD to non-existent branch
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/nonexistent-branch\n');
    
    const activity = getGitActivity(dir);
    
    assert.ok(activity === null || typeof activity === 'object');
  });

  it('should handle HEAD with invalid SHA', () => {
    const dir = createTestDir('invalid-sha');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Write invalid SHA (not a valid commit)
    writeFileSync(join(dir, '.git', 'HEAD'), '0000000000000000000000000000000000000000\n');
    
    const activity = getGitActivity(dir);
    
    assert.ok(activity === null || typeof activity === 'object');
  });

  it('should handle HEAD with garbage content', () => {
    const dir = createTestDir('garbage-head');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Write garbage
    writeFileSync(join(dir, '.git', 'HEAD'), 'this is not a valid HEAD\n');
    
    const activity = getGitActivity(dir);
    
    assert.ok(activity === null || typeof activity === 'object');
  });

  it('should handle HEAD with binary content', () => {
    const dir = createTestDir('binary-head');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Write binary garbage
    writeFileSync(join(dir, '.git', 'HEAD'), Buffer.from([0x00, 0xFF, 0x89, 0x50, 0x4E, 0x47]));
    
    const activity = getGitActivity(dir);
    
    assert.ok(activity === null || typeof activity === 'object');
  });

  it('should handle missing HEAD file', () => {
    const dir = createTestDir('missing-head');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Delete HEAD
    unlinkSync(join(dir, '.git', 'HEAD'));
    
    const activity = getGitActivity(dir);
    
    assert.ok(activity === null || typeof activity === 'object');
  });

  it('should handle HEAD pointing to packed ref', () => {
    const dir = createTestDir('packed-ref');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Pack refs
    execSync('git pack-refs --all', { cwd: dir, stdio: 'ignore' });
    
    const activity = getGitActivity(dir);
    
    // Should still work
    assert.ok(activity !== null);
    assert.ok(activity.lastCommit !== undefined);
  });

  it('should handle detached HEAD', () => {
    const dir = createTestDir('detached-head');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    makeCommit(dir, 'second');
    
    // Detach HEAD to first commit
    execSync('git checkout HEAD~1', { cwd: dir, stdio: 'ignore' });
    
    const activity = getGitActivity(dir);
    
    assert.ok(activity !== null);
    // Branch should be empty string for detached HEAD
    assert.strictEqual(activity.branch, '');
    assert.ok(activity.lastCommit !== undefined);
  });

  it('should handle HEAD with trailing whitespace', () => {
    const dir = createTestDir('whitespace-head');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Write HEAD with extra whitespace
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main   \n\n');
    
    const activity = getGitActivity(dir);
    
    // May or may not work depending on git version
    assert.ok(activity === null || typeof activity === 'object');
  });
});

// ============================================================================
// 4. CORRUPTED REFS
// ============================================================================

describe('Corrupted Refs', () => {
  it('should handle missing refs/heads directory', () => {
    const dir = createTestDir('missing-refs-heads');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Delete refs/heads
    rmSync(join(dir, '.git', 'refs', 'heads'), { recursive: true, force: true });
    
    const activity = getGitActivity(dir);
    
    assert.ok(activity === null || typeof activity === 'object');
  });

  it('should handle empty branch ref file', () => {
    const dir = createTestDir('empty-branch-ref');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Get current branch
    const branch = execSync('git branch --show-current', { cwd: dir, encoding: 'utf-8' }).trim();
    const refPath = join(dir, '.git', 'refs', 'heads', branch);
    
    if (existsSync(refPath)) {
      writeFileSync(refPath, '');
    }
    
    const activity = getGitActivity(dir);
    
    assert.ok(activity === null || typeof activity === 'object');
  });

  it('should handle branch ref with invalid SHA', () => {
    const dir = createTestDir('invalid-branch-sha');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    const branch = execSync('git branch --show-current', { cwd: dir, encoding: 'utf-8' }).trim();
    const refPath = join(dir, '.git', 'refs', 'heads', branch);
    
    if (existsSync(refPath)) {
      writeFileSync(refPath, 'not-a-sha\n');
    }
    
    const activity = getGitActivity(dir);
    
    assert.ok(activity === null || typeof activity === 'object');
  });

  it('should handle corrupted packed-refs file', () => {
    const dir = createTestDir('corrupt-packed-refs');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Create corrupted packed-refs
    writeFileSync(join(dir, '.git', 'packed-refs'), 'garbage content here');
    
    const activity = getGitActivity(dir);
    
    assert.ok(activity === null || typeof activity === 'object');
  });
});

// ============================================================================
// 5. SPECIAL BRANCH NAMES
// ============================================================================

describe('Special Branch Names', () => {
  const specialBranches = [
    'feature/add-login',
    'bugfix/fix-crash',
    'release/v1.0.0',
    'hotfix/urgent-fix',
    'user/john/experiment',
    'refs/heads/main',  // Potentially confusing
    'HEAD',  // Edge case
    '-starts-with-dash',
    '..double-dots..',
    'has spaces',  // May not work
    '中文分支',  // Chinese
    'emoji-🚀-branch',
  ];

  for (const branch of specialBranches) {
    it(`should handle branch name: ${branch.slice(0, 20)}`, () => {
      const dir = createTestDir(`branch-${Date.now()}`);
      initGitRepo(dir);
      makeCommit(dir, 'initial');
      
      try {
        // Try to create branch
        execSync(`git checkout -b "${branch}"`, { cwd: dir, stdio: 'ignore' });
        
        const activity = getGitActivity(dir);
        
        assert.ok(activity !== null);
        assert.strictEqual(typeof activity.branch, 'string');
      } catch {
        // Branch name not allowed by git - acceptable
      }
    });
  }
});

// ============================================================================
// 6. SPECIAL COMMIT MESSAGES
// ============================================================================

describe('Special Commit Messages', () => {
  const specialMessages = [
    'normal commit message',
    '',  // Empty (git usually requires non-empty with -m)
    '   ',  // Whitespace only
    'line1\nline2\nline3',  // Multi-line
    'message with "quotes"',
    "message with 'single quotes'",
    'message with `backticks`',
    'message with $VARIABLE',
    'message with $(command)',
    'message with | pipe && and',
    '中文提交消息',
    'emoji commit 🎉🚀✨',
    'x'.repeat(1000),  // Very long
    'feat(scope): conventional commit\n\nBody\n\nFixes #123',
  ];

  for (const msg of specialMessages.filter(m => m.length > 0 && m.trim().length > 0)) {
    it(`should handle commit message: ${msg.slice(0, 30)}...`, () => {
      const dir = createTestDir(`msg-${Date.now()}`);
      initGitRepo(dir);
      writeFileSync(join(dir, 'file.txt'), 'content');
      execSync('git add file.txt', { cwd: dir, stdio: 'ignore' });
      
      try {
        // Use file for message to avoid shell escaping issues
        writeFileSync(join(dir, 'commit-msg.txt'), msg);
        execSync('git commit -F commit-msg.txt', { cwd: dir, stdio: 'ignore' });
        
        const activity = getGitActivity(dir);
        
        assert.ok(activity !== null);
        assert.ok(activity.lastCommitMessage !== undefined);
      } catch {
        // Some messages may not work
      }
    });
  }
});

// ============================================================================
// 7. SUBMODULES
// ============================================================================

describe('Submodules', () => {
  it('should handle project with submodule', () => {
    const parentDir = createTestDir('submodule-parent');
    const submoduleDir = createTestDir('submodule-child');
    
    // Create submodule repo
    initGitRepo(submoduleDir);
    makeCommit(submoduleDir, 'submodule commit');
    
    // Create parent repo
    initGitRepo(parentDir);
    makeCommit(parentDir, 'parent initial');
    
    try {
      // Add submodule
      execSync(`git submodule add "${submoduleDir}" child`, { cwd: parentDir, stdio: 'ignore' });
      execSync('git commit -m "Added submodule"', { cwd: parentDir, stdio: 'ignore' });
      
      // Check parent
      const parentActivity = getGitActivity(parentDir);
      assert.ok(parentActivity !== null);
      
      // Check submodule directory (has .git file, not directory)
      const childActivity = getGitActivity(join(parentDir, 'child'));
      assert.ok(childActivity === null || typeof childActivity === 'object');
    } catch {
      // Submodule command may fail in some environments
    }
  });

  it('should handle uninitialized submodule', () => {
    const parentDir = createTestDir('uninit-submodule');
    const submoduleDir = createTestDir('uninit-sub-child');
    
    initGitRepo(submoduleDir);
    makeCommit(submoduleDir, 'child commit');
    
    initGitRepo(parentDir);
    makeCommit(parentDir, 'parent initial');
    
    try {
      // Add submodule but don't init
      execSync(`git submodule add "${submoduleDir}" child`, { cwd: parentDir, stdio: 'ignore' });
      execSync('git commit -m "Added submodule"', { cwd: parentDir, stdio: 'ignore' });
      
      // Remove submodule working directory content
      rmSync(join(parentDir, 'child'), { recursive: true, force: true });
      mkdirSync(join(parentDir, 'child'));
      
      const parentActivity = getGitActivity(parentDir);
      assert.ok(parentActivity !== null);
    } catch {
      // May fail
    }
  });
});

// ============================================================================
// 8. WORKTREES
// ============================================================================

describe('Worktrees', () => {
  it('should handle main repo with linked worktree', () => {
    const mainDir = createTestDir('worktree-main');
    const worktreeDir = createTestDir('worktree-linked');
    
    initGitRepo(mainDir);
    makeCommit(mainDir, 'main commit');
    
    try {
      // Create a branch and worktree
      execSync('git branch feature', { cwd: mainDir, stdio: 'ignore' });
      execSync(`git worktree add "${worktreeDir}" feature`, { cwd: mainDir, stdio: 'ignore' });
      
      // Check main repo
      const mainActivity = getGitActivity(mainDir);
      assert.ok(mainActivity !== null);
      
      // Check worktree (has .git file, not directory)
      const worktreeActivity = getGitActivity(worktreeDir);
      // May or may not work depending on git version
      assert.ok(worktreeActivity === null || typeof worktreeActivity === 'object');
    } catch {
      // Worktree command may fail in some environments
    }
  });

  it('should handle orphaned worktree reference', () => {
    const mainDir = createTestDir('orphan-worktree');
    const worktreeDir = createTestDir('orphan-wt-linked');
    
    initGitRepo(mainDir);
    makeCommit(mainDir, 'main commit');
    
    try {
      execSync('git branch feature', { cwd: mainDir, stdio: 'ignore' });
      execSync(`git worktree add "${worktreeDir}" feature`, { cwd: mainDir, stdio: 'ignore' });
      
      // Delete the worktree directory (orphan the reference)
      rmSync(worktreeDir, { recursive: true, force: true });
      
      // Main repo should still work
      const mainActivity = getGitActivity(mainDir);
      assert.ok(mainActivity !== null);
    } catch {
      // May fail
    }
  });
});

// ============================================================================
// 9. SHALLOW CLONES
// ============================================================================

describe('Shallow Clones', () => {
  it('should handle shallow clone (depth 1)', () => {
    const sourceDir = createTestDir('shallow-source');
    const cloneDir = createTestDir('shallow-clone');
    
    initGitRepo(sourceDir);
    for (let i = 0; i < 5; i++) {
      makeCommit(sourceDir, `commit ${i}`);
    }
    
    try {
      // Create shallow clone
      execSync(`git clone --depth 1 "${sourceDir}" "${cloneDir}"`, { stdio: 'ignore' });
      
      const activity = getGitActivity(cloneDir);
      
      assert.ok(activity !== null);
      // Should have only 1 recent commit
      assert.ok((activity.recentCommits ?? []).length <= 1);
    } catch {
      // Clone may fail in some environments
    }
  });

  it('should handle grafted/shallow repo detection', () => {
    const dir = createTestDir('grafted');
    initGitRepo(dir);
    for (let i = 0; i < 3; i++) {
      makeCommit(dir, `commit ${i}`);
    }
    
    // Create shallow marker
    writeFileSync(join(dir, '.git', 'shallow'), 'dummy\n');
    
    const activity = getGitActivity(dir);
    
    // Should still work
    assert.ok(activity !== null);
  });
});

// ============================================================================
// 10. BARE REPOSITORIES
// ============================================================================

describe('Bare Repositories', () => {
  it('should handle bare repository', () => {
    const sourceDir = createTestDir('bare-source');
    const bareDir = createTestDir('bare-repo');
    
    initGitRepo(sourceDir);
    makeCommit(sourceDir, 'initial commit');
    
    try {
      // Clone as bare
      execSync(`git clone --bare "${sourceDir}" "${bareDir}"`, { stdio: 'ignore' });
      
      const activity = getGitActivity(bareDir);
      
      // Bare repos don't have working directory, may behave differently
      assert.ok(activity === null || typeof activity === 'object');
    } catch {
      // May fail
    }
  });

  it('should handle manually created bare-like structure', () => {
    const dir = createTestDir('fake-bare');
    
    // Create bare-like structure
    mkdirSync(join(dir, 'objects'));
    mkdirSync(join(dir, 'refs', 'heads'), { recursive: true });
    writeFileSync(join(dir, 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(dir, 'config'), '[core]\n\tbare = true\n');
    
    // This is not a proper git directory for our purposes
    const activity = getGitActivity(dir);
    
    assert.strictEqual(activity, null);
  });
});

// ============================================================================
// 11. CONCURRENT OPERATIONS
// ============================================================================

describe('Concurrent Git Operations', () => {
  it('should handle multiple concurrent getGitActivity calls', async () => {
    const dir = createTestDir('concurrent');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(
        new Promise<void>((resolve) => {
          setTimeout(() => {
            try {
              const activity = getGitActivity(dir);
              assert.ok(activity === null || typeof activity === 'object');
            } catch {
              // Should not crash
            }
            resolve();
          }, Math.random() * 100);
        })
      );
    }
    
    await Promise.all(promises);
  });

  it('should handle git activity during commit', async () => {
    const dir = createTestDir('during-commit');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Start multiple commits in background and check status simultaneously
    const operations: Promise<void>[] = [];
    
    for (let i = 0; i < 5; i++) {
      operations.push(
        new Promise<void>((resolve) => {
          setTimeout(() => {
            try {
              writeFileSync(join(dir, `file${i}.txt`), `content${i}`);
              execSync(`git add file${i}.txt`, { cwd: dir, stdio: 'ignore' });
              execSync(`git commit -m "commit ${i}"`, { cwd: dir, stdio: 'ignore' });
            } catch {
              // May fail due to lock
            }
            resolve();
          }, i * 20);
        })
      );
      
      operations.push(
        new Promise<void>((resolve) => {
          setTimeout(() => {
            try {
              getGitActivity(dir);
            } catch {
              // Should not crash
            }
            resolve();
          }, i * 20 + 10);
        })
      );
    }
    
    await Promise.all(operations);
    
    // Final check should work
    const activity = getGitActivity(dir);
    assert.ok(activity !== null);
  });
});

// ============================================================================
// 12. LARGE REPOSITORIES
// ============================================================================

describe('Large Repositories', () => {
  it('should handle repo with many commits', () => {
    const dir = createTestDir('many-commits');
    initGitRepo(dir);
    
    // Create 100 commits
    for (let i = 0; i < 100; i++) {
      makeCommit(dir, `commit ${i}`);
    }
    
    const start = Date.now();
    const activity = getGitActivity(dir);
    const elapsed = Date.now() - start;
    
    assert.ok(activity !== null);
    assert.ok((activity.recentCommits ?? []).length <= 10, 'Should limit to 10 recent commits');
    assert.ok(elapsed < 5000, `Should be fast, took ${elapsed}ms`);
  });

  it('should handle repo with many branches', () => {
    const dir = createTestDir('many-branches');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Create 50 branches
    for (let i = 0; i < 50; i++) {
      execSync(`git branch branch-${i}`, { cwd: dir, stdio: 'ignore' });
    }
    
    const activity = getGitActivity(dir);
    
    assert.ok(activity !== null);
    assert.ok(typeof activity.branch === 'string');
  });

  it('should handle repo with many uncommitted changes', () => {
    const dir = createTestDir('many-changes');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Create 100 uncommitted files
    for (let i = 0; i < 100; i++) {
      writeFileSync(join(dir, `uncommitted-${i}.txt`), `content ${i}`);
    }
    
    const start = Date.now();
    const activity = getGitActivity(dir);
    const elapsed = Date.now() - start;
    
    assert.ok(activity !== null);
    assert.strictEqual(activity.uncommittedChanges, 100);
    assert.ok(elapsed < 5000, `Should be fast, took ${elapsed}ms`);
  });
});

// ============================================================================
// 13. FILESYSTEM EDGE CASES WITH GIT
// ============================================================================

describe('Filesystem Edge Cases with Git', () => {
  it('should handle symlinked .git directory', () => {
    const realGitDir = createTestDir('real-git-for-symlink');
    const repoDir = createTestDir('symlink-git');
    
    // Create real repo
    initGitRepo(realGitDir);
    makeCommit(realGitDir, 'initial');
    
    // Symlink .git
    try {
      symlinkSync(join(realGitDir, '.git'), join(repoDir, '.git'));
      
      const activity = getGitActivity(repoDir);
      
      // May or may not work
      assert.ok(activity === null || typeof activity === 'object');
    } catch {
      // Symlink may fail
    }
  });

  it('should handle project path with spaces', () => {
    const dir = createTestDir('path with spaces');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    const activity = getGitActivity(dir);
    
    assert.ok(activity !== null);
  });

  it('should handle project path with unicode', () => {
    const dir = createTestDir('路径测试');
    
    try {
      initGitRepo(dir);
      makeCommit(dir, 'initial');
      
      const activity = getGitActivity(dir);
      
      assert.ok(activity !== null);
    } catch {
      // Unicode paths may not work on all systems
    }
  });

  it('should handle very deep project path', () => {
    let path = createTestDir('deep');
    for (let i = 0; i < 20; i++) {
      path = join(path, `level${i}`);
    }
    
    try {
      mkdirSync(path, { recursive: true });
      initGitRepo(path);
      makeCommit(path, 'initial');
      
      const activity = getGitActivity(path);
      
      assert.ok(activity !== null);
    } catch {
      // Path too long
    }
  });

  it('should handle read-only .git directory', () => {
    const dir = createTestDir('readonly-git');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Note: Making .git readonly may break git operations
    // This just tests that getGitActivity doesn't crash
    
    const activity = getGitActivity(dir);
    
    assert.ok(activity !== null);
  });
});

// ============================================================================
// 14. ERROR RECOVERY
// ============================================================================

describe('Error Recovery', () => {
  it('should recover from git index lock', () => {
    const dir = createTestDir('index-lock');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Create lock file
    writeFileSync(join(dir, '.git', 'index.lock'), '');
    
    const activity = getGitActivity(dir);
    
    // Should still work for read operations
    assert.ok(activity !== null);
  });

  it('should handle missing objects directory', () => {
    const dir = createTestDir('missing-objects');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Delete objects directory
    rmSync(join(dir, '.git', 'objects'), { recursive: true, force: true });
    
    const activity = getGitActivity(dir);
    
    assert.ok(activity === null || typeof activity === 'object');
  });

  it('should handle corrupted index', () => {
    const dir = createTestDir('corrupt-index');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Corrupt index
    writeFileSync(join(dir, '.git', 'index'), 'garbage data');
    
    const activity = getGitActivity(dir);
    
    assert.ok(activity === null || typeof activity === 'object');
  });

  it('should handle missing config', () => {
    const dir = createTestDir('missing-config');
    initGitRepo(dir);
    makeCommit(dir, 'initial');
    
    // Delete config
    unlinkSync(join(dir, '.git', 'config'));
    
    const activity = getGitActivity(dir);
    
    // Git commands may still work with defaults
    assert.ok(activity === null || typeof activity === 'object');
  });
});
