import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import { execSync } from 'child_process';
import { logger } from './logger.js';

// ============================================================================
// DYNAMIC CURSOR DATABASE DISCOVERY
// ============================================================================

/**
 * Find Cursor's data directory based on OS
 * Returns multiple possible paths to try
 */
function getCursorDataPaths(): string[] {
  const home = homedir();
  const os = platform();
  
  const paths: string[] = [];
  
  if (os === 'darwin') {
    // macOS
    paths.push(join(home, 'Library', 'Application Support', 'Cursor'));
    paths.push(join(home, 'Library', 'Application Support', 'cursor-ai'));
  } else if (os === 'win32') {
    // Windows
    const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    paths.push(join(appData, 'Cursor'));
    paths.push(join(localAppData, 'Cursor'));
  } else {
    // Linux
    paths.push(join(home, '.config', 'Cursor'));
    paths.push(join(home, '.cursor'));
  }
  
  return paths;
}

/**
 * Find the state.vscdb file dynamically
 * Searches common locations and subdirectories
 */
function findCursorDatabase(): string | null {
  const basePaths = getCursorDataPaths();
  
  // Common subdirectory patterns where the database might be
  const subPaths = [
    'User/globalStorage/state.vscdb',
    'globalStorage/state.vscdb',
    'state.vscdb',
    'User/state.vscdb',
  ];
  
  for (const basePath of basePaths) {
    if (!existsSync(basePath)) continue;
    
    // Try known subpaths first
    for (const subPath of subPaths) {
      const fullPath = join(basePath, subPath);
      if (existsSync(fullPath)) {
        logger.debug('Found Cursor database', { path: fullPath });
        return fullPath;
      }
    }
    
    // Fallback: recursively search for state.vscdb (limited depth)
    const found = findFileRecursive(basePath, 'state.vscdb', 4);
    if (found) {
      logger.debug('Found Cursor database via search', { path: found });
      return found;
    }
  }
  
  logger.debug('Cursor database not found');
  return null;
}

/**
 * Recursively search for a file with depth limit
 */
function findFileRecursive(dir: string, filename: string, maxDepth: number): string | null {
  if (maxDepth <= 0) return null;
  
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      if (entry.isFile() && entry.name === filename) {
        return fullPath;
      }
      
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const found = findFileRecursive(fullPath, filename, maxDepth - 1);
        if (found) return found;
      }
    }
  } catch {
    // Permission denied or other error
  }
  
  return null;
}

// Cache the database path (computed once)
let cachedDbPath: string | null | undefined = undefined;

function getCursorDbPath(): string | null {
  if (cachedDbPath === undefined) {
    cachedDbPath = findCursorDatabase();
  }
  return cachedDbPath;
}

export interface ChatMessage {
  type: 'user' | 'assistant';
  text: string;
  bubbleId?: string;
  timestamp?: number;
}

export interface CursorConversation {
  composerId: string;
  messages: ChatMessage[];
  createdAt?: number;
  isAgentic?: boolean;
  model?: string;
}

function runSqlite(query: string): string {
  const dbPath = getCursorDbPath();
  if (!dbPath) {
    return '';
  }
  
  try {
    const result = execSync(
      `sqlite3 "${dbPath}" "${query}"`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 } // 50MB buffer
    );
    return result;
  } catch (error) {
    logger.debug('SQLite query failed', { error: String(error) });
    return '';
  }
}

export function isCursorAvailable(): boolean {
  return getCursorDbPath() !== null;
}

/**
 * Get info about where Cursor data was found
 */
export function getCursorInfo(): { available: boolean; path: string | null; os: string } {
  return {
    available: isCursorAvailable(),
    path: getCursorDbPath(),
    os: platform(),
  };
}

export function getRecentConversationIds(limit = 10): string[] {
  const result = runSqlite(
    `SELECT key FROM cursorDiskKV WHERE key LIKE 'composerData:%' ORDER BY rowid DESC LIMIT ${limit}`
  );
  
  return result
    .split('\n')
    .filter(Boolean)
    .map(key => key.replace('composerData:', ''));
}

export function getConversation(composerId: string): CursorConversation | null {
  const result = runSqlite(
    `SELECT value FROM cursorDiskKV WHERE key = 'composerData:${composerId}'`
  );
  
  if (!result) return null;

  try {
    const data = JSON.parse(result);
    
    const messages: ChatMessage[] = [];
    const conversation = data.conversation || [];
    
    for (const msg of conversation) {
      if (msg.text && typeof msg.text === 'string' && msg.text.trim()) {
        messages.push({
          type: msg.type === 1 ? 'user' : 'assistant',
          text: msg.text,
          bubbleId: msg.bubbleId,
        });
      }
    }

    return {
      composerId: data.composerId,
      messages,
      createdAt: data.createdAt,
      isAgentic: data.isAgentic,
      model: data.modelConfig?.modelName,
    };
  } catch {
    return null;
  }
}

export function getLatestConversation(): CursorConversation | null {
  const ids = getRecentConversationIds(1);
  if (ids.length === 0) return null;
  return getConversation(ids[0]);
}

export function getRecentMessages(limit = 20): ChatMessage[] {
  const ids = getRecentConversationIds(5);
  const messages: ChatMessage[] = [];
  
  for (const id of ids) {
    const conv = getConversation(id);
    if (conv) {
      messages.push(...conv.messages.slice(-10));
    }
    if (messages.length >= limit) break;
  }
  
  return messages.slice(-limit);
}

export function watchConversations(
  callback: (conv: CursorConversation) => void,
  pollInterval = 2000
): () => void {
  let lastSeenId: string | null = null;
  let lastMessageCount = 0;

  const check = () => {
    const ids = getRecentConversationIds(1);
    if (ids.length === 0) return;
    
    const currentId = ids[0];
    const conv = getConversation(currentId);
    
    if (!conv) return;

    // New conversation or new messages
    if (currentId !== lastSeenId || conv.messages.length > lastMessageCount) {
      lastSeenId = currentId;
      lastMessageCount = conv.messages.length;
      callback(conv);
    }
  };

  const interval = setInterval(check, pollInterval);
  check(); // Initial check

  return () => clearInterval(interval);
}

export function extractMidasToolCalls(messages: ChatMessage[]): string[] {
  const toolCalls: string[] = [];
  
  for (const msg of messages) {
    if (msg.type === 'assistant') {
      // Look for midas tool calls in assistant messages
      const midasMatches = msg.text.match(/midas_\w+/g);
      if (midasMatches) {
        toolCalls.push(...midasMatches);
      }
    }
  }
  
  return [...new Set(toolCalls)]; // Unique
}

export function getConversationSummary(conv: CursorConversation): string {
  if (conv.messages.length === 0) return 'Empty conversation';
  
  const userMessages = conv.messages.filter(m => m.type === 'user');
  if (userMessages.length === 0) return 'No user messages';
  
  // Get first user message as summary
  const first = userMessages[0].text.slice(0, 100);
  return first + (first.length >= 100 ? '...' : '');
}
