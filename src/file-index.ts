/**
 * Lightweight File Index
 * 
 * Persists file metadata to speed up code discovery:
 * - File hashes for change detection
 * - Basic symbol extraction (functions, classes, exports)
 * - Relevance scores from previous analyses
 * 
 * This is NOT a full embedding/vector index - just fast metadata caching.
 */

import { existsSync, readFileSync, statSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import writeFileAtomic from 'write-file-atomic';
import { join, extname } from 'path';
import { sanitizePath } from './security.js';
import { logger } from './logger.js';

// ============================================================================
// TYPES
// ============================================================================

export interface FileMetadata {
  hash: string;                // Content hash for change detection
  size: number;                // File size in bytes
  mtime: number;               // Last modified timestamp
  lastIndexed: number;         // When we last analyzed this file
  
  // Basic symbol extraction
  symbols: string[];           // Function/class/export names
  imports: string[];           // Import paths
  
  // From previous analysis
  relevanceScore?: number;     // 0-100 relevance score
  reasons?: string[];          // Why it's relevant
  
  // Content stats
  lineCount?: number;
  tokenEstimate?: number;
}

export interface FileIndex {
  version: number;             // Schema version for migrations
  projectPath: string;
  lastFullScan: number;        // Timestamp of last full scan
  files: Record<string, FileMetadata>;  // path -> metadata
  
  // Stats
  totalFiles: number;
  totalSymbols: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const INDEX_VERSION = 1;
const MIDAS_DIR = '.midas';
const INDEX_FILE = 'file-index.json';

// How long before we consider a file entry stale (7 days)
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

// ============================================================================
// INDEX OPERATIONS
// ============================================================================

/**
 * Get the path to the index file
 */
function getIndexPath(projectPath: string): string {
  return join(projectPath, MIDAS_DIR, INDEX_FILE);
}

/**
 * Load the file index from disk
 */
export function loadIndex(projectPath: string): FileIndex {
  const safePath = sanitizePath(projectPath);
  const indexPath = getIndexPath(safePath);
  
  if (!existsSync(indexPath)) {
    return createEmptyIndex(safePath);
  }
  
  try {
    const data = JSON.parse(readFileSync(indexPath, 'utf-8'));
    
    // Version check - if outdated, return fresh index
    if (data.version !== INDEX_VERSION) {
      logger.info('File index version mismatch, rebuilding');
      return createEmptyIndex(safePath);
    }
    
    return data as FileIndex;
  } catch (error) {
    logger.warn('Failed to load file index, starting fresh', { error });
    return createEmptyIndex(safePath);
  }
}

/**
 * Save the file index to disk
 */
export function saveIndex(projectPath: string, index: FileIndex): void {
  const safePath = sanitizePath(projectPath);
  const indexPath = getIndexPath(safePath);
  const dir = join(safePath, MIDAS_DIR);
  
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  
  try {
    // Update stats before saving
    index.totalFiles = Object.keys(index.files).length;
    index.totalSymbols = Object.values(index.files)
      .reduce((sum, f) => sum + (f.symbols?.length || 0), 0);
    
    writeFileAtomic.sync(indexPath, JSON.stringify(index, null, 2));
  } catch (error) {
    logger.warn('Failed to save file index', { error });
  }
}

/**
 * Create an empty index
 */
function createEmptyIndex(projectPath: string): FileIndex {
  return {
    version: INDEX_VERSION,
    projectPath,
    lastFullScan: 0,
    files: {},
    totalFiles: 0,
    totalSymbols: 0,
  };
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

/**
 * Compute a fast hash of file content
 */
export function hashFile(filePath: string): string {
  try {
    const content = readFileSync(filePath);
    return createHash('md5').update(content).digest('hex').slice(0, 12);
  } catch {
    return '';
  }
}

/**
 * Check if a file has changed since last index
 * 
 * @param filePath - Can be absolute or relative path
 * @param index - The file index to check against
 * @param relativePath - Optional relative path for lookup (if filePath is absolute)
 */
export function hasFileChanged(
  filePath: string,
  index: FileIndex,
  relativePath?: string
): boolean {
  // Use relativePath for lookup if provided, otherwise use filePath directly
  const lookupPath = relativePath || filePath;
  const metadata = index.files[lookupPath];
  if (!metadata) return true;
  
  try {
    const stats = statSync(filePath);
    
    // Quick check: size first (cheapest)
    if (stats.size !== metadata.size) return true;
    
    // Check hash directly (most reliable)
    // mtime can be unreliable across systems
    const currentHash = hashFile(filePath);
    return currentHash !== metadata.hash;
  } catch {
    return true;
  }
}

/**
 * Get list of changed files since last index
 * 
 * @param files - Array of relative paths
 * @param projectPath - Project root path
 */
export function getChangedFiles(
  files: string[],
  projectPath: string
): { changed: string[]; unchanged: string[]; stats: { cached: number; needsUpdate: number } } {
  const safePath = sanitizePath(projectPath);
  const index = loadIndex(safePath);
  
  const changed: string[] = [];
  const unchanged: string[] = [];
  
  for (const file of files) {
    const fullPath = join(safePath, file);
    // Pass both absolute path (for stat) and relative path (for index lookup)
    if (hasFileChanged(fullPath, index, file)) {
      changed.push(file);
    } else {
      unchanged.push(file);
    }
  }
  
  return {
    changed,
    unchanged,
    stats: {
      cached: unchanged.length,
      needsUpdate: changed.length,
    },
  };
}

// ============================================================================
// SYMBOL EXTRACTION
// ============================================================================

/**
 * Extract basic symbols from file content
 * This is a lightweight regex-based extraction, not full AST parsing
 */
export function extractSymbols(content: string, extension: string): {
  symbols: string[];
  imports: string[];
} {
  const symbols: string[] = [];
  const imports: string[] = [];
  
  // TypeScript/JavaScript
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
    // Functions: function name(, const name = function, const name = (
    const funcRegex = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g;
    let match;
    while ((match = funcRegex.exec(content)) !== null) {
      symbols.push(match[1] || match[2]);
    }
    
    // Classes: class Name
    const classRegex = /class\s+(\w+)/g;
    while ((match = classRegex.exec(content)) !== null) {
      symbols.push(match[1]);
    }
    
    // Exports: export { name }, export const name, export function name
    const exportRegex = /export\s+(?:(?:const|let|var|function|class|interface|type)\s+(\w+)|{\s*([^}]+)\s*})/g;
    while ((match = exportRegex.exec(content)) !== null) {
      if (match[1]) {
        symbols.push(match[1]);
      } else if (match[2]) {
        match[2].split(',').forEach(s => {
          const name = s.trim().split(/\s+as\s+/)[0].trim();
          if (name && /^\w+$/.test(name)) symbols.push(name);
        });
      }
    }
    
    // Imports: import ... from 'path'
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }
  }
  
  // Python
  else if (['.py', '.pyw', '.pyi'].includes(extension)) {
    // Functions: def name(
    const defRegex = /def\s+(\w+)\s*\(/g;
    let match;
    while ((match = defRegex.exec(content)) !== null) {
      symbols.push(match[1]);
    }
    
    // Classes: class Name
    const classRegex = /class\s+(\w+)/g;
    while ((match = classRegex.exec(content)) !== null) {
      symbols.push(match[1]);
    }
    
    // Imports: from x import, import x
    const importRegex = /(?:from\s+(\S+)\s+import|import\s+(\S+))/g;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1] || match[2]);
    }
  }
  
  // Rust
  else if (extension === '.rs') {
    // Functions: fn name(, pub fn name(
    const fnRegex = /(?:pub\s+)?fn\s+(\w+)/g;
    let match;
    while ((match = fnRegex.exec(content)) !== null) {
      symbols.push(match[1]);
    }
    
    // Structs and enums
    const structRegex = /(?:pub\s+)?(?:struct|enum)\s+(\w+)/g;
    while ((match = structRegex.exec(content)) !== null) {
      symbols.push(match[1]);
    }
    
    // Use statements
    const useRegex = /use\s+([^;{]+)/g;
    while ((match = useRegex.exec(content)) !== null) {
      imports.push(match[1].trim());
    }
  }
  
  // Go
  else if (extension === '.go') {
    // Functions: func name(, func (receiver) name(
    const funcRegex = /func\s+(?:\([^)]*\)\s+)?(\w+)/g;
    let match;
    while ((match = funcRegex.exec(content)) !== null) {
      symbols.push(match[1]);
    }
    
    // Types: type Name struct/interface
    const typeRegex = /type\s+(\w+)\s+(?:struct|interface)/g;
    while ((match = typeRegex.exec(content)) !== null) {
      symbols.push(match[1]);
    }
    
    // Imports
    const importRegex = /import\s+(?:"([^"]+)"|[\s\S]*?"([^"]+)")/g;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1] || match[2]);
    }
  }
  
  // Deduplicate
  return {
    symbols: [...new Set(symbols)],
    imports: [...new Set(imports)],
  };
}

