/**
 * Intelligent Source Code Discovery and Reading
 * 
 * Instead of hardcoded file limits and arbitrary truncation, this module:
 * 1. Discovers ALL source files intelligently
 * 2. Prioritizes based on context (errors, git activity, phase, mentions)
 * 3. Reads files with token-budget awareness
 * 4. Uses semantic chunking for large files
 * 5. Adapts to the current development phase
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, basename, relative } from 'path';
import { sanitizePath } from './security.js';
import { estimateTokens } from './context.js';
import { logger } from './logger.js';
import { 
  loadIndex, 
  saveIndex, 
  getCachedMetadata, 
  indexFile, 
  hasFileChanged,
  type FileMetadata 
} from './file-index.js';
import type { Phase } from './state/phase.js';

// ============================================================================
// TYPES
// ============================================================================

export interface SourceFile {
  path: string;              // Relative path from project root
  absolutePath: string;      // Full path
  filename: string;
  extension: string;
  sizeBytes: number;
  lastModified: number;      // Unix timestamp
  
  // Scoring
  relevanceScore: number;    // 0-100, higher = more important
  reasons: string[];         // Why this file is relevant
  
  // Content (populated when read)
  content?: string;
  lineCount?: number;
  tokenEstimate?: number;
  truncated?: boolean;
}

export interface CodeContext {
  phase?: Phase;
  errors?: string[];         // Current error messages
  recentCommits?: string[];  // Recent git commit messages
  mentions?: string[];       // Files mentioned in conversation/journal
  focusFiles?: string[];     // Specific files to prioritize
}

export interface CodeDiscoveryResult {
  files: SourceFile[];       // All discovered files, sorted by relevance
  
  // Categorized views
  sourceFiles: SourceFile[]; // Non-test source code
  testFiles: SourceFile[];   // Test files
  configFiles: SourceFile[]; // Config/build files
  
  // Stats
  totalFiles: number;
  totalBytes: number;
  totalTokens: number;
  
  // For prompts
  fileList: string;          // Formatted file list
  codeContext: string;       // Formatted code samples
}

export interface ReadOptions {
  maxTokens?: number;        // Token budget for all files
  maxFilesToRead?: number;   // Limit files read
  maxLinesPerFile?: number;  // Limit per file
  includeTests?: boolean;    // Include test files
  fullRead?: boolean;        // Read all files fully (ignores limits)
}

// ============================================================================
// FILE PATTERNS
// ============================================================================

// Source code extensions by language
const SOURCE_EXTENSIONS: Record<string, string[]> = {
  typescript: ['.ts', '.tsx', '.mts', '.cts'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py', '.pyw', '.pyi'],
  rust: ['.rs'],
  go: ['.go'],
  java: ['.java'],
  kotlin: ['.kt', '.kts'],
  swift: ['.swift'],
  csharp: ['.cs'],
  cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.h'],
  c: ['.c', '.h'],
  ruby: ['.rb'],
  php: ['.php'],
  shell: ['.sh', '.bash', '.zsh'],
  sql: ['.sql'],
  graphql: ['.graphql', '.gql'],
};

const ALL_SOURCE_EXTENSIONS = new Set(Object.values(SOURCE_EXTENSIONS).flat());

// Config file patterns
const CONFIG_PATTERNS = [
  /^package\.json$/,
  /^tsconfig.*\.json$/,
  /^\..*rc(\.json|\.js|\.cjs|\.mjs)?$/,
  /^.*config\.(js|ts|json|mjs|cjs)$/,
  /^Cargo\.toml$/,
  /^pyproject\.toml$/,
  /^go\.(mod|sum)$/,
  /^Gemfile$/,
  /^Makefile$/,
  /^Dockerfile/,
  /^docker-compose/,
  /^\.env\.example$/,
];

// Test file patterns
const TEST_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /_test\./,
  /test_/,
  /__tests__/,
  /tests\//,
  /spec\//,
];

// High-priority file patterns (entry points, core files)
const PRIORITY_PATTERNS = [
  /^index\./,
  /^main\./,
  /^app\./,
  /^server\./,
  /^api\./,
  /^routes?\./,
  /^handlers?\./,
  /^controllers?\./,
  /^models?\./,
  /^schema\./,
  /^types?\./,
  /^utils?\./,
  /^lib\./,
  /^core\./,
  /^services?\./,
];

// Directories to skip
const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.svelte-kit', '.output',
  'coverage', '__pycache__', '.pytest_cache', '.mypy_cache',
  'vendor', 'venv', '.venv', 'env', '.env',
  '.midas', '.cursor', '.vscode', '.idea',
  'assets', 'public', 'static', 'images', 'fonts',
]);

// ============================================================================
// FILE DISCOVERY
// ============================================================================

/**
 * Discover all source files in a project
 */
