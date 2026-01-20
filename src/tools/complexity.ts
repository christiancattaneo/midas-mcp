/**
 * Code Complexity Analysis Tools
 * 
 * Metrics-based code quality analysis:
 * - Cyclomatic complexity
 * - Nesting depth
 * - Function length
 * - File size
 * - Cognitive complexity indicators
 */

import { z } from 'zod';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import { sanitizePath } from '../security.js';

// ============================================================================
// SCHEMAS
// ============================================================================

export const complexitySchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  threshold: z.number().optional().describe('Complexity threshold (default: 10)'),
  limit: z.number().optional().describe('Max results to return (default: 20)'),
});

export type ComplexityInput = z.infer<typeof complexitySchema>;

export const simplifySchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  file: z.string().optional().describe('Specific file to analyze'),
});

export type SimplifyInput = z.infer<typeof simplifySchema>;

// ============================================================================
// TYPES
// ============================================================================

export interface FunctionComplexity {
  file: string;
  name: string;
  line: number;
  metrics: {
    cyclomaticComplexity: number;
    nestingDepth: number;
    lineCount: number;
    parameterCount: number;
  };
  issues: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface FileComplexity {
  file: string;
  lineCount: number;
  functionCount: number;
  avgComplexity: number;
  maxComplexity: number;
  issues: string[];
}

export interface ComplexityReport {
  summary: {
    filesAnalyzed: number;
    functionsAnalyzed: number;
    avgComplexity: number;
    hotspotCount: number;
  };
  hotspots: FunctionComplexity[];
  fileStats: FileComplexity[];
  suggestedPrompt: string;
}

export interface SimplifyReport {
  file: string;
  issues: SimplifyIssue[];
  suggestedPrompt: string;
  estimatedImprovement: string;
}

export interface SimplifyIssue {
  type: 'nesting' | 'length' | 'complexity' | 'duplication' | 'abstraction' | 'dead-code';
  location: string;
  line: number;
  description: string;
  suggestion: string;
  priority: 'low' | 'medium' | 'high';
}

// ============================================================================
// CONSTANTS
// ============================================================================

const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.midas', 'coverage', '.next', '__pycache__'];
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go'];

// Complexity thresholds
const THRESHOLDS = {
  cyclomaticComplexity: { low: 5, medium: 10, high: 15, critical: 20 },
  nestingDepth: { low: 2, medium: 3, high: 4, critical: 5 },
  lineCount: { low: 30, medium: 50, high: 100, critical: 200 },
  fileLineCount: { low: 200, medium: 400, high: 600, critical: 1000 },
  parameterCount: { low: 3, medium: 5, high: 7, critical: 10 },
};

// ============================================================================
// COMPLEXITY ANALYSIS
// ============================================================================

/**
 * Analyze code complexity across the project
 */
export function analyzeComplexity(input: ComplexityInput): ComplexityReport {
  const projectPath = sanitizePath(input.projectPath);
  const threshold = input.threshold ?? 10;
  const limit = input.limit ?? 20;

  const allFunctions: FunctionComplexity[] = [];
  const fileStats: FileComplexity[] = [];
  let filesAnalyzed = 0;

  function scanDir(dir: string, depth = 0): void {
    if (depth > 10) return;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORE_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;

        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (CODE_EXTENSIONS.includes(ext)) {
            const result = analyzeFile(fullPath, projectPath);
            if (result) {
              filesAnalyzed++;
              allFunctions.push(...result.functions);
              fileStats.push(result.fileStats);
            }
          }
        }
      }
    } catch {
      // Skip inaccessible
    }
  }

  scanDir(projectPath);

  // Filter hotspots above threshold
  const hotspots = allFunctions
    .filter(f => f.metrics.cyclomaticComplexity >= threshold)
    .sort((a, b) => b.metrics.cyclomaticComplexity - a.metrics.cyclomaticComplexity)
    .slice(0, limit);

  // Calculate summary
  const totalComplexity = allFunctions.reduce((sum, f) => sum + f.metrics.cyclomaticComplexity, 0);
  const avgComplexity = allFunctions.length > 0 ? totalComplexity / allFunctions.length : 0;

  // Generate suggested prompt
  let suggestedPrompt = 'Codebase complexity is healthy. No immediate action needed.';
  if (hotspots.length > 0) {
    const top = hotspots[0];
    suggestedPrompt = `Refactor ${top.name} in ${top.file}:${top.line} - complexity ${top.metrics.cyclomaticComplexity}, ` +
      `${top.metrics.nestingDepth} levels deep, ${top.metrics.lineCount} lines. ${top.issues[0] || 'Extract helper functions.'}`;
  }

  return {
    summary: {
      filesAnalyzed,
      functionsAnalyzed: allFunctions.length,
      avgComplexity: Math.round(avgComplexity * 10) / 10,
      hotspotCount: hotspots.length,
    },
    hotspots,
    fileStats: fileStats
      .sort((a, b) => b.maxComplexity - a.maxComplexity)
      .slice(0, 10),
    suggestedPrompt,
  };
}

