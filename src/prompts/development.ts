import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerDevelopmentPrompts(server: McpServer): void {
  // Feature planning
  server.prompt(
    'feature_planning',
    'Plan a feature before implementing',
    { feature: z.string().describe('The feature to plan') },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `I need to implement: ${args.feature}

1. First, read the relevant files to understand current implementation
2. Research the documentation for any libraries/APIs involved
3. Create a plan with:
   - Files to create/modify
   - Tests to write
   - Edge cases to handle

4. Don't write code yet - just the plan.`,
          },
        },
      ],
    })
  );

  // Feature implementation
  server.prompt(
    'feature_implementation',
    'Implement a feature with TDD',
    { feature: z.string().describe('The feature to implement') },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Now implement: ${args.feature}

Requirements:
- Write the test file FIRST
- Then implement to make tests pass
- Each function should do ONE thing
- No external dependencies unless absolutely necessary
- Add error handling for edge cases

After each file, run the tests.`,
          },
        },
      ],
    })
  );

  // Bug investigation
  server.prompt(
    'bug_investigation',
    'Diagnose a bug before fixing',
    {
      behavior: z.string().describe('What is happening'),
      expected: z.string().describe('What should happen'),
      error: z.string().optional().describe('Error message if any'),
    },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `There's a bug where: ${args.behavior}

Expected: ${args.expected}
${args.error ? `\nError:\n\`\`\`\n${args.error}\n\`\`\`` : ''}

1. Read the relevant files
2. Identify the root cause (not just symptoms)
3. Explain WHY the bug occurs
4. Don't fix yet - just diagnose`,
          },
        },
      ],
    })
  );

  // Bug fix
  server.prompt(
    'bug_fix',
    'Fix a bug with test-first approach',
    { diagnosis: z.string().describe('The diagnosed root cause') },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Now fix the bug.

Diagnosis: ${args.diagnosis}

Requirements:
- Write a test that FAILS with the current bug
- Fix the code to make the test pass
- Verify no other tests broke
- Explain what you changed and why`,
          },
        },
      ],
    })
  );
}