/**
 * Index a single file
 */
export function indexFile(
  filePath: string,
  projectPath: string,
  options: { forceReindex?: boolean } = {}
): FileMetadata | null {
  const safePath = sanitizePath(projectPath);
  const fullPath = join(safePath, filePath);
  
  if (!existsSync(fullPath)) return null;
  
  try {
    const stats = statSync(fullPath);
    const content = readFileSync(fullPath, 'utf-8');
    const extension = extname(filePath).toLowerCase();
    
    const { symbols, imports } = extractSymbols(content, extension);
    
    const metadata: FileMetadata = {
      hash: hashFile(fullPath),
      size: stats.size,
      mtime: stats.mtimeMs,
      lastIndexed: Date.now(),
      symbols,
      imports,
      lineCount: content.split('\n').length,
    };
    
    return metadata;
  } catch (error) {
    logger.warn(`Failed to index file: ${filePath}`, { error });
    return null;
  }
}

/**
 * Update index for a list of files
 */
export function updateIndex(
  files: string[],
  projectPath: string,
  options: { force?: boolean } = {}
): { updated: number; cached: number; failed: number } {
  const safePath = sanitizePath(projectPath);
  const index = loadIndex(safePath);
  
  let updated = 0;
  let cached = 0;
  let failed = 0;
  
  for (const file of files) {
    const fullPath = join(safePath, file);
    
    // Skip if unchanged and not forcing
    // Pass both absolute path (for stat) and relative path (for index lookup)
    if (!options.force && !hasFileChanged(fullPath, index, file)) {
      cached++;
      continue;
    }
    
    const metadata = indexFile(file, safePath, { forceReindex: options.force });
    if (metadata) {
      index.files[file] = metadata;
      updated++;
    } else {
      failed++;
    }
  }
  
  // Update timestamp
  index.lastFullScan = Date.now();
  
  // Save if anything changed
  if (updated > 0) {
    saveIndex(safePath, index);
  }
  
  return { updated, cached, failed };
}

