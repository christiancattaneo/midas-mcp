import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { saveToJournal, getJournalEntries, searchJournal } from '../tools/journal.js';

describe('Journal Tools', () => {
  const testDir = join(tmpdir(), 'midas-journal-test-' + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('saveToJournal', () => {
    it('creates journal directory if not exists', () => {
      saveToJournal({
        projectPath: testDir,
        title: 'Test Entry',
        conversation: 'User: Hello\nAI: Hi there!',
      });
      
      assert.strictEqual(existsSync(join(testDir, '.midas', 'journal')), true);
    });

    it('creates markdown file with correct structure', () => {
      const result = saveToJournal({
        projectPath: testDir,
        title: 'Auth Implementation',
        conversation: 'Implemented OAuth2 flow',
      });
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.path.endsWith('.md'), true);
      assert.strictEqual(existsSync(result.path), true);
    });

    it('includes title in entry', () => {
      const result = saveToJournal({
        projectPath: testDir,
        title: 'Database Migration',
        conversation: 'Added user table',
      });
      
      assert.strictEqual(result.entry.title, 'Database Migration');
    });

    it('includes tags when provided', () => {
      const result = saveToJournal({
        projectPath: testDir,
        title: 'Bug Fix',
        conversation: 'Fixed null pointer',
        tags: ['bugfix', 'auth'],
      });
      
      assert.deepStrictEqual(result.entry.tags, ['bugfix', 'auth']);
    });

    it('generates unique ID for each entry', () => {
      const r1 = saveToJournal({
        projectPath: testDir,
        title: 'Entry 1',
        conversation: 'Content 1',
      });
      const r2 = saveToJournal({
        projectPath: testDir,
        title: 'Entry 2',
        conversation: 'Content 2',
      });
      
      assert.notStrictEqual(r1.entry.id, r2.entry.id);
    });

    it('stores full conversation content', () => {
      const conversation = 'User: How do I implement auth?\nAI: Here is how...';
      const result = saveToJournal({
        projectPath: testDir,
        title: 'Auth Discussion',
        conversation,
      });
      
      assert.strictEqual(result.entry.conversation, conversation);
    });
  });

  describe('getJournalEntries', () => {
    it('returns empty array for new project', () => {
      const entries = getJournalEntries({ projectPath: testDir });
      assert.deepStrictEqual(entries, []);
    });

    it('returns saved entries', () => {
      saveToJournal({
        projectPath: testDir,
        title: 'Entry 1',
        conversation: 'Content 1',
      });
      
      const entries = getJournalEntries({ projectPath: testDir });
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].title, 'Entry 1');
    });

    it('returns entries in reverse chronological order', () => {
      saveToJournal({ projectPath: testDir, title: 'First', conversation: 'A' });
      saveToJournal({ projectPath: testDir, title: 'Second', conversation: 'B' });
      saveToJournal({ projectPath: testDir, title: 'Third', conversation: 'C' });
      
      const entries = getJournalEntries({ projectPath: testDir });
      // Most recent should be first
      assert.strictEqual(entries[0].title, 'Third');
      assert.strictEqual(entries[2].title, 'First');
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        saveToJournal({
          projectPath: testDir,
          title: `Entry ${i}`,
          conversation: `Content ${i}`,
        });
      }
      
      const entries = getJournalEntries({ projectPath: testDir, limit: 2 });
      assert.strictEqual(entries.length, 2);
    });

    it('parses tags from saved files', () => {
      saveToJournal({
        projectPath: testDir,
        title: 'Tagged Entry',
        conversation: 'Content',
        tags: ['auth', 'frontend'],
      });
      
      const entries = getJournalEntries({ projectPath: testDir });
      assert.deepStrictEqual(entries[0].tags, ['auth', 'frontend']);
    });

    it('extracts conversation content correctly', () => {
      const conversation = 'This is the full\nmultiline\nconversation';
      saveToJournal({
        projectPath: testDir,
        title: 'Test',
        conversation,
      });
      
      const entries = getJournalEntries({ projectPath: testDir });
      assert.strictEqual(entries[0].conversation, conversation);
    });
  });

  describe('searchJournal', () => {
    beforeEach(() => {
      saveToJournal({
        projectPath: testDir,
        title: 'Authentication Flow',
        conversation: 'Implemented OAuth2 with JWT tokens',
        tags: ['auth', 'security'],
      });
      saveToJournal({
        projectPath: testDir,
        title: 'Database Schema',
        conversation: 'Created user and session tables',
        tags: ['database'],
      });
      saveToJournal({
        projectPath: testDir,
        title: 'API Endpoints',
        conversation: 'REST API for user management',
        tags: ['api', 'backend'],
      });
    });

    it('searches by title', () => {
      const results = searchJournal({ projectPath: testDir, query: 'Authentication' });
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].title, 'Authentication Flow');
    });

    it('searches by conversation content', () => {
      const results = searchJournal({ projectPath: testDir, query: 'JWT' });
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].title, 'Authentication Flow');
    });

    it('searches by tags', () => {
      const results = searchJournal({ projectPath: testDir, query: 'database' });
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].title, 'Database Schema');
    });

    it('is case insensitive', () => {
      const results = searchJournal({ projectPath: testDir, query: 'oauth2' });
      assert.strictEqual(results.length, 1);
    });

    it('returns multiple matches', () => {
      const results = searchJournal({ projectPath: testDir, query: 'user' });
      // Should match 'Database Schema' (user tables) and 'API Endpoints' (user management)
      assert.strictEqual(results.length, 2);
    });

    it('returns empty array for no matches', () => {
      const results = searchJournal({ projectPath: testDir, query: 'nonexistent' });
      assert.deepStrictEqual(results, []);
    });
  });
});
