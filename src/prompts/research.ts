import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerResearchPrompts(server: McpServer): void {
  // Technology comparison
  server.prompt(
    'technology_comparison',
    'Compare technologies for a use case',
    {
      optionA: z.string().describe('First technology option'),
      optionB: z.string().describe('Second technology option'),
      useCase: z.string().describe('What you need it for'),
      requirements: z.string().optional().describe('Specific requirements'),
    },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `I need to choose between ${args.optionA} and ${args.optionB} for ${args.useCase}.

${args.requirements ? `My requirements:\n${args.requirements}\n` : ''}
Compare them on:
1. Learning curve
2. Performance
3. Community/support
4. Cost
5. Integration with existing stack

Give me a recommendation with reasoning.`,
          },
        },
      ],
    })
  );

  // Best practices research
  server.prompt(
    'best_practices',
    'Research current best practices for a topic',
    {
      topic: z.string().describe('Topic to research'),
      stack: z.string().optional().describe('Your tech stack'),
    },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Research current best practices for: ${args.topic}

${args.stack ? `I'm using: ${args.stack}\n` : ''}
I need to know:
1. Industry standard approach
2. Common pitfalls to avoid
3. Security considerations
4. Performance implications
5. Code examples

Cite sources where possible.`,
          },
        },
      ],
    })
  );
}
