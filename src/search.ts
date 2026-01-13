/**
 * Semantic Search for Midas
 * 
 * Simple keyword-based search with TF-IDF-like scoring.
 * Can be upgraded to use embeddings when available.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { sanitizePath } from './security.js';
import { getJournalEntries } from './tools/journal.js';

const MIDAS_DIR = '.midas';
const INDEX_FILE = 'search-index.json';

// ============================================================================
// TYPES
// ============================================================================

export interface SearchChunk {
  id: string;
  type: 'journal' | 'code' | 'doc' | 'error';
  source: string;  // File path or journal ID
  content: string;
  timestamp: number;
  keywords: string[];
  score?: number;  // TF-IDF-like score
}

interface SearchIndex {
  chunks: SearchChunk[];
  keywords: Record<string, number>;  // keyword -> document frequency
  lastUpdated: number;
}

// ============================================================================
// KEYWORD EXTRACTION
// ============================================================================

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'must', 'that', 'this', 'these', 'those', 'it', 'its',
  'i', 'you', 'he', 'she', 'we', 'they', 'them', 'their', 'my', 'your',
  'not', 'no', 'yes', 'if', 'then', 'else', 'when', 'while', 'so', 'than',
  'just', 'only', 'also', 'very', 'too', 'more', 'most', 'some', 'any',
  'all', 'each', 'every', 'both', 'few', 'many', 'much', 'other', 'such',
]);

function extractKeywords(text: string): string[] {
  // Tokenize and normalize
  const words = text.toLowerCase()
    .replace(/[^a-z0-9_\-\.]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  
  // Count frequencies
  const freq: Record<string, number> = {};
  for (const word of words) {
    freq[word] = (freq[word] || 0) + 1;
  }
  
  // Return top keywords by frequency
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word);
}

// ============================================================================
// INDEX MANAGEMENT
// ============================================================================

function getIndexPath(projectPath: string): string {
  return join(projectPath, MIDAS_DIR, INDEX_FILE);
}

function loadIndex(projectPath: string): SearchIndex {
  const path = getIndexPath(projectPath);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      // Corrupted index
    }
  }
  return { chunks: [], keywords: {}, lastUpdated: 0 };
}

function saveIndex(projectPath: string, index: SearchIndex): void {
  const dir = join(projectPath, MIDAS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  index.lastUpdated = Date.now();
  writeFileSync(getIndexPath(projectPath), JSON.stringify(index, null, 2));
}

// ============================================================================
// INDEXING
// ============================================================================

/**
 * Index journal entries for search
 */
export function indexJournalEntries(projectPath: string): number {
  const safePath = sanitizePath(projectPath);
  const index = loadIndex(safePath);
  const entries = getJournalEntries({ projectPath: safePath, limit: 100 });
  
  // Remove old journal chunks
  index.chunks = index.chunks.filter(c => c.type !== 'journal');
  
  // Add new journal chunks
  for (const entry of entries) {
    const keywords = extractKeywords(entry.title + ' ' + entry.conversation);
    
    index.chunks.push({
      id: `journal-${entry.id}`,
      type: 'journal',
      source: entry.id,
      content: entry.conversation.slice(0, 1000),  // Limit content size
      timestamp: new Date(entry.timestamp).getTime(),
      keywords,
    });
    
    // Update keyword frequencies
    for (const kw of keywords) {
      index.keywords[kw] = (index.keywords[kw] || 0) + 1;
    }
  }
  
  saveIndex(safePath, index);
  return entries.length;
}

/**
 * Index code files for search
 */
