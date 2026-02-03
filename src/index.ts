#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { runCLI } from './cli.js';
import { runInteractive } from './tui.js';
import { initMonitoring, captureError } from './monitoring.js';
import updateNotifier from 'update-notifier';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Initialize monitoring on startup (no-op if not configured)
initMonitoring();

// Check for updates (cached 24hr, non-blocking)
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const pkgPath = join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const notifier = updateNotifier({ pkg, updateCheckInterval: 1000 * 60 * 60 * 24 });
  notifier.notify({ isGlobal: true });
} catch {
  // Silent fail - update check is non-critical
}

async function startMCPServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Midas MCP server running');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const result = await runCLI(args);

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
