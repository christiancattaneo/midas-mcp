import { z } from 'zod';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { execSync } from 'child_process';
import { sanitizePath, isShellSafe } from '../security.js';
import { logEvent } from '../events.js';

// ============================================================================
// Tech Debt Cleanup Mode - Systematic refactoring without feature building
// ============================================================================

export interface DebtItem {
  file: string;
  line: number;
  type: 'TODO' | 'FIXME' | 'HACK' | 'XXX' | 'BUG';
  text: string;
  priority: number;  // Based on code churn
}

export interface CleanupAnalysis {
  totalDebtItems: number;
  debtByType: Record<string, number>;
  topFiles: Array<{ file: string; churn: number; debtCount: number }>;
  items: DebtItem[];
  suggestedPrompt: string;
}

// ============================================================================
// Scan for tech debt markers
// ============================================================================

export const scanDebtSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  limit: z.number().optional().describe('Max items to return (default 20)'),
});

export type ScanDebtInput = z.infer<typeof scanDebtSchema>;

const DEBT_PATTERNS = [
  { pattern: /\/\/\s*(TODO|FIXME|HACK|XXX|BUG):?\s*(.*)$/i, type: 'comment' },
  { pattern: /#\s*(TODO|FIXME|HACK|XXX|BUG):?\s*(.*)$/i, type: 'hash' },
];

const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.midas', 'coverage'];
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.rb'];

/**
 * Scan codebase for TODO/FIXME/HACK comments
 */
export function scanDebt(input: ScanDebtInput): CleanupAnalysis {
  const projectPath = sanitizePath(input.projectPath);
  const limit = input.limit || 20;
  
  const items: DebtItem[] = [];
  const fileChurn = getFileChurn(projectPath);
  
  function scanDir(dir: string, depth = 0): void {
    if (depth > 10) return;
    
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (IGNORE_DIRS.includes(entry)) continue;
        
        const fullPath = join(dir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            scanDir(fullPath, depth + 1);
          } else if (stat.isFile()) {
            const ext = entry.slice(entry.lastIndexOf('.'));
            if (CODE_EXTENSIONS.includes(ext)) {
              scanFile(fullPath, projectPath, items, fileChurn);
            }
          }
        } catch {}
      }
    } catch {}
  }
  
  scanDir(projectPath);
  
  // Sort by priority (churn-based) and limit
  items.sort((a, b) => b.priority - a.priority);
  const limitedItems = items.slice(0, limit);
  
  // Aggregate stats
  const debtByType: Record<string, number> = {};
  for (const item of items) {
    debtByType[item.type] = (debtByType[item.type] || 0) + 1;
  }
  
  // Top files by debt + churn
  const fileStats = new Map<string, { churn: number; debtCount: number }>();
  for (const item of items) {
    const existing = fileStats.get(item.file) || { churn: item.priority, debtCount: 0 };
    existing.debtCount++;
    fileStats.set(item.file, existing);
  }
  const topFiles = Array.from(fileStats.entries())
    .map(([file, stats]) => ({ file, ...stats }))
    .sort((a, b) => (b.churn * b.debtCount) - (a.churn * a.debtCount))
    .slice(0, 5);
  
  // Generate suggested prompt
  let suggestedPrompt = 'No tech debt found. Codebase is clean!';
  if (limitedItems.length > 0) {
    const topItem = limitedItems[0];
    suggestedPrompt = `Address the ${topItem.type} in ${topItem.file}:${topItem.line}: "${topItem.text.slice(0, 50)}..."`;
  }
  
  logEvent(projectPath, {
    type: 'tool_called',
    tool: 'midas_scan_debt',
    data: { totalItems: items.length },
  });
  
  return {
    totalDebtItems: items.length,
    debtByType,
    topFiles,
    items: limitedItems,
    suggestedPrompt,
  };
}

function scanFile(
  filePath: string,
  projectPath: string,
  items: DebtItem[],
  fileChurn: Map<string, number>
): void {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const relativePath = relative(projectPath, filePath);
    const churn = fileChurn.get(relativePath) || 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { pattern } of DEBT_PATTERNS) {
        const match = line.match(pattern);
        if (match) {
          items.push({
            file: relativePath,
            line: i + 1,
            type: match[1].toUpperCase() as DebtItem['type'],
            text: match[2]?.trim() || '',
            priority: churn,
          });
          break;  // Only one match per line
        }
      }
    }
  } catch {}
}

/**
 * Get file churn (number of commits that touched each file)
 */
function getFileChurn(projectPath: string): Map<string, number> {
  const churn = new Map<string, number>();
  
  if (!existsSync(join(projectPath, '.git'))) return churn;
  if (!isShellSafe(projectPath)) return churn;
  
  try {
    // Get commit counts per file (last 100 commits for performance)
    const output = execSync(
      'git log --name-only --pretty=format: -100 | sort | uniq -c | sort -rn | head -50',
      { cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    
    for (const line of output.split('\n')) {
      const match = line.trim().match(/^\s*(\d+)\s+(.+)$/);
      if (match) {
        churn.set(match[2], parseInt(match[1]));
      }
    }
  } catch {}
  
  return churn;
}

// ============================================================================
// Get cleanup suggestions
// ============================================================================

export const getCleanupSuggestionSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
});

export type GetCleanupSuggestionInput = z.infer<typeof getCleanupSuggestionSchema>;

export interface CleanupSuggestion {
  focus: 'refactor' | 'simplify' | 'document' | 'test';
  target: string;
  reason: string;
  prompt: string;
}

/**
 * Get a cleanup-focused suggestion (refactoring, not feature building)
 */
export function getCleanupSuggestion(input: GetCleanupSuggestionInput): CleanupSuggestion {
  const projectPath = sanitizePath(input.projectPath);
  const debt = scanDebt({ projectPath, limit: 10 });
  
  // If there's debt, suggest addressing it
  if (debt.items.length > 0) {
    const topItem = debt.items[0];
    return {
      focus: 'refactor',
      target: `${topItem.file}:${topItem.line}`,
      reason: `High-churn file with ${topItem.type} marker`,
      prompt: `Refactor ${topItem.file}:${topItem.line} to address: ${topItem.text}. Keep changes minimal and focused.`,
    };
  }
  
  // Otherwise, suggest test coverage or docs
  return {
    focus: 'test',
    target: 'test coverage',
    reason: 'No tech debt markers found',
    prompt: 'Review test coverage. Add tests for any uncovered edge cases in the most complex functions.',
  };
}