export function discoverSourceFiles(
  projectPath: string,
  context: CodeContext = {}
): SourceFile[] {
  const safePath = sanitizePath(projectPath);
  const files: SourceFile[] = [];
  
  // Load file index for caching
  const fileIndex = loadIndex(safePath);
  
  function scan(dir: string, depth: number = 0): void {
    if (depth > 10) return; // Prevent infinite recursion
    if (!existsSync(dir)) return;
    
    try {
      const entries = readdirSync(dir);
      
      for (const entry of entries) {
        // Skip hidden files except specific configs
        if (entry.startsWith('.') && !isConfigFile(entry)) continue;
        
        const fullPath = join(dir, entry);
        const relativePath = relative(safePath, fullPath);
        
        try {
          const stat = statSync(fullPath);
          
          if (stat.isDirectory()) {
            const dirName = basename(entry).toLowerCase();
            if (!SKIP_DIRECTORIES.has(dirName)) {
              scan(fullPath, depth + 1);
            }
          } else if (stat.isFile()) {
            const ext = extname(entry).toLowerCase();
            
            // Include source files and config files
            if (ALL_SOURCE_EXTENSIONS.has(ext) || isConfigFile(entry)) {
              // Check if we have cached metadata
              const cached = getCachedMetadata(relativePath, safePath);
              
              const file: SourceFile = {
                path: relativePath,
                absolutePath: fullPath,
                filename: entry,
                extension: ext,
                sizeBytes: stat.size,
                lastModified: stat.mtimeMs,
                relevanceScore: cached?.relevanceScore || 0,
                reasons: cached?.reasons || [],
                // Use cached line count and tokens if available and file unchanged
                lineCount: (!hasFileChanged(fullPath, fileIndex, relativePath) && cached?.lineCount) 
                  ? cached.lineCount 
                  : undefined,
                tokenEstimate: (!hasFileChanged(fullPath, fileIndex, relativePath) && cached?.tokenEstimate) 
                  ? cached.tokenEstimate 
                  : undefined,
              };
              
              // Calculate relevance score
              scoreFile(file, context);
              files.push(file);
            }
          }
        } catch {
          // Skip files we can't stat
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }
  
  scan(safePath);
  
  // Sort by relevance score (highest first)
  files.sort((a, b) => b.relevanceScore - a.relevanceScore);
  
  // Update index with discovered files (in background, non-blocking)
  updateIndexFromDiscovery(files, safePath, fileIndex);
  
  return files;
}

/**
 * Update file index with discovery results (lightweight, async-like)
 */
function updateIndexFromDiscovery(
  files: SourceFile[],
  projectPath: string,
  index: ReturnType<typeof loadIndex>
): void {
  let updated = false;
  
  for (const file of files) {
    // Only update if we don't have metadata or file changed
    if (!index.files[file.path] || hasFileChanged(file.absolutePath, index, file.path)) {
      const metadata = indexFile(file.path, projectPath);
      if (metadata) {
        // Preserve relevance score from discovery
        metadata.relevanceScore = file.relevanceScore;
        metadata.reasons = file.reasons;
        index.files[file.path] = metadata;
        updated = true;
      }
    }
  }
  
  if (updated) {
    index.lastFullScan = Date.now();
    saveIndex(projectPath, index);
  }
}

function isConfigFile(filename: string): boolean {
  return CONFIG_PATTERNS.some(p => p.test(filename));
}

function isTestFile(path: string): boolean {
  return TEST_PATTERNS.some(p => p.test(path));
}

function isPriorityFile(filename: string): boolean {
  return PRIORITY_PATTERNS.some(p => p.test(filename));
}

/**
 * Score a file based on context and patterns
 */
function scoreFile(file: SourceFile, context: CodeContext): void {
  let score = 50; // Base score
  const reasons: string[] = [];
  
  // 1. Priority patterns (entry points, core files)
  if (isPriorityFile(file.filename)) {
    score += 20;
    reasons.push('core file');
  }
  
  // 2. Test files - score based on phase
  if (isTestFile(file.path)) {
    file.reasons.push('test file');
    if (context.phase?.phase === 'BUILD' && 
        (context.phase.step === 'TEST' || context.phase.step === 'DEBUG')) {
      score += 15;
      reasons.push('testing phase');
    } else {
      score -= 10; // Deprioritize tests when not testing
    }
  }
  
  // 3. Config files - always somewhat relevant
  if (isConfigFile(file.filename)) {
    score += 10;
    reasons.push('config');
  }
  
  // 4. Mentioned in errors
  if (context.errors?.some(e => e.includes(file.path) || e.includes(file.filename))) {
    score += 30;
    reasons.push('error location');
  }
  
  // 5. Mentioned in conversation/journal
  if (context.mentions?.some(m => file.path.includes(m) || m.includes(file.filename))) {
    score += 25;
    reasons.push('mentioned');
  }
  
  // 6. Explicitly focused
  if (context.focusFiles?.some(f => file.path.includes(f) || f.includes(file.path))) {
    score += 40;
    reasons.push('focus file');
  }
  
  // 7. Recently modified (last hour = +15, last day = +10, last week = +5)
  const hourAgo = Date.now() - 3600000;
  const dayAgo = Date.now() - 86400000;
  const weekAgo = Date.now() - 604800000;
  
  if (file.lastModified > hourAgo) {
    score += 15;
    reasons.push('recently modified');
  } else if (file.lastModified > dayAgo) {
    score += 10;
    reasons.push('modified today');
  } else if (file.lastModified > weekAgo) {
    score += 5;
  }
  
  // 8. Mentioned in recent commits
  if (context.recentCommits?.some(c => c.includes(file.filename))) {
    score += 10;
    reasons.push('in commit');
  }
  
  // 9. Source directory bonus (src/, lib/, app/)
  if (file.path.startsWith('src/') || file.path.startsWith('lib/') || file.path.startsWith('app/')) {
    score += 5;
  }
  
  // 10. Penalize very large files slightly
  if (file.sizeBytes > 50000) {
    score -= 5;
  }
  
  // Clamp score
  file.relevanceScore = Math.max(0, Math.min(100, score));
  file.reasons = reasons;
}

// ============================================================================
// SMART FILE READING
// ============================================================================

/**
 * Read files intelligently with token budget awareness
 */
export function readSourceFiles(
  files: SourceFile[],
  options: ReadOptions = {}
): SourceFile[] {
  const {
    maxTokens = 50000,       // Default ~50k tokens for code
    maxFilesToRead = 50,     // Read up to 50 files
    maxLinesPerFile = 500,   // Max lines per file (if truncating)
    includeTests = true,
    fullRead = false,
  } = options;
  
  let tokenBudget = maxTokens;
  let filesRead = 0;
  
  // Filter files if needed
  let filesToRead = files;
  if (!includeTests) {
    filesToRead = files.filter(f => !isTestFile(f.path));
  }
  
  // Read files in order of relevance until budget exhausted
  for (const file of filesToRead) {
    if (filesRead >= maxFilesToRead && !fullRead) break;
    if (tokenBudget <= 0 && !fullRead) break;
    
    try {
      const content = readFileSync(file.absolutePath, 'utf-8');
      const lines = content.split('\n');
      file.lineCount = lines.length;
      
      // Estimate tokens
      const tokens = estimateTokens(content);
      file.tokenEstimate = tokens;
      
      // Check if we have budget
      if (!fullRead && tokens > tokenBudget) {
        // Try to read partial file
        const availableLines = Math.floor((tokenBudget / tokens) * lines.length);
        if (availableLines < 20) {
          // Not enough budget for meaningful content
          continue;
        }
        
        // Read with smart truncation
        file.content = smartTruncate(content, lines, Math.min(availableLines, maxLinesPerFile));
        file.truncated = true;
        tokenBudget -= estimateTokens(file.content);
      } else if (!fullRead && lines.length > maxLinesPerFile) {
        // File too long, smart truncate
        file.content = smartTruncate(content, lines, maxLinesPerFile);
        file.truncated = true;
        tokenBudget -= estimateTokens(file.content);
      } else {
        // Read full file
        file.content = content;
        file.truncated = false;
        tokenBudget -= tokens;
      }
      
      filesRead++;
    } catch (err) {
      logger.debug(`Could not read ${file.path}: ${err}`);
    }
  }
  
  return filesToRead.filter(f => f.content !== undefined);
}

/**
 * Smart truncation that preserves important parts of code
 */
function smartTruncate(content: string, lines: string[], maxLines: number): string {
  if (lines.length <= maxLines) return content;
  
  // Strategy: Keep imports/exports, beginning, and end
  // Middle usually has implementation details that can be inferred
  
  const result: string[] = [];
  let linesTaken = 0;
  
  // 1. Keep all imports/exports at the beginning (up to 30% of budget)
  const importBudget = Math.floor(maxLines * 0.3);
  let importLines = 0;
  
  for (let i = 0; i < lines.length && importLines < importBudget; i++) {
    const line = lines[i].trim();
    if (line.startsWith('import ') || 
        line.startsWith('export ') || 
        line.startsWith('from ') ||
        line.startsWith('require(') ||
        line.startsWith('const ') && line.includes('require(') ||
        line.startsWith('use ') ||  // Rust
        line.startsWith('package ') || // Go/Java
        line === '' ||
        line.startsWith('//') ||
        line.startsWith('#')) {
      result.push(lines[i]);
      importLines++;
      linesTaken++;
    } else if (importLines > 0) {
      // End of imports section
      break;
    }
  }
  
  // 2. Keep type definitions and function signatures (next 30%)
  const signatureBudget = Math.floor(maxLines * 0.3);
  let signatureLines = 0;
  
  for (let i = linesTaken; i < lines.length && signatureLines < signatureBudget; i++) {
    const line = lines[i].trim();
    const isSignature = 
      line.startsWith('export ') ||
      line.startsWith('interface ') ||
      line.startsWith('type ') ||
      line.startsWith('class ') ||
      line.startsWith('struct ') ||
      line.startsWith('enum ') ||
      line.startsWith('function ') ||
      line.startsWith('async function ') ||
      line.startsWith('const ') && line.includes(' = (') ||
      line.startsWith('def ') ||
      line.startsWith('fn ') ||
      line.startsWith('pub ') ||
      line.match(/^\s*(public|private|protected)\s+/);
    
    if (isSignature) {
      result.push(lines[i]);
      signatureLines++;
      linesTaken = i + 1;
      
      // Include opening brace if next line
      if (i + 1 < lines.length && lines[i + 1].trim() === '{') {
        result.push(lines[i + 1]);
        signatureLines++;
        linesTaken = i + 2;
      }
    }
  }
  
  // 3. Add truncation marker
  const remaining = lines.length - linesTaken;
  if (remaining > 20) {
    result.push(`\n// ... ${remaining} lines of implementation ...\n`);
  }
  
  // 4. Keep the last 20% (exports, main logic at end)
  const tailBudget = Math.floor(maxLines * 0.2);
  const tailStart = Math.max(linesTaken, lines.length - tailBudget);
  
  if (tailStart < lines.length) {
    for (let i = tailStart; i < lines.length; i++) {
      result.push(lines[i]);
    }
  }
  
  return result.join('\n');
}

// ============================================================================
// HIGH-LEVEL API
// ============================================================================

/**
 * Full discovery and reading with intelligent defaults
 */
export function discoverAndReadCode(
  projectPath: string,
  context: CodeContext = {},
  options: ReadOptions = {}
): CodeDiscoveryResult {
  // Discover all files
  const allFiles = discoverSourceFiles(projectPath, context);
  
  // Categorize
  const sourceFiles = allFiles.filter(f => !isTestFile(f.path) && !isConfigFile(f.filename));
  const testFiles = allFiles.filter(f => isTestFile(f.path));
  const configFiles = allFiles.filter(f => isConfigFile(f.filename));
  
  // Read with context-aware options
  const phaseOptions = getPhaseOptions(context.phase, options);
  const readFiles = readSourceFiles(allFiles, phaseOptions);
  
  // Calculate stats
  const totalBytes = allFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
  const totalTokens = readFiles.reduce((sum, f) => sum + (f.tokenEstimate || 0), 0);
  
  // Format for prompts
  const fileList = formatFileList(allFiles);
  const codeContext = formatCodeContext(readFiles);
  
  return {
    files: readFiles,
    sourceFiles: readFiles.filter(f => !isTestFile(f.path) && !isConfigFile(f.filename)),
    testFiles: readFiles.filter(f => isTestFile(f.path)),
    configFiles: readFiles.filter(f => isConfigFile(f.filename)),
    totalFiles: allFiles.length,
    totalBytes,
    totalTokens,
    fileList,
    codeContext,
  };
}

/**
 * Get read options based on current phase
 */
function getPhaseOptions(phase: Phase | undefined, overrides: ReadOptions): ReadOptions {
  const base: ReadOptions = {
    maxTokens: 50000,
    maxFilesToRead: 50,
    maxLinesPerFile: 500,
    includeTests: true,
  };
  
  if (!phase || phase.phase === 'IDLE') {
    // Default behavior
    return { ...base, ...overrides };
  }
  
  switch (phase.phase) {
    case 'PLAN':
      // During planning, focus on structure, less on implementation
      return {
        ...base,
        maxTokens: 30000,
        maxFilesToRead: 30,
        includeTests: false,
        ...overrides,
      };
      
    case 'BUILD':
      switch (phase.step) {
        case 'TEST':
        case 'DEBUG':
          // Testing/debugging: include tests, focus on error files
          return {
            ...base,
            maxTokens: 60000,
            maxFilesToRead: 60,
            includeTests: true,
            ...overrides,
          };
        case 'IMPLEMENT':
          // Implementation: balance of source and tests
          return {
            ...base,
            maxTokens: 50000,
            maxFilesToRead: 50,
            includeTests: true,
            ...overrides,
          };
        default:
          return { ...base, ...overrides };
      }
      
    case 'SHIP':
      // Shipping: full code review, include everything
      return {
        ...base,
        maxTokens: 70000,
        maxFilesToRead: 70,
        includeTests: true,
        ...overrides,
      };
      
    case 'GROW':
      // Growth: less code focus
      return {
        ...base,
        maxTokens: 20000,
        maxFilesToRead: 20,
        includeTests: false,
        ...overrides,
      };
      
    default:
      return { ...base, ...overrides };
  }
}

/**
 * Format file list for prompts (shows structure)
 */
function formatFileList(files: SourceFile[]): string {
  // Group by directory
  const byDir: Record<string, SourceFile[]> = {};
  
  for (const file of files) {
    const parts = file.path.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    if (!byDir[dir]) byDir[dir] = [];
    byDir[dir].push(file);
  }
  
  // Format with hierarchy
  const lines: string[] = [`## Project Structure (${files.length} files)\n`];
  
  const sortedDirs = Object.keys(byDir).sort();
  for (const dir of sortedDirs) {
    const dirFiles = byDir[dir];
    lines.push(`### ${dir}/`);
    
    // Sort by relevance within dir
    dirFiles.sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    for (const f of dirFiles.slice(0, 20)) { // Limit per directory
      const score = f.relevanceScore > 70 ? '★' : f.relevanceScore > 50 ? '·' : '';
      const reasons = f.reasons.length > 0 ? ` (${f.reasons.join(', ')})` : '';
      lines.push(`- ${f.filename}${score}${reasons}`);
    }
    
    if (dirFiles.length > 20) {
      lines.push(`  ... and ${dirFiles.length - 20} more files`);
    }
  }
  
  return lines.join('\n');
}

/**
 * Format code samples for prompts
 */
function formatCodeContext(files: SourceFile[]): string {
  const sections: string[] = [];
  
  // Group by category
  const highPriority = files.filter(f => f.relevanceScore >= 70);
  const mediumPriority = files.filter(f => f.relevanceScore >= 50 && f.relevanceScore < 70);
  const lowPriority = files.filter(f => f.relevanceScore < 50);
  
  // Format high priority files with full context
  if (highPriority.length > 0) {
    sections.push('## Key Files (High Relevance)\n');
    for (const f of highPriority) {
      const truncNote = f.truncated ? ' [truncated]' : '';
      const reasons = f.reasons.length > 0 ? ` — ${f.reasons.join(', ')}` : '';
      sections.push(`### ${f.path}${truncNote}${reasons}\n\`\`\`${getLanguage(f.extension)}\n${f.content}\n\`\`\`\n`);
    }
  }
  
  // Format medium priority with less context
  if (mediumPriority.length > 0) {
    sections.push('## Supporting Files\n');
    for (const f of mediumPriority) {
      const truncNote = f.truncated ? ' [truncated]' : '';
      sections.push(`### ${f.path}${truncNote}\n\`\`\`${getLanguage(f.extension)}\n${f.content}\n\`\`\`\n`);
    }
  }
  
  // Just list low priority
  if (lowPriority.length > 0) {
    sections.push(`## Other Files (${lowPriority.length} files with lower relevance, not shown)\n`);
    sections.push(lowPriority.slice(0, 10).map(f => `- ${f.path}`).join('\n'));
  }
  
  return sections.join('\n');
}

function getLanguage(ext: string): string {
  const langMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.py': 'python',
    '.rs': 'rust',
    '.go': 'go',
    '.java': 'java',
    '.kt': 'kotlin',
    '.swift': 'swift',
    '.cs': 'csharp',
    '.cpp': 'cpp',
    '.c': 'c',
    '.rb': 'ruby',
    '.php': 'php',
    '.sh': 'bash',
    '.sql': 'sql',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
  };
  return langMap[ext] || '';
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

/**
 * Quick check: does the project have tests?
 */
export function hasTestFiles(projectPath: string): boolean {
  const files = discoverSourceFiles(projectPath);
  return files.some(f => isTestFile(f.path));
}

/**
 * Get files related to a specific error
 */
export function getErrorRelatedFiles(
  projectPath: string,
  errorMessage: string
): SourceFile[] {
  const context: CodeContext = {
    errors: [errorMessage],
  };
  
  const files = discoverSourceFiles(projectPath, context);
  return files.filter(f => f.reasons.includes('error location'));
}

/**
 * Get recently modified files
 */
export function getRecentlyModifiedFiles(
  projectPath: string,
  maxAge: number = 86400000 // 24 hours
): SourceFile[] {
  const cutoff = Date.now() - maxAge;
  const files = discoverSourceFiles(projectPath);
  return files.filter(f => f.lastModified > cutoff);
}
