import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerSessionPrompts(server: McpServer): void {
  // Master prompt - session initialization
  server.prompt(
    'master_prompt',
    'Initialize a development session with full context loading and planning',
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `# Read and understand user rules, research each for complete understanding

# Ask me any clarifying questions (hallucination avoidance)

# Make todos of all tasks, use high IQ strategy for safety and correctness as you create and order each, add todos for testing of all code changes and additions, research documentation and best practices online, don't start yet`,
          },
        },
      ],
    })
  );

  // Execution prompt - start building
  server.prompt(
    'execution_prompt',
    'Start building with TDD approach after planning is complete',
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `# Continue todos, do each comprehensively and in highest IQ way possible

# Build test and write AND run test scripts then fix and repeat process of writing tests and running them until all tests pass

# Short commit message once individual todos are complete and proceed`,
          },
        },
      ],
    })
  );
}
