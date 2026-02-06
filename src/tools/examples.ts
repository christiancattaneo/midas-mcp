import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Map steps to their example documents
const STEP_EXAMPLES: Record<string, string> = {
  // PLAN phase steps
  PRD: 'prd-example.md',
  GAMEPLAN: 'gameplan-example.md',
  // Other steps use nearest relevant example
  IDEA: 'prd-example.md',
  RESEARCH: 'prd-example.md',
};

export const showExampleSchema = z.object({
  step: z.string().optional().describe('Step to show example for: PRD or GAMEPLAN'),
  projectPath: z.string().optional().describe('Path to project root'),
});

export type ShowExampleInput = z.infer<typeof showExampleSchema>;

export interface ShowExampleResult {
  step: string;
  exampleFile: string;
  content: string;
  summary: string;
}

/**
 * Get the example document for a given step
 */
export function showExample(input: ShowExampleInput): ShowExampleResult {
  const step = (input.step || 'PRD').toUpperCase();
  
  // Find the example file for this step
  const exampleFileName = STEP_EXAMPLES[step] || 'prd-example.md';
  
  // Look for example in docs/examples/
  const docsPath = join(__dirname, '..', 'docs', 'examples', exampleFileName);
  
  if (!existsSync(docsPath)) {
    return {
      step,
      exampleFile: exampleFileName,
      content: `Example file not found: ${exampleFileName}`,
      summary: 'No example available for this step.',
    };
  }
  
  const content = readFileSync(docsPath, 'utf-8');
  
  // Extract first paragraph after the title as summary
  const lines = content.split('\n');
  let summary = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith('#') && !line.startsWith('---')) {
      summary = line.slice(0, 100) + (line.length > 100 ? '...' : '');
      break;
    }
  }
  
  return {
    step,
    exampleFile: exampleFileName,
    content,
    summary: summary || 'Example document for ' + step,
  };
}

/**
 * Get available examples
 */
export function listExamples(): { step: string; file: string }[] {
  return Object.entries(STEP_EXAMPLES).map(([step, file]) => ({
    step,
    file,
  }));
}