/**
 * Analyze a single file for complexity
 */
function analyzeFile(filePath: string, projectPath: string): { functions: FunctionComplexity[]; fileStats: FileComplexity } | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const relativePath = relative(projectPath, filePath);

    const functions: FunctionComplexity[] = [];
    const ext = extname(filePath);

    // Extract functions based on language
    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      functions.push(...extractJSFunctions(content, relativePath));
    } else if (ext === '.py') {
      functions.push(...extractPythonFunctions(content, relativePath));
    } else if (ext === '.go') {
      functions.push(...extractGoFunctions(content, relativePath));
    } else if (ext === '.rs') {
      functions.push(...extractRustFunctions(content, relativePath));
    }

    // File-level stats
    const fileIssues: string[] = [];
    if (lines.length > THRESHOLDS.fileLineCount.high) {
      fileIssues.push(`File has ${lines.length} lines - consider splitting`);
    }

    const avgComplexity = functions.length > 0
      ? functions.reduce((sum, f) => sum + f.metrics.cyclomaticComplexity, 0) / functions.length
      : 0;
    const maxComplexity = functions.length > 0
      ? Math.max(...functions.map(f => f.metrics.cyclomaticComplexity))
      : 0;

    return {
      functions,
      fileStats: {
        file: relativePath,
        lineCount: lines.length,
        functionCount: functions.length,
        avgComplexity: Math.round(avgComplexity * 10) / 10,
        maxComplexity,
        issues: fileIssues,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Extract and analyze JavaScript/TypeScript functions
 */
function extractJSFunctions(content: string, file: string): FunctionComplexity[] {
  const functions: FunctionComplexity[] = [];
  const lines = content.split('\n');

  // Match function declarations, arrow functions, methods
  const funcPatterns = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g,
    /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*\w+)?\s*=>/g,
    /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?function\s*\(([^)]*)\)/g,
    /(\w+)\s*\(([^)]*)\)\s*(?::\s*\w+)?\s*\{/g, // class methods
  ];

  for (const pattern of funcPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      const params = match[2];
      const startIndex = match.index;
      const lineNum = content.slice(0, startIndex).split('\n').length;

      // Find function body
      const bodyStart = content.indexOf('{', startIndex);
      if (bodyStart === -1) continue;

      const body = extractBracedBlock(content, bodyStart);
      if (!body) continue;

      const metrics = calculateMetrics(body, params);
      const issues = getIssues(metrics, name);
      const severity = getSeverity(metrics);

      functions.push({
        file,
        name,
        line: lineNum,
        metrics,
        issues,
        severity,
      });
    }
  }

  return functions;
}

/**
 * Extract Python functions
 */
