#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { runCLI } from './cli.js';
import { runInteractive } from './tui.js';
import { initMonitoring, captureError } from './monitoring.js';

// Initialize monitoring on startup (no-op if not configured)
initMonitoring();

async function startMCPServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Midas MCP server running');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const result = runCLI(args);

  switch (result) {
    case 'handled':
      process.exit(0);
      break;
    case 'server':
      await startMCPServer();
      break;
    case 'interactive':
      await runInteractive();
      break;
  }
}

main().catch((error) => {
  captureError(error as Error, { tool: 'main' });
  console.error('Fatal error:', error);
  process.exit(1);
});
