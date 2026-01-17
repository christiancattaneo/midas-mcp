/**
 * Gameplan Progress Tool
 * 
 * MCP tool for tracking progress through the gameplan.
 */

import { z } from 'zod';
import { sanitizePath } from '../security.js';
import { 
  analyzeGameplan, 
  getGameplanProgress, 
  validateGameplanProgress,
  type GameplanAnalysis 
} from '../gameplan-tracker.js';

// ============================================================================
// SCHEMAS
// ============================================================================

export const analyzeGameplanSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
});

export type AnalyzeGameplanInput = z.infer<typeof analyzeGameplanSchema>;

export const getProgressSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
});

export type GetProgressInput = z.infer<typeof getProgressSchema>;

// ============================================================================
// TOOL HANDLERS
// ============================================================================

export interface GameplanToolResult {
  analysis: GameplanAnalysis;
  progress: {
    documented: string;
    actual: string;
    match: boolean;
  };
  nextTask?: {
    text: string;
    phase?: string;
    priority?: string;
  };
  warnings: string[];
  recommendations: string[];
}

export function analyzeGameplanTool(input: AnalyzeGameplanInput): GameplanToolResult {
  const projectPath = sanitizePath(input.projectPath);
  const analysis = analyzeGameplan(projectPath);
  const validation = validateGameplanProgress(projectPath);
  
  const recommendations: string[] = [];
  
  // Generate recommendations based on analysis
  if (analysis.totalTasks === 0) {
    recommendations.push('Add tasks to gameplan using: - [ ] Task description');
  }
  
  if (analysis.nextTask) {
    recommendations.push(`Next suggested task: "${analysis.nextTask.text}"`);
  }
  
  if (analysis.missingImplementation.length > 0) {
    recommendations.push('Some tasks are marked complete but have no implementation - verify these');
  }
  
  if (analysis.scopeCreep.length > 0) {
    recommendations.push('Some code may not be covered by gameplan - consider adding tasks');
  }
  
  return {
    analysis,
    progress: {
      documented: `${analysis.documentProgress}%`,
      actual: `${analysis.actualProgress}%`,
      match: analysis.progressMatch,
    },
    nextTask: analysis.nextTask ? {
      text: analysis.nextTask.text,
      phase: analysis.nextTask.phase,
      priority: analysis.nextTask.priority,
    } : undefined,
    warnings: validation.warnings,
    recommendations: [...recommendations, ...validation.suggestions],
  };
}

export function getGameplanProgressTool(input: GetProgressInput): {
  progress: {
    documented: number;
    actual: number;
    discrepancy: boolean;
    nextSuggested?: string;
  };
  status: string;
} {
  const projectPath = sanitizePath(input.projectPath);
  const progress = getGameplanProgress(projectPath);
  
  let status: string;
  if (progress.documented === 0 && progress.actual === 0) {
    status = 'No progress tracked - add tasks to gameplan';
  } else if (progress.discrepancy) {
    status = `Progress mismatch: ${progress.documented}% marked, ${progress.actual}% implemented`;
  } else if (progress.actual >= 100) {
    status = 'All tasks implemented!';
  } else if (progress.actual >= 75) {
    status = 'Almost done - finishing up';
  } else if (progress.actual >= 50) {
    status = 'Halfway through implementation';
  } else if (progress.actual >= 25) {
    status = 'Making progress';
  } else {
    status = 'Just getting started';
  }
  
  return { progress, status };
}
