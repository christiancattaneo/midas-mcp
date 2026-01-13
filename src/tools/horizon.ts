import { z } from 'zod';

export const horizonSchema = z.object({
  currentOutput: z.string().describe('What the AI produced that does not fit'),
  expectedOutput: z.string().describe('What you actually needed'),
});

export type HorizonInput = z.infer<typeof horizonSchema>;

interface HorizonResult {
  missingContext: string[];
  expandedPrompt: string;
  checklist: string[];
}

export function expandHorizon(input: HorizonInput): HorizonResult {
  // The checklist of horizontal context categories
  const checklist = [
    'INTEGRATIONS - What existing systems does this connect to?',
    'PATTERNS - What patterns or conventions should be followed?',
    'CONSTRAINTS - What limitations or restrictions apply?',
    'HISTORY - Why were previous decisions made?',
    'FUTURE - What planned features must be supported later?',
    'DOMAIN - What domain-specific knowledge is needed?',
  ];

  // Analyze the gap to suggest missing context
  const missingContext: string[] = [];
  
  // Simple heuristics based on common gaps
  if (input.currentOutput.includes('generic') || input.expectedOutput.includes('specific')) {
    missingContext.push('Missing specific patterns or conventions to follow');
  }
  if (input.currentOutput.includes('new') || input.expectedOutput.includes('existing')) {
    missingContext.push('Missing integration context with existing code');
  }
  if (input.expectedOutput.includes('because') || input.expectedOutput.includes('reason')) {
    missingContext.push('Missing historical context for past decisions');
  }
  
  // Always suggest the full checklist review
  if (missingContext.length === 0) {
    missingContext.push('Review the horizontal context checklist to identify gaps');
  }

  const expandedPrompt = `The output doesn't match what I need.

**Current output:** ${input.currentOutput}

**Expected output:** ${input.expectedOutput}

---

HORIZONTAL CONTEXT (what was missing):

**Integrations:**
- [What existing systems this connects to]
- [What services/APIs are already in use]

**Patterns:**
- [File/folder conventions in this codebase]
- [Naming conventions to follow]
- [Similar implementations to reference: @filename]

**Constraints:**
- [Technical limitations]
- [Budget/resource constraints]
- [Dependencies that cannot be changed]

**History:**
- [Why we use X instead of Y]
- [Previous attempts and why they failed]

**Future:**
- [Planned features that this must support]
- [Extensibility requirements]

**Domain:**
- [Industry-specific requirements]
- [User behavior patterns]

Please regenerate with this additional context.`;

  return {
    missingContext,
    expandedPrompt,
    checklist,
  };
}
