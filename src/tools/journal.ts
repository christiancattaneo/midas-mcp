import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { sanitizePath, limitLength, LIMITS } from '../security.js';

const MIDAS_DIR = '.midas';
const JOURNAL_DIR = 'journal';

// Schemas for MCP tools
export const saveJournalSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  title: z.string().describe('Title for this journal entry (e.g., "Implemented auth flow")'),
  conversation: z.string().describe('The full conversation to save - include both user prompts and AI responses'),
  tags: z.array(z.string()).optional().describe('Optional tags like ["auth", "bugfix", "architecture"]'),
});

export const getJournalSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  limit: z.number().optional().describe('Max entries to return (default 10)'),
});

export const searchJournalSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  query: z.string().describe('Search term to find in journal entries'),
});

export interface JournalEntry {
  id: string;
  timestamp: string;
  title: string;
  conversation: string;
  phase?: string;
  step?: string;
  tags?: string[];
}

function getJournalDir(projectPath: string): string {
  return join(projectPath, MIDAS_DIR, JOURNAL_DIR);
}

function ensureJournalDir(projectPath: string): void {
  const dir = getJournalDir(projectPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Save a conversation to the journal
 * Users should call this after important exchanges
 */
export function saveToJournal(input: {
  projectPath?: string;
  title: string;
  conversation: string;
  tags?: string[];
}): { success: boolean; path: string; entry: JournalEntry } {
  const projectPath = sanitizePath(input.projectPath);
  ensureJournalDir(projectPath);
  
  const timestamp = new Date().toISOString();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const filename = `${timestamp.slice(0, 10)}-${id}.md`;
  
  // Sanitize inputs with size limits
  const title = limitLength(input.title, LIMITS.TITLE_MAX_LENGTH);
  const conversation = limitLength(input.conversation, LIMITS.CONVERSATION_MAX_LENGTH);
  const tags = input.tags?.slice(0, LIMITS.MAX_TAGS).map(t => limitLength(t, LIMITS.TAG_MAX_LENGTH));
  
  const entry: JournalEntry = {
    id,
    timestamp,
    title,
    conversation,
    tags,
  };
  
  // Format as markdown for easy reading
  const content = `# ${title}

**Date**: ${timestamp}
${tags?.length ? `**Tags**: ${tags.join(', ')}` : ''}

---

${conversation}
`;

  const filepath = join(getJournalDir(projectPath), filename);
  writeFileSync(filepath, content);
  
  return { success: true, path: filepath, entry };
}

/**
 * Get recent journal entries
 */
export function getJournalEntries(input: {
  projectPath?: string;
  limit?: number;
}): JournalEntry[] {
  const projectPath = sanitizePath(input.projectPath);
  const journalDir = getJournalDir(projectPath);
  
  if (!existsSync(journalDir)) {
    return [];
  }
  
  const files = readdirSync(journalDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, input.limit || 10);
  
  return files.map(file => {
    const content = readFileSync(join(journalDir, file), 'utf-8');
    const titleMatch = content.match(/^# (.+)$/m);
    const dateMatch = content.match(/\*\*Date\*\*: (.+)$/m);
    const tagsMatch = content.match(/\*\*Tags\*\*: (.+)$/m);
    const conversationStart = content.indexOf('---\n') + 4;
    
    return {
      id: file.replace('.md', ''),
      timestamp: dateMatch?.[1] || '',
      title: titleMatch?.[1] || file,
      conversation: content.slice(conversationStart).trim(),
      tags: tagsMatch?.[1]?.split(', '),
    };
  });
}

/**
 * Search journal entries by content or tags
 */
export function searchJournal(input: {
  projectPath?: string;
  query: string;
}): JournalEntry[] {
  const entries = getJournalEntries({ projectPath: sanitizePath(input.projectPath), limit: 100 });
  const query = limitLength(input.query, 200).toLowerCase();
  
  return entries.filter(entry => 
    entry.title.toLowerCase().includes(query) ||
    entry.conversation.toLowerCase().includes(query) ||
    entry.tags?.some(t => t.toLowerCase().includes(query))
  );
}