function extractPythonFunctions(content: string, file: string): FunctionComplexity[] {
  const functions: FunctionComplexity[] = [];
  const lines = content.split('\n');

  const funcPattern = /^(\s*)def\s+(\w+)\s*\(([^)]*)\)/gm;
  let match;

  while ((match = funcPattern.exec(content)) !== null) {
    const indent = match[1].length;
    const name = match[2];
    const params = match[3];
    const startIndex = match.index;
    const lineNum = content.slice(0, startIndex).split('\n').length;

    // Find function body (indented block)
    const bodyLines: string[] = [];
    for (let i = lineNum; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') {
        bodyLines.push(line);
        continue;
      }
      const lineIndent = line.match(/^(\s*)/)?.[1].length ?? 0;
      if (lineIndent <= indent && line.trim() !== '') break;
      bodyLines.push(line);
    }

    const body = bodyLines.join('\n');
    const metrics = calculateMetrics(body, params);
    const issues = getIssues(metrics, name);
    const severity = getSeverity(metrics);

    functions.push({
      file,
      name,
      line: lineNum,
      metrics,
      issues,
      severity,
    });
  }

  return functions;
}

/**
 * Extract Go functions
 */
function extractGoFunctions(content: string, file: string): FunctionComplexity[] {
  const functions: FunctionComplexity[] = [];

  const funcPattern = /func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(([^)]*)\)/g;
  let match;

  while ((match = funcPattern.exec(content)) !== null) {
    const name = match[1];
    const params = match[2];
    const startIndex = match.index;
    const lineNum = content.slice(0, startIndex).split('\n').length;

    const bodyStart = content.indexOf('{', startIndex);
    if (bodyStart === -1) continue;

    const body = extractBracedBlock(content, bodyStart);
    if (!body) continue;

    const metrics = calculateMetrics(body, params);
    const issues = getIssues(metrics, name);
    const severity = getSeverity(metrics);

    functions.push({
      file,
      name,
      line: lineNum,
      metrics,
      issues,
      severity,
    });
  }

  return functions;
}

/**
 * Extract Rust functions
 */
function extractRustFunctions(content: string, file: string): FunctionComplexity[] {
  const functions: FunctionComplexity[] = [];

  const funcPattern = /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g;
  let match;

  while ((match = funcPattern.exec(content)) !== null) {
    const name = match[1];
    const params = match[2];
    const startIndex = match.index;
    const lineNum = content.slice(0, startIndex).split('\n').length;

    const bodyStart = content.indexOf('{', startIndex);
    if (bodyStart === -1) continue;

    const body = extractBracedBlock(content, bodyStart);
    if (!body) continue;

    const metrics = calculateMetrics(body, params);
    const issues = getIssues(metrics, name);
    const severity = getSeverity(metrics);

    functions.push({
      file,
      name,
      line: lineNum,
      metrics,
      issues,
      severity,
    });
  }

  return functions;
}

/**
 * Extract a braced block from content starting at openBrace index
 */
function extractBracedBlock(content: string, openBrace: number): string | null {
  let depth = 0;
  let i = openBrace;

  while (i < content.length) {
    if (content[i] === '{') depth++;
    if (content[i] === '}') depth--;
    if (depth === 0) {
      return content.slice(openBrace, i + 1);
    }
    i++;
  }

  return null;
}

/**
 * Calculate complexity metrics for a function body
 */
function calculateMetrics(body: string, params: string): FunctionComplexity['metrics'] {
  const lines = body.split('\n').filter(l => l.trim() !== '');

  // Cyclomatic complexity: count decision points
  const decisionPatterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bcase\s+/g,
    /\bcatch\s*\(/g,
    /\?\s*[^:]/g, // ternary
    /&&/g,
    /\|\|/g,
  ];

  let cyclomaticComplexity = 1; // Base complexity
  for (const pattern of decisionPatterns) {
    const matches = body.match(pattern);
    if (matches) cyclomaticComplexity += matches.length;
  }

  // Nesting depth: count max indent level
  let maxNesting = 0;
  let currentNesting = 0;
  for (const char of body) {
    if (char === '{') {
      currentNesting++;
      maxNesting = Math.max(maxNesting, currentNesting);
    } else if (char === '}') {
      currentNesting--;
    }
  }

  // Parameter count
  const parameterCount = params.trim() === '' ? 0 : params.split(',').length;

  return {
    cyclomaticComplexity,
    nestingDepth: maxNesting,
    lineCount: lines.length,
    parameterCount,
  };
}

/**
 * Generate issues based on metrics
 */
