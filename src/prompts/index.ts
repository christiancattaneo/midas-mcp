import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSessionPrompts } from './session.js';
import { registerDevelopmentPrompts } from './development.js';
import { registerReviewPrompts } from './review.js';
import { registerResearchPrompts } from './research.js';

export function registerAllPrompts(server: McpServer): void {
  registerSessionPrompts(server);
  registerDevelopmentPrompts(server);
  registerReviewPrompts(server);
  registerResearchPrompts(server);
}
