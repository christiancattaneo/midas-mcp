# Merlyn: Mini Midas

## What Is This

A stripped-down version of midas-mcp that keeps only the core coaching engine:
- **MCP server** — 37 tools for Cursor/Claude to call
- **TUI** — interactive terminal coach that tells you what to do next
- **CLI** — `status`, `init`, `audit`, `docs`, `metrics`
- **AI analysis** — reads your codebase, detects phase, suggests next prompt

Everything related to cloud dashboard, phone control, GitHub OAuth, remote pilot, auto-mode, and Claude Code execution is removed.

## Why Fork Instead of Feature-Flag

The cloud/pilot code has tentacles everywhere — `cli.ts` imports auth, cloud, pilot. Ripping it out of midas-mcp would break the existing product. A clean fork is simpler:

1. Copy the repo
2. Delete cloud files
3. Clean up `cli.ts` and `index.ts` imports
4. Done — same functionality, half the code

## How To Create Merlyn (30 min)

### Step 1: Clone and rename

```bash
cp -r /Users/christiancattaneo/Projects/midas-mcp /Users/christiancattaneo/Projects/merlyn
cd /Users/christiancattaneo/Projects/merlyn
rm -rf .git node_modules dist
git init
```

### Step 2: Delete cloud/dashboard/pilot files

```bash
# Cloud infrastructure
rm -f src/cloud.ts
rm -f src/auth.ts
rm -f src/pilot.ts
rm -f src/claude-code.ts
rm -f src/github-integration.ts
rm -f src/monitoring.ts
rm -f src/tui-lite.ts

# Dashboard (entire directory)
rm -rf dashboard/

# Claude Code plugin config (optional — keep if you want Skills)
# rm -rf .claude/
```

### Step 3: Clean up cli.ts

Remove these imports and their associated command handlers:

```typescript
// REMOVE these imports:
import { login, logout, ... } from './auth.js';
import { syncProject, ... } from './cloud.js';
import { runPilotCLI } from './pilot.js';
import { reviewPR } from './github-integration.js';

// REMOVE these commands:
// 'run', 'start', 'setup' — cloud auto-setup
// 'login', 'logout', 'whoami' — GitHub OAuth
// 'sync' — cloud sync
// 'watch', 'pilot' — remote execution
// 'pr' — GitHub PR review
// 'plugin' — Claude Code plugin install

// KEEP these commands:
// default (no args) — interactive TUI
// 'status' — show phase
// 'init <name>' — initialize project
// 'audit' — 12-ingredient audit
// 'docs' — check planning docs
// 'metrics' — session metrics
// 'weekly' — weekly summary
// 'server' — MCP server
// 'help' — help text
```

### Step 4: Clean up index.ts

The entry point routes to server or CLI. Remove any `run`/`start` routing that calls pilot/cloud.

### Step 5: Clean up server.ts