/**
 * Get cached metadata for a file
 */
export function getCachedMetadata(
  filePath: string,
  projectPath: string
): FileMetadata | null {
  const safePath = sanitizePath(projectPath);
  const index = loadIndex(safePath);
  return index.files[filePath] || null;
}

/**
 * Update relevance scores for files (from analyzer results)
 */
export function updateRelevanceScores(
  scores: Record<string, { score: number; reasons: string[] }>,
  projectPath: string
): void {
  const safePath = sanitizePath(projectPath);
  const index = loadIndex(safePath);
  
  for (const [file, { score, reasons }] of Object.entries(scores)) {
    if (index.files[file]) {
      index.files[file].relevanceScore = score;
      index.files[file].reasons = reasons;
    }
  }
  
  saveIndex(safePath, index);
}

/**
 * Clean up stale entries from the index
 */
export function cleanupIndex(projectPath: string): { removed: number } {
  const safePath = sanitizePath(projectPath);
  const index = loadIndex(safePath);
  
  const now = Date.now();
  let removed = 0;
  
  for (const [file, metadata] of Object.entries(index.files)) {
    const fullPath = join(safePath, file);
    
    // Remove if file no longer exists
    if (!existsSync(fullPath)) {
      delete index.files[file];
      removed++;
      continue;
    }
    
    // Remove if entry is stale
    if (now - metadata.lastIndexed > STALE_THRESHOLD_MS) {
      delete index.files[file];
      removed++;
    }
  }
  
  if (removed > 0) {
    saveIndex(safePath, index);
  }
  
  return { removed };
}

/**
 * Get index statistics
 */
export function getIndexStats(projectPath: string): {
  indexed: number;
  symbols: number;
  lastScan: number;
  staleCount: number;
} {
  const safePath = sanitizePath(projectPath);
  const index = loadIndex(safePath);
  const now = Date.now();
  
  const staleCount = Object.values(index.files)
    .filter(f => now - f.lastIndexed > STALE_THRESHOLD_MS).length;
  
  return {
    indexed: index.totalFiles,
    symbols: index.totalSymbols,
    lastScan: index.lastFullScan,
    staleCount,
  };
}

/**
 * Search symbols across indexed files
 */
export function searchSymbols(
  query: string,
  projectPath: string,
  limit: number = 20
): Array<{ file: string; symbol: string; score: number }> {
  const safePath = sanitizePath(projectPath);
  const index = loadIndex(safePath);
  const queryLower = query.toLowerCase();
  
  const results: Array<{ file: string; symbol: string; score: number }> = [];
  
  for (const [file, metadata] of Object.entries(index.files)) {
    for (const symbol of metadata.symbols) {
      const symbolLower = symbol.toLowerCase();
      
      // Exact match
      if (symbolLower === queryLower) {
        results.push({ file, symbol, score: 100 });
      }
      // Starts with query
      else if (symbolLower.startsWith(queryLower)) {
        results.push({ file, symbol, score: 80 });
      }
      // Contains query
      else if (symbolLower.includes(queryLower)) {
        results.push({ file, symbol, score: 60 });
      }
    }
  }
  
  // Sort by score, then alphabetically
  results.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.symbol.localeCompare(b.symbol);
  });
  
  return results.slice(0, limit);
}
