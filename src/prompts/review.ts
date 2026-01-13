import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerReviewPrompts(server: McpServer): void {
  // Security review
  server.prompt(
    'security_review',
    'Review code for security vulnerabilities',
    { target: z.string().describe('File or code to review') },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Review this for security vulnerabilities: ${args.target}

Check specifically for:
- SQL injection
- XSS vulnerabilities
- Authentication bypasses
- Authorization flaws
- Data exposure
- Insecure dependencies
- Hardcoded secrets

For each issue found:
1. Describe the vulnerability
2. Show the vulnerable code
3. Provide the fix`,
          },
        },
      ],
    })
  );

  // Performance review
  server.prompt(
    'performance_review',
    'Review code for performance issues',
    { target: z.string().describe('File or code to review') },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Review this for performance issues: ${args.target}

Check for:
- N+1 queries
- Unnecessary re-renders
- Memory leaks
- Blocking operations
- Missing caching opportunities
- Inefficient algorithms

For each issue:
1. Current complexity (O notation if applicable)
2. Impact on user experience
3. Suggested optimization`,
          },
        },
      ],
    })
  );

  // Safe refactor
  server.prompt(
    'safe_refactor',
    'Safely move or refactor code',
    { description: z.string().describe('What to refactor') },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `SAFE REFACTORING: ${args.description}

Follow this process:
0. Comment out code on original file first
1. Split large classes into smaller, focused class files
2. Copy code verbatim - Don't modify logic when moving to new files
3. Extract logical groups - Move related functions/components together
4. Use proper exports/imports - Maintain all references between files
5. Keep dependencies intact - Ensure imports are accessible to new files
6. Test frequently - Verify functionality after each extraction`,
          },
        },
      ],
    })
  );
}