Remove any tool registrations that depend on cloud/auth/pilot (there shouldn't be any — all 37 MCP tools are local).

### Step 6: Clean up tui.ts

The TUI is already self-contained. It uses:
- `analyzer.ts` — AI analysis (local, calls Claude API)
- `tracker.ts` — smart prompt suggestions (local)
- `state/phase.ts` — phase state machine (local)
- `events.ts` — event logging (local)

No cloud dependencies. The only change: remove any `sync` or `dashboard` references from the UI text.

### Step 7: Update package.json

```json
{
  "name": "merlyn",
  "bin": { "merlyn": "dist/index.js" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "...",
    "zod": "...",
    "write-file-atomic": "..."
  }
}
```

Remove: `qrcode-terminal`, `update-notifier`

### Step 8: Build and test

```bash
npm install
npm run build
node --test dist/tests/phase.test.js dist/tests/tools.test.js dist/tests/tracker.test.js
```

All tests should pass — they don't depend on cloud.

## File Inventory

### Keep (core coaching engine)

| File | Purpose | Lines |
|------|---------|-------|
| `src/index.ts` | Entry point | ~50 |
| `src/server.ts` | MCP server, 37 tools | ~500 |
| `src/cli.ts` | CLI commands (after cleanup) | ~300 |
| `src/tui.ts` | Interactive TUI coach | ~1800 |
| `src/state/phase.ts` | Phase state machine | ~500 |
| `src/atomic-state.ts` | Atomic file operations | ~200 |
| `src/analyzer.ts` | AI project analysis | ~600 |
| `src/tracker.ts` | Activity tracking, smart suggestions | ~900 |
| `src/gameplan-tracker.ts` | Gameplan progress | ~300 |
| `src/phase-detector.ts` | Artifact-based phase detection | ~200 |
| `src/config.ts` | API key management | ~100 |
| `src/events.ts` | Event logging | ~100 |
| `src/metrics.ts` | Session metrics | ~150 |
| `src/logger.ts` | Logging | ~50 |
| `src/security.ts` | Path sanitization | ~80 |
| `src/providers.ts` | AI provider abstraction | ~700 |
| `src/context.ts` | Token estimation | ~200 |
| `src/code-discovery.ts` | Code file discovery | ~300 |
| `src/docs-discovery.ts` | Doc discovery | ~400 |
| `src/file-index.ts` | File indexing | ~300 |
| `src/search.ts` | Code search | ~200 |
| `src/techstack.ts` | Tech stack detection | ~200 |
| `src/ai.ts` | AI utilities | ~200 |
| `src/preflight.ts` | Pre-ship checks | ~800 |
| `src/reality.ts` | Reality checks | ~800 |
| `src/tools/*.ts` | 20+ MCP tools | ~3000 |
| `src/prompts/*.ts` | MCP prompts | ~300 |
| `src/resources/*.ts` | MCP resources | ~100 |

### Remove (cloud/dashboard/pilot)

| File | Purpose | Lines |
|------|---------|-------|
| `src/cloud.ts` | Turso DB sync | ~900 |
| `src/auth.ts` | GitHub OAuth | ~350 |
| `src/pilot.ts` | Remote execution, watch mode | ~1000 |
| `src/claude-code.ts` | Claude Code CLI wrapper | ~100 |
| `src/github-integration.ts` | PR review | ~200 |
| `src/monitoring.ts` | Sentry/OTel | ~200 |
| `src/tui-lite.ts` | Status with QR | ~200 |
| `dashboard/` | Next.js web dashboard | ~3000 |

**Savings: ~6000 lines removed, ~11000 lines kept**

## What Merlyn Does (same as Midas core)

1. **You run `merlyn`** → TUI starts, analyzes your project with AI
2. **AI detects your phase** → PLAN / BUILD / SHIP / GROW
3. **Shows suggested prompt** → "Do this next" with explanation
4. **You press [c]** → Prompt copied to clipboard, paste in Cursor
5. **You press [x]** → Skip, get a different suggestion
6. **Cursor calls MCP tools** → `midas_analyze`, `midas_journal_save`, `midas_verify`, etc.
7. **Tools update state** → Phase advances, progress tracked
8. **Next time you run `merlyn`** → Knows where you left off

## Dependency Chain (what imports what)

```
index.ts → cli.ts → tui.ts
                  → server.ts
                  
tui.ts → analyzer.ts → providers.ts (AI calls)
       → tracker.ts → state/phase.ts
       → events.ts
       → config.ts
       
server.ts → tools/*.ts → tracker.ts
                        → state/phase.ts
                        → security.ts
```

No circular dependencies. No cloud dependencies in the core chain.

## MCP Server Config (for Cursor)

```json
{
  "mcpServers": {
    "merlyn": {
      "command": "npx",
      "args": ["-y", "merlyn"]
    }
  }
}
```

Same 37 tools, same prompts, same resources — just without the cloud overhead.