function getIssues(metrics: FunctionComplexity['metrics'], name: string): string[] {
  const issues: string[] = [];

  if (metrics.cyclomaticComplexity >= THRESHOLDS.cyclomaticComplexity.high) {
    issues.push(`High cyclomatic complexity (${metrics.cyclomaticComplexity}) - extract helper functions`);
  }

  if (metrics.nestingDepth >= THRESHOLDS.nestingDepth.high) {
    issues.push(`Deep nesting (${metrics.nestingDepth} levels) - use early returns or guard clauses`);
  }

  if (metrics.lineCount >= THRESHOLDS.lineCount.high) {
    issues.push(`Long function (${metrics.lineCount} lines) - split into smaller functions`);
  }

  if (metrics.parameterCount >= THRESHOLDS.parameterCount.high) {
    issues.push(`Too many parameters (${metrics.parameterCount}) - use options object`);
  }

  return issues;
}

/**
 * Determine severity based on metrics
 */
function getSeverity(metrics: FunctionComplexity['metrics']): FunctionComplexity['severity'] {
  const { cyclomaticComplexity, nestingDepth, lineCount } = metrics;

  if (
    cyclomaticComplexity >= THRESHOLDS.cyclomaticComplexity.critical ||
    nestingDepth >= THRESHOLDS.nestingDepth.critical ||
    lineCount >= THRESHOLDS.lineCount.critical
  ) {
    return 'critical';
  }

  if (
    cyclomaticComplexity >= THRESHOLDS.cyclomaticComplexity.high ||
    nestingDepth >= THRESHOLDS.nestingDepth.high ||
    lineCount >= THRESHOLDS.lineCount.high
  ) {
    return 'high';
  }

  if (
    cyclomaticComplexity >= THRESHOLDS.cyclomaticComplexity.medium ||
    nestingDepth >= THRESHOLDS.nestingDepth.medium ||
    lineCount >= THRESHOLDS.lineCount.medium
  ) {
    return 'medium';
  }

  return 'low';
}

// ============================================================================
// SIMPLIFY ANALYSIS
// ============================================================================

/**
 * Analyze code for simplification opportunities
 */
export function analyzeSimplify(input: SimplifyInput): SimplifyReport {
  const projectPath = sanitizePath(input.projectPath);
  const targetFile = input.file;

  // If specific file, analyze it
  if (targetFile) {
    const fullPath = targetFile.startsWith('/') ? targetFile : join(projectPath, targetFile);
    return analyzeFileForSimplification(fullPath, projectPath);
  }

  // Otherwise find the most complex file
  const complexity = analyzeComplexity({ projectPath, threshold: 1, limit: 100 });
  if (complexity.hotspots.length === 0) {
    return {
      file: '',
      issues: [],
      suggestedPrompt: 'No simplification opportunities found. Codebase is clean!',
      estimatedImprovement: 'N/A',
    };
  }

  // Find file with most issues
  const fileIssues = new Map<string, number>();
  for (const hotspot of complexity.hotspots) {
    const count = fileIssues.get(hotspot.file) ?? 0;
    fileIssues.set(hotspot.file, count + hotspot.issues.length);
  }

  const topFile = [...fileIssues.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!topFile) {
    return {
      file: '',
      issues: [],
      suggestedPrompt: 'No simplification opportunities found.',
      estimatedImprovement: 'N/A',
    };
  }

  const fullPath = join(projectPath, topFile);
  return analyzeFileForSimplification(fullPath, projectPath);
}

/**
 * Analyze a specific file for simplification
 */
