import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSessionPrompts } from './session.js';
import { registerDevelopmentPrompts } from './development.js';
import { registerReviewPrompts } from './review.js';
import { registerResearchPrompts } from './research.js';
import { registerShipPrompts } from './ship.js';
import { registerGrowPrompts } from './grow.js';

export function registerAllPrompts(server: McpServer): void {
  // Plan & Build prompts
  registerSessionPrompts(server);
  registerDevelopmentPrompts(server);
  registerReviewPrompts(server);
  registerResearchPrompts(server);
  
  // Ship prompts
  registerShipPrompts(server);
  
  // Grow prompts
  registerGrowPrompts(server);
}
