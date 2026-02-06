import { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadState, saveState } from '../state/phase.js';

export const checkDocsSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
});

export type CheckDocsInput = z.infer<typeof checkDocsSchema>;

interface DocStatus {
  exists: boolean;
  complete: boolean;
  issues: string[];
}

interface CheckDocsResult {
  prd: DocStatus;
  gameplan: DocStatus;
  ready: boolean;
}

function checkDocComplete(filePath: string, requiredSections: string[]): DocStatus {
  if (!existsSync(filePath)) {
    return {
      exists: false,
      complete: false,
      issues: ['File does not exist'],
    };
  }

  const content = readFileSync(filePath, 'utf-8');
  const issues: string[] = [];

  // Check for template placeholders
  if (content.includes('[') && content.includes(']')) {
    const placeholderMatches = content.match(/\[[^\]]+\]/g) || [];
    const realPlaceholders = placeholderMatches.filter(p => 
      !p.startsWith('[x]') && !p.startsWith('[ ]') // Exclude checkboxes
    );
    if (realPlaceholders.length > 0) {
      issues.push(`Contains ${realPlaceholders.length} unfilled placeholders`);
    }
  }

  // Check for required sections
  for (const section of requiredSections) {
    if (!content.toLowerCase().includes(section.toLowerCase())) {
      issues.push(`Missing section: ${section}`);
    }
  }

  // Check minimum content length
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  if (lines.length < 5) {
    issues.push('Too short - needs more content');
  }

  return {
    exists: true,
    complete: issues.length === 0,
    issues,
  };
}

export function checkDocs(input: CheckDocsInput): CheckDocsResult {
  const projectPath = input.projectPath || process.cwd();
  const docsPath = join(projectPath, 'docs');

  const prd = checkDocComplete(
    join(docsPath, 'prd.md'),
    ['overview', 'goals', 'non-goals']
  );

  const gameplan = checkDocComplete(
    join(docsPath, 'gameplan.md'),
    ['tech stack', 'architecture', 'phase']
  );

  const ready = prd.complete && gameplan.complete;

  // Update state docs tracking
  const state = loadState(projectPath);
  state.docs = {
    prd: prd.complete,
    gameplan: gameplan.complete,
  };
  saveState(projectPath, state);

  return {
    prd,
    gameplan,
    ready,
  };
}
