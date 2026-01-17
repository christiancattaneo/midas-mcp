/**
 * Gameplan Tracker
 * 
 * Intelligently tracks progress through the gameplan by:
 * 1. Parsing tasks from gameplan.md (checkbox items)
 * 2. Cross-referencing tasks against actual code
 * 3. Detecting what's done vs what's missing
 * 4. Detecting scope creep (code not in plan)
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { sanitizePath } from './security.js';
import { discoverDocsSync } from './docs-discovery.js';
import { discoverSourceFiles } from './code-discovery.js';
import { logger } from './logger.js';

// ============================================================================
// TYPES
// ============================================================================

export interface GameplanTask {
  id: string;              // Unique ID (hash of text)
  text: string;            // The task text
  completed: boolean;      // Is the checkbox checked?
  phase?: string;          // Which phase this belongs to (if detected)
  priority?: 'high' | 'medium' | 'low';
  
  // Code correlation
  relatedFiles?: string[]; // Files that seem to implement this
  confidence: number;      // 0-100, how confident we are this is implemented
  implementationStatus: 'not_started' | 'partial' | 'complete' | 'unknown';
}

export interface GameplanAnalysis {
  // Raw parsing
  totalTasks: number;
  completedTasks: number;         // Checked in document
  implementedTasks: number;       // Actually found in code
  
  // Task list
  tasks: GameplanTask[];
  
  // Progress
  documentProgress: number;       // % checked in doc
  actualProgress: number;         // % implemented in code
  progressMatch: boolean;         // Do they agree?
  
  // Gaps
  missingImplementation: GameplanTask[];  // Checked but no code found
  scopeCreep: string[];                   // Code not mentioned in gameplan
  
  // Summary
  summary: string;
  nextTask?: GameplanTask;        // Suggested next task
}

// ============================================================================
// TASK PARSING
// ============================================================================

/**
 * Parse tasks from gameplan content.
 * Supports multiple formats:
 * - [ ] Task description
 * - [x] Completed task
 * - 1. Task description (numbered)
 * - - Task description (bullet)
 */
export function parseGameplanTasks(content: string): GameplanTask[] {
  const tasks: GameplanTask[] = [];
  const lines = content.split('\n');
  
  let currentPhase: string | undefined;
  
  for (const line of lines) {
    // Detect phase headers (## Phase 1: Setup, ### Implementation, etc.)
    const phaseMatch = line.match(/^#{1,4}\s*(?:Phase\s*\d+[:\s]*)?(.+)/i);
    if (phaseMatch) {
      currentPhase = phaseMatch[1].trim();
      continue;
    }
    
    // Checkbox tasks: - [ ] or - [x] or * [ ] or * [x]
    const checkboxMatch = line.match(/^[\s]*[-*]\s*\[([ xX])\]\s*(.+)/);
    if (checkboxMatch) {
      const completed = checkboxMatch[1].toLowerCase() === 'x';
      const text = checkboxMatch[2].trim();
      
      tasks.push({
        id: generateTaskId(text),
        text,
        completed,
        phase: currentPhase,
        priority: inferPriority(text),
        confidence: 0,
        implementationStatus: 'unknown',
      });
      continue;
    }
    
    // Numbered tasks: 1. Task or 1) Task
    const numberedMatch = line.match(/^[\s]*\d+[.)]\s+(.+)/);
    if (numberedMatch && !line.includes('[')) {
      const text = numberedMatch[1].trim();
      
      // Skip if it looks like a header or section
      if (text.length < 5 || text.endsWith(':')) continue;
      
      tasks.push({
        id: generateTaskId(text),
        text,
        completed: false,  // No way to mark numbered items as done
        phase: currentPhase,
        priority: inferPriority(text),
        confidence: 0,
        implementationStatus: 'unknown',
      });
    }
  }
  
  return tasks;
}