export function indexCodeFiles(projectPath: string, maxFiles: number = 50): number {
  const safePath = sanitizePath(projectPath);
  const index = loadIndex(safePath);
  
  // Remove old code chunks
  index.chunks = index.chunks.filter(c => c.type !== 'code');
  
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.swift', '.md'];
  const ignore = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.midas'];
  
  let indexed = 0;
  
  function scanDir(dir: string, depth = 0): void {
    if (depth > 3 || indexed >= maxFiles) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (indexed >= maxFiles) break;
        if (entry.name.startsWith('.') || ignore.includes(entry.name)) continue;
        
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(path, depth + 1);
        } else if (extensions.some(ext => entry.name.endsWith(ext))) {
          try {
            const content = readFileSync(path, 'utf-8').slice(0, 2000);
            const keywords = extractKeywords(content);
            const relativePath = path.replace(safePath + '/', '');
            
            index.chunks.push({
              id: `code-${relativePath}`,
              type: 'code',
              source: relativePath,
              content: content.slice(0, 500),
              timestamp: Date.now(),
              keywords,
            });
            
            for (const kw of keywords) {
              index.keywords[kw] = (index.keywords[kw] || 0) + 1;
            }
            
            indexed++;
          } catch {
            // Can't read file
          }
        }
      }
    } catch {
      // Can't read directory
    }
  }
  
  scanDir(safePath);
  saveIndex(safePath, index);
  return indexed;
}

/**
 * Add an error to the search index
 */
export function indexError(projectPath: string, error: string, file?: string): void {
  const safePath = sanitizePath(projectPath);
  const index = loadIndex(safePath);
  
  const keywords = extractKeywords(error + ' ' + (file || ''));
  
  index.chunks.push({
    id: `error-${Date.now()}`,
    type: 'error',
    source: file || 'unknown',
    content: error.slice(0, 500),
    timestamp: Date.now(),
    keywords,
  });
  
  for (const kw of keywords) {
    index.keywords[kw] = (index.keywords[kw] || 0) + 1;
  }
  
  // Keep only recent errors (last 20)
  const errorChunks = index.chunks.filter(c => c.type === 'error');
  if (errorChunks.length > 20) {
    const toRemove = errorChunks
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, errorChunks.length - 20)
      .map(c => c.id);
    index.chunks = index.chunks.filter(c => !toRemove.includes(c.id));
  }
  
  saveIndex(safePath, index);
}

// ============================================================================
// SEARCH
// ============================================================================

/**
 * Search for relevant chunks
 */
export function search(
  projectPath: string, 
  query: string, 
  options: { 
    types?: SearchChunk['type'][];
    limit?: number;
  } = {}
): SearchChunk[] {
  const safePath = sanitizePath(projectPath);
  const index = loadIndex(safePath);
  const queryKeywords = extractKeywords(query);
  
  if (queryKeywords.length === 0) return [];
  
  // Calculate TF-IDF-like scores
  const totalDocs = index.chunks.length || 1;
  const scored: SearchChunk[] = [];
  
  for (const chunk of index.chunks) {
    // Filter by type
    if (options.types && !options.types.includes(chunk.type)) continue;
    
    // Calculate score
    let score = 0;
    for (const qk of queryKeywords) {
      if (chunk.keywords.includes(qk)) {
        // TF: keyword is present
        const tf = 1;
        // IDF: log(total docs / docs with this keyword)
        const df = index.keywords[qk] || 1;
        const idf = Math.log(totalDocs / df);
        score += tf * idf;
      }
    }
    
    if (score > 0) {
      scored.push({ ...chunk, score });
    }
  }
  
  // Sort by score (descending) and recency
  scored.sort((a, b) => {
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (Math.abs(scoreDiff) > 0.5) return scoreDiff;
    return b.timestamp - a.timestamp;
  });
  
  return scored.slice(0, options.limit || 10);
}

/**
 * Get search index stats
 */
export function getSearchStats(projectPath: string): {
  totalChunks: number;
  byType: Record<string, number>;
  totalKeywords: number;
  lastUpdated: number;
} {
  const index = loadIndex(projectPath);
  
  const byType: Record<string, number> = {};
  for (const chunk of index.chunks) {
    byType[chunk.type] = (byType[chunk.type] || 0) + 1;
  }
  
  return {
    totalChunks: index.chunks.length,
    byType,
    totalKeywords: Object.keys(index.keywords).length,
    lastUpdated: index.lastUpdated,
  };
}

/**
 * Rebuild the entire search index
 */
export function rebuildIndex(projectPath: string): { journal: number; code: number } {
  const safePath = sanitizePath(projectPath);
  
  // Clear existing index
  const index: SearchIndex = { chunks: [], keywords: {}, lastUpdated: Date.now() };
  saveIndex(safePath, index);
  
  // Re-index everything
  const journal = indexJournalEntries(safePath);
  const code = indexCodeFiles(safePath);
  
  return { journal, code };
}
