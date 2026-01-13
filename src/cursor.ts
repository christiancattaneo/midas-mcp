import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

// Cursor's state database location
const CURSOR_DB_PATH = join(
  homedir(),
  'Library',
  'Application Support',
  'Cursor',
  'User',
  'globalStorage',
  'state.vscdb'
);

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
  if (!existsSync(CURSOR_DB_PATH)) {
    throw new Error('Cursor database not found');
  }
  
  try {
    const result = execSync(
      `sqlite3 "${CURSOR_DB_PATH}" "${query}"`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 } // 50MB buffer
    );
    return result;
  } catch (error) {
    return '';
  }
}

export function isCursorAvailable(): boolean {
  return existsSync(CURSOR_DB_PATH);
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