function generateTaskId(text: string): string {
  // Simple hash for stable IDs
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function inferPriority(text: string): 'high' | 'medium' | 'low' {
  const lower = text.toLowerCase();
  if (lower.includes('critical') || lower.includes('must') || lower.includes('p0') || lower.includes('blocker')) {
    return 'high';
  }
  if (lower.includes('nice to have') || lower.includes('optional') || lower.includes('p2') || lower.includes('later')) {
    return 'low';
  }
  return 'medium';
}

// ============================================================================
// CODE CORRELATION
// ============================================================================

/**
 * Extract keywords from a task for code matching
 */
function extractKeywords(text: string): string[] {
  // Remove common words, keep meaningful terms
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
    'implement', 'add', 'create', 'build', 'setup', 'configure', 'write',
    'make', 'update', 'fix', 'refactor', 'should', 'must', 'will', 'can',
  ]);
  
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  
  return [...new Set(words)];
}

/**
 * Score how well a file matches a task
 */
function scoreFileMatch(filePath: string, fileContent: string, keywords: string[]): number {
  let score = 0;
  const lowerPath = filePath.toLowerCase();
  const lowerContent = fileContent.toLowerCase();
  
  for (const keyword of keywords) {
    // File path contains keyword (strong signal)
    if (lowerPath.includes(keyword)) {
      score += 30;
    }
    
    // File content contains keyword
    if (lowerContent.includes(keyword)) {
      score += 10;
    }
    
    // Function/class name matches (very strong)
    const funcPattern = new RegExp(`(function|class|const|let|var)\\s+\\w*${keyword}\\w*`, 'i');
    if (funcPattern.test(lowerContent)) {
      score += 40;
    }
  }
  
  // Normalize to 0-100
  return Math.min(100, score);
}

/**
 * Find files that might implement a task
 */
function findRelatedFiles(
  task: GameplanTask,
  sourceFiles: { path: string; content?: string }[]
): { files: string[]; confidence: number } {
  const keywords = extractKeywords(task.text);
  if (keywords.length === 0) {
    return { files: [], confidence: 0 };
  }
  
  const matches: Array<{ path: string; score: number }> = [];
  
  for (const file of sourceFiles) {
    if (!file.content) continue;
    
    const score = scoreFileMatch(file.path, file.content, keywords);
    if (score > 20) {
      matches.push({ path: file.path, score });
    }
  }
  
  // Sort by score, take top 3
  matches.sort((a, b) => b.score - a.score);
  const topMatches = matches.slice(0, 3);
  
  const avgScore = topMatches.length > 0
    ? topMatches.reduce((sum, m) => sum + m.score, 0) / topMatches.length
    : 0;
  
  return {
    files: topMatches.map(m => m.path),
    confidence: Math.round(avgScore),
  };
}

// ============================================================================
// MAIN ANALYSIS
// ============================================================================

/**
 * Analyze gameplan and cross-reference with codebase
 */
