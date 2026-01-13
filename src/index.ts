#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { runCLI } from './cli.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // If CLI args provided, run CLI mode
  if (args.length > 0) {
    const handled = runCLI(args);
    if (handled) {
      process.exit(0);
    }
    // Unknown command - show help
    console.log(`Unknown command: ${args[0]}`);
    console.log('Run: npx midas-mcp help');
    process.exit(1);
  }

  // No args - start MCP server
  const server = createServer();
  const transport = new StdioServerTransport();
  
  await server.connect(transport);
  
  // Log to stderr (stdout is for MCP protocol)
  console.error('Midas MCP server running');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
