import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to docs folder (relative to dist/resources/)
const DOCS_PATH = join(__dirname, '..', '..', 'docs');

function readDocFile(filename: string): string {
  const filePath = join(DOCS_PATH, filename);
  if (!existsSync(filePath)) {
    return `Documentation file not found: ${filename}`;
  }
  return readFileSync(filePath, 'utf-8');
}

export function registerAllResources(server: McpServer): void {
  // List available resources
  server.resource(
    'methodology',
    'midas://methodology',
    async () => ({
      contents: [
        {
          uri: 'midas://methodology',
          mimeType: 'text/markdown',
          text: readDocFile('METHODOLOGY.md'),
        },
      ],
    })
  );

  server.resource(
    'prompts',
    'midas://prompts',
    async () => ({
      contents: [
        {
          uri: 'midas://prompts',
          mimeType: 'text/markdown',
          text: readDocFile('PROMPTS.md'),
        },
      ],
    })
  );

  server.resource(
    'ingredients',
    'midas://ingredients',
    async () => ({
      contents: [
        {
          uri: 'midas://ingredients',
          mimeType: 'text/markdown',
          text: readDocFile('INGREDIENTS.md'),
        },
      ],
    })
  );

  server.resource(
    'user-rules',
    'midas://user-rules',
    async () => ({
      contents: [
        {
          uri: 'midas://user-rules',
          mimeType: 'text/markdown',
          text: readDocFile('USER_RULES.md'),
        },
      ],
    })
  );

  server.resource(
    'cheatsheet',
    'midas://cheatsheet',
    async () => ({
      contents: [
        {
          uri: 'midas://cheatsheet',
          mimeType: 'text/markdown',
          text: readDocFile('CHEATSHEET.md'),
        },
      ],
    })
  );
}