export function analyzeGameplan(projectPath: string): GameplanAnalysis {
  const safePath = sanitizePath(projectPath);
  
  // Find gameplan document
  const docsResult = discoverDocsSync(safePath);
  const gameplanDoc = docsResult.gameplan;
  
  if (!gameplanDoc) {
    return {
      totalTasks: 0,
      completedTasks: 0,
      implementedTasks: 0,
      tasks: [],
      documentProgress: 0,
      actualProgress: 0,
      progressMatch: true,
      missingImplementation: [],
      scopeCreep: [],
      summary: 'No gameplan document found',
    };
  }
  
  // Parse tasks from gameplan
  const tasks = parseGameplanTasks(gameplanDoc.content);
  
  if (tasks.length === 0) {
    return {
      totalTasks: 0,
      completedTasks: 0,
      implementedTasks: 0,
      tasks: [],
      documentProgress: 0,
      actualProgress: 0,
      progressMatch: true,
      missingImplementation: [],
      scopeCreep: [],
      summary: 'Gameplan exists but no tasks found. Use checkbox format: - [ ] Task',
    };
  }
  
  // Get source files for correlation
  const sourceFiles = discoverSourceFiles(safePath);
  const filesWithContent = sourceFiles.map(f => ({
    path: f.path,
    content: f.content,
  }));
  
  // Correlate tasks with code
  let implementedCount = 0;
  const missingImplementation: GameplanTask[] = [];
  
  for (const task of tasks) {
    const { files, confidence } = findRelatedFiles(task, filesWithContent);
    task.relatedFiles = files;
    task.confidence = confidence;
    
    // Determine implementation status
    if (confidence >= 60) {
      task.implementationStatus = 'complete';
      implementedCount++;
    } else if (confidence >= 30) {
      task.implementationStatus = 'partial';
      implementedCount += 0.5;  // Count partial as half
    } else {
      task.implementationStatus = 'not_started';
      
      // If marked complete in doc but no code found, flag it
      if (task.completed) {
        missingImplementation.push(task);
      }
    }
  }
  
  // Detect scope creep - files that don't match any task
  const allTaskKeywords = tasks.flatMap(t => extractKeywords(t.text));
  const scopeCreep: string[] = [];
  
  for (const file of sourceFiles) {
    // Skip test and config files
    if (file.path.includes('.test.') || file.path.includes('.spec.') || 
        file.path.includes('config') || file.path.includes('.json')) {
      continue;
    }
    
    // Check if any task keyword matches
    const lowerPath = file.path.toLowerCase();
    const lowerContent = (file.content || '').toLowerCase();
    
    const matchesAnyTask = allTaskKeywords.some(kw => 
      lowerPath.includes(kw) || lowerContent.includes(kw)
    );
    
    if (!matchesAnyTask) {
      scopeCreep.push(file.path);
    }
  }
  
  // Calculate progress
  const completedTasks = tasks.filter(t => t.completed).length;
  const documentProgress = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0;
  const actualProgress = tasks.length > 0 ? Math.round((implementedCount / tasks.length) * 100) : 0;
  
  // Find next task to work on
  const nextTask = tasks.find(t => 
    !t.completed && 
    t.implementationStatus === 'not_started' &&
    t.priority !== 'low'
  );
  
  // Build summary
  let summary = `${completedTasks}/${tasks.length} tasks marked complete. `;
  summary += `${Math.round(implementedCount)}/${tasks.length} actually implemented. `;
  
  if (missingImplementation.length > 0) {
    summary += `⚠️ ${missingImplementation.length} tasks marked done but no code found. `;
  }
  if (scopeCreep.length > 0 && scopeCreep.length < 10) {
    summary += `⚠️ ${scopeCreep.length} files not in gameplan (scope creep?). `;
  }
  
  return {
    totalTasks: tasks.length,
    completedTasks,
    implementedTasks: Math.round(implementedCount),
    tasks,
    documentProgress,
    actualProgress,
    progressMatch: Math.abs(documentProgress - actualProgress) < 20,
    missingImplementation,
    scopeCreep: scopeCreep.slice(0, 10),  // Limit to avoid noise
    summary,
    nextTask,
  };
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Get a simple progress summary
 */
export function getGameplanProgress(projectPath: string): {
  documented: number;
  actual: number;
  discrepancy: boolean;
  nextSuggested?: string;
} {
  const analysis = analyzeGameplan(projectPath);
  return {
    documented: analysis.documentProgress,
    actual: analysis.actualProgress,
    discrepancy: !analysis.progressMatch,
    nextSuggested: analysis.nextTask?.text,
  };
}

/**
 * Check if gameplan tasks align with code
 */
export function validateGameplanProgress(projectPath: string): {
  valid: boolean;
  warnings: string[];
  suggestions: string[];
} {
  const analysis = analyzeGameplan(projectPath);
  const warnings: string[] = [];
  const suggestions: string[] = [];
  
  if (analysis.totalTasks === 0) {
    warnings.push('No tasks found in gameplan');
    suggestions.push('Add tasks using checkbox format: - [ ] Task description');
    return { valid: false, warnings, suggestions };
  }
  
  if (analysis.missingImplementation.length > 0) {
    warnings.push(`${analysis.missingImplementation.length} tasks marked done but no implementation found`);
    for (const task of analysis.missingImplementation.slice(0, 3)) {
      suggestions.push(`Review: "${task.text.slice(0, 50)}..."`);
    }
  }
  
  if (analysis.scopeCreep.length > 5) {
    warnings.push(`${analysis.scopeCreep.length} source files not mentioned in gameplan`);
    suggestions.push('Consider updating gameplan to include new features');
  }
  
  if (!analysis.progressMatch) {
    warnings.push(`Progress mismatch: ${analysis.documentProgress}% marked done, ${analysis.actualProgress}% implemented`);
    suggestions.push('Update checkbox status in gameplan to match reality');
  }
  
  return {
    valid: warnings.length === 0,
    warnings,
    suggestions,
  };
}
