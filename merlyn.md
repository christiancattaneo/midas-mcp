
Based on my research, here's the situation:

## Claude Code + MCP Integration Options

### Current Architecture
```
┌─────────────┐     calls      ┌─────────────┐
│ Claude Code │ ────────────▶  │ Midas MCP   │
│  (client)   │     tools      │  (server)   │
└─────────────┘                └─────────────┘
```

**This already works.** Claude Code can call Midas tools like `midas_analyze`, `midas_tornado`, etc.

### What You're Asking: Midas → Claude Code

```
┌─────────────┐    prompts?    ┌─────────────┐
│ Midas MCP   │ ────────────▶  │ Claude Code │
│  (server)   │                │  (terminal) │
└─────────────┘                └─────────────┘
```

**This is harder.** Three approaches:

---

## Option 1: Subprocess/CLI (Easiest but Limited)

Claude Code CLI appears to support non-interactive mode. You could spawn it as a child process:

```typescript
import { spawn } from 'child_process';

async function promptClaudeCode(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', prompt], {
      cwd: projectPath,
      env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
    });
    
    let output = '';
    proc.stdout.on('data', (data) => output += data);
    proc.stderr.on('data', (data) => console.error(data.toString()));
    proc.on('close', (code) => code === 0 ? resolve(output) : reject(output));
  });
}
```

**Difficulty**: 🟢 Easy  
**Limitation**: No access to Claude Code's full context/codebase awareness. Each call is isolated.

---

## Option 2: Connect to Claude Code as MCP Server (Medium)

Claude Code can expose itself as an MCP server. If we connect Midas as a **client** to Claude Code's MCP server:

```typescript
// In Midas, connect to Claude Code's MCP server
import { Client } from '@modelcontextprotocol/sdk/client';

const claudeCodeClient = new Client({
  transport: new StdioClientTransport({
    command: 'claude',
    args: ['--mcp-server'],  // hypothetical flag
  }),
});

// Call Claude Code's exposed tools
await claudeCodeClient.callTool('run_terminal_command', { command: 'npm test' });
```

**Difficulty**: 🟡 Medium  
**Limitation**: Claude Code's MCP server capabilities are not well-documented yet.

---

## Option 3: Shared Context via Filesystem (Pragmatic)

Instead of directly prompting Claude Code, Midas writes context that Claude Code reads:

```typescript
// Midas writes coaching instructions
writeFileSync('.midas/next-prompt.md', `
## Recommended Next Action
${suggestedPrompt}

## Why
${explanation}

## Context
${relevantErrors}
`);

// Claude Code reads this via @file or user paste
```

**Difficulty**: 🟢 Easy  
**Limitation**: Requires user to trigger Claude Code to read the file.

---

## Option 4: Use Anthropic API Directly (Already Done)

Midas already calls Claude via the Anthropic API. For most coaching purposes, this is sufficient. Claude Code is just a UI wrapper around the same API.

**Difficulty**: ✅ Already implemented  
**Limitation**: Doesn't have Claude Code's codebase indexing/agentic loop.

---

## Recommendation

**Feasibility: Medium-High**

The cleanest approach would be **Option 2** if Claude Code exposes stable MCP server capabilities. I'd need to test if `claude --mcp-server` or similar exists.

For now, the **pragmatic path** is:
1. Midas coaches via TUI → user copies prompt to Claude Code
2. Claude Code calls Midas tools during execution
3. Midas tracks activity and suggests next steps