function analyzeFileForSimplification(filePath: string, projectPath: string): SimplifyReport {
  if (!existsSync(filePath)) {
    return {
      file: filePath,
      issues: [],
      suggestedPrompt: `File not found: ${filePath}`,
      estimatedImprovement: 'N/A',
    };
  }

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relativePath = relative(projectPath, filePath);
  const issues: SimplifyIssue[] = [];

  // 1. Check for deep nesting
  let maxNesting = 0;
  let currentNesting = 0;
  let deepNestingLines: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    currentNesting += opens - closes;

    if (currentNesting > 3) {
      deepNestingLines.push(i + 1);
    }
    maxNesting = Math.max(maxNesting, currentNesting);
  }

  if (deepNestingLines.length > 0) {
    issues.push({
      type: 'nesting',
      location: `lines ${deepNestingLines.slice(0, 5).join(', ')}${deepNestingLines.length > 5 ? '...' : ''}`,
      line: deepNestingLines[0],
      description: `${deepNestingLines.length} locations with >3 levels of nesting`,
      suggestion: 'Use early returns, extract helper functions, or flatten conditionals',
      priority: deepNestingLines.length > 10 ? 'high' : 'medium',
    });
  }

  // 2. Check for long functions (already covered by complexity, but add specific lines)
  const longFunctionPattern = /(?:function\s+\w+|const\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>)\s*\{/g;
  let match;
  while ((match = longFunctionPattern.exec(content)) !== null) {
    const startLine = content.slice(0, match.index).split('\n').length;
    const bodyStart = content.indexOf('{', match.index);
    const body = extractBracedBlock(content, bodyStart);
    if (body && body.split('\n').length > 50) {
      issues.push({
        type: 'length',
        location: `line ${startLine}`,
        line: startLine,
        description: `Function spans ${body.split('\n').length} lines`,
        suggestion: 'Break into smaller, focused functions with single responsibilities',
        priority: 'high',
      });
    }
  }

  // 3. Check for repeated patterns (simple duplication)
  const lineHashes = new Map<string, number[]>();
  for (let i = 0; i < lines.length; i++) {
    const normalized = lines[i].trim().replace(/\s+/g, ' ');
    if (normalized.length > 30) { // Only check substantial lines
      const existing = lineHashes.get(normalized) || [];
      existing.push(i + 1);
      lineHashes.set(normalized, existing);
    }
  }

  const duplicates = [...lineHashes.entries()].filter(([_, lns]) => lns.length >= 3);
  if (duplicates.length > 0) {
    issues.push({
      type: 'duplication',
      location: `${duplicates.length} patterns repeated 3+ times`,
      line: duplicates[0][1][0],
      description: 'Repeated code patterns detected',
      suggestion: 'Extract repeated logic into reusable functions',
      priority: 'medium',
    });
  }

  // 4. Check for potential dead code (commented out code blocks)
  const commentedCodePattern = /\/\/.*(?:function|const|let|var|if|for|while|return)/g;
  const commentedMatches = content.match(commentedCodePattern);
  if (commentedMatches && commentedMatches.length > 5) {
    issues.push({
      type: 'dead-code',
      location: 'throughout file',
      line: 1,
      description: `${commentedMatches.length} lines of commented-out code`,
      suggestion: 'Remove commented code - use git history instead',
      priority: 'low',
    });
  }

  // 5. Check for overly abstract patterns (too many small functions)
  const functionCount = (content.match(/(?:function\s+\w+|const\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>)/g) || []).length;
  const avgLinesPerFunction = lines.length / Math.max(functionCount, 1);

  if (avgLinesPerFunction < 5 && functionCount > 20) {
    issues.push({
      type: 'abstraction',
      location: 'file-wide',
      line: 1,
      description: `${functionCount} functions averaging ${Math.round(avgLinesPerFunction)} lines - may be over-abstracted`,
      suggestion: 'Consider inlining trivial one-liner functions',
      priority: 'low',
    });
  }

  // Generate prompt
  const highPriority = issues.filter(i => i.priority === 'high');
  let suggestedPrompt = 'No major simplification opportunities found.';

  if (highPriority.length > 0) {
    const top = highPriority[0];
    suggestedPrompt = `Simplify ${relativePath}: ${top.description}. ${top.suggestion}.`;
  } else if (issues.length > 0) {
    const top = issues[0];
    suggestedPrompt = `Minor cleanup in ${relativePath}: ${top.description}. ${top.suggestion}.`;
  }

  // Estimate improvement
  const estimatedImprovement = issues.length === 0 ? 'Already clean'
    : highPriority.length >= 3 ? 'Could reduce 30-50% of complexity'
    : highPriority.length >= 1 ? 'Could reduce 10-30% of complexity'
    : 'Minor improvements possible';

  return {
    file: relativePath,
    issues,
    suggestedPrompt,
    estimatedImprovement,
  };
}
