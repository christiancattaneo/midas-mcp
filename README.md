# midas-mcp

[![CI](https://github.com/christiancattaneo/midas-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/christiancattaneo/midas-mcp/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/midas-mcp.svg)](https://www.npmjs.com/package/midas-mcp)

**Everything you vibecode turns to gold.**

An MCP server that brings the Golden Code methodology into Cursor as an interactive coach. Guides users through the two-phase process, provides expert prompts, and audits projects against the 12 ingredients of production readiness.

## Requirements

Midas uses a **hybrid architecture** for optimal performance:

| Component | Purpose | Setup |
|-----------|---------|-------|
| **Claude Code** | Executes prompts, makes code changes | `curl -fsSL https://claude.ai/install.sh \| bash` then `claude` to auth |
| **Anthropic API Key** | Fast project analysis, smart suggestions | Add to `~/.midas/config.json` (optional but recommended) |

### Quick Setup

```bash
# 1. Install Claude Code (required for auto-mode)
curl -fsSL https://claude.ai/install.sh | bash

# 2. Authenticate Claude Code (opens browser)
claude

# 3. Run Midas
npx midas-mcp run
```

Midas will guide you through any remaining setup (GitHub login, API key).

### Why Both?

- **Claude Code** = "The Hands" - actually modifies files, runs commands, iterates on errors
- **Anthropic API** = "The Brain" - fast analysis (~$0.003/analysis), generates smart suggestions

Without Claude Code, Midas can only analyze. With Claude Code, Midas can execute prompts and grind through your gameplan in auto-mode.

## Quick Start

Run Midas instantly (no install required):

```bash
npx --yes midas-mcp@latest
```

This launches the interactive TUI coach. Press `?` for help, `p` to copy the recommended prompt.

### One Command to Rule Them All

```bash
npx midas-mcp run
```

This does everything:
1. Checks Claude Code installation and auth
2. Logs you into GitHub (for cloud dashboard)
3. Syncs your project to the dashboard
4. Starts watch mode for remote/auto execution

## Installation (Optional)

For global installation (enables `midas` command):

```bash
npm install -g midas-mcp
```

Or add a shell alias to `~/.zshrc` or `~/.bashrc`:

```bash
alias midas="npx midas-mcp@latest"
```

Then reload your shell: `source ~/.zshrc`

## Cursor Configuration

Add to your Cursor settings (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "midas": {
      "command": "npx",
      "args": ["midas-mcp@latest", "server"]
    }
  }
}
```

Using `@latest` ensures you always get the newest version. The `server` argument runs midas as an MCP server (without it, you get the interactive TUI).

## What Midas Does

### Phase Guidance

Midas tracks your current phase and guides you through:

**Phase 1: Plan (Pre-Build)**
```
💡 Idea → 🔍 Research → 📋 PRD → 🗺️ Gameplan
```

**Phase 2: Build (7-Step Process)**
```
1. User Rules → 2. Index Codebase → 3. Read Files → 4. Research
5. Write Code + Tests → 6. Run Tests → 7. Log → Fix → Repeat
```

### Tools

| Tool | Description |
|------|-------------|
| `midas_start_project` | Initialize Plan, create docs folder structure |
| `midas_get_phase` | Get current phase and recommended next steps |
| `midas_set_phase` | Move to a specific phase |
| `midas_audit` | Score project against 12 ingredients |
| `midas_check_docs` | Verify prd/gameplan completeness |
| `midas_oneshot` | Apply the Oneshot Paradigm for error recovery |
| `midas_tornado` | Trigger Research + Logs + Tests cycle |
| `midas_horizon` | Expand horizontal context for better output |

### Prompts

Pre-built expert prompts you can invoke:

| Prompt | Purpose |
|--------|---------|
| `master_prompt` | Session initialization with full context loading |
| `execution_prompt` | Start building with TDD approach |
| `safe_refactor` | Move code safely between files |
| `bug_investigation` | Root cause analysis before fixing |
| `security_review` | Check for vulnerabilities |
| `feature_planning` | Plan before implementing |

### Resources

Documentation available on demand:

- `midas://methodology` - Core philosophy
- `midas://plan` - Pre-build process
- `midas://process` - 7-step development loop
- `midas://oneshot` - Fix backward paradigm
- `midas://tornado` - Research + Logs + Tests
- `midas://horizon` - Horizontal vs vertical context
- `midas://ingredients/{1-12}` - Production guidelines
- `midas://cheatsheet` - Quick reference

## The Three Principles

When you hit problems, Midas applies:

### 1. Oneshot Paradigm
When things break, go back with error + context instead of patching forward.
```
Original Prompt + Error Log + "Avoid this" = Working Solution
```

### 2. Tornado Building
Three forces spinning together solve any problem:
```
Research + Logs + Tests = Solution
```

### 3. Horizon Thinking
AI thinks vertical (implementation). You provide horizontal (context).
```
Wrong output? Widen your horizontal context.
```

## Usage Examples

### Starting a New Project

```
User: "I want to build a task management app"

Midas: Initiates Plan phase, creates docs folder,
       guides through PRD → Gameplan
```

### When Stuck on a Bug

```
User: "This keeps failing with the same error"

Midas: Detects repeated failures, suggests Oneshot approach,
       helps construct enhanced prompt with error context
```

### Checking Production Readiness

```
User: "Is my project ready to ship?"

Midas: Runs 12 ingredients audit, scores each category,
       identifies gaps and provides remediation guidance
```

## The 12 Ingredients

Midas audits against:

| # | Ingredient | Category |
|---|------------|----------|
| 1 | Frontend | Core |
| 2 | Backend | Core |
| 3 | Database | Core |
| 4 | Authentication | Core |
| 5 | API Integrations | Power |
| 6 | State Management | Power |
| 7 | Design/UX | Power |
| 8 | Testing | Protection |
| 9 | Security | Protection |
| 10 | Error Handling | Protection |
| 11 | Version Control | Mastery |
| 12 | Deployment | Mastery |

**Completion levels:** 1-4 (functional), 1-8 (polished), 1-12 (production-ready)

## Cloud Dashboard

Track your progress across all projects at [dashboard.midasmcp.com](https://dashboard.midasmcp.com).

### Login with GitHub

```bash
npx midas-mcp login
```

This opens GitHub for authentication. Once complete, your projects can sync to the cloud.

### Sync Your Project

```bash
cd your-project
npx midas-mcp sync
```

Syncs current phase, gate status, and recent activity to the dashboard.

### Check Login Status

```bash
npx midas-mcp whoami
```

Shows your authenticated GitHub username and sync configuration status.

## Remote Pilot (Control from Phone)

Run AI coding tasks from your phone while your laptop works in the background.

### Start Remote Pilot

```bash
npx midas-mcp pilot --remote
```

This displays a QR code in your terminal. Scan it with your phone to open the mobile dashboard.

### How It Works

1. **Laptop**: Run `npx midas-mcp pilot --remote` - displays QR code, waits for commands
2. **Phone**: Scan QR → opens mobile dashboard at `dashboard.midasmcp.com/pilot/...`
3. **Execute**: Tap quick actions or type custom prompts
4. **Claude Code runs locally** on your laptop, output streams to your phone

### Quick Actions Available

- **Run Tests**: Execute test suite and fix failures
- **Fix Lints**: Run linter and auto-fix issues  
- **Build**: Compile project and resolve errors
- **Analyze**: Get AI analysis and next step suggestions
- **Custom prompts**: Send any instruction to Claude Code

### Requirements

- [Claude Code CLI](https://claude.ai/code) installed on your laptop
- GitHub account (for authentication)

### Other Pilot Modes

```bash
# Watch mode - poll dashboard for queued commands
npx midas-mcp pilot --watch

# Single command execution
npx midas-mcp pilot "Fix the bug in auth.ts"
```

## Development

```bash
cd midas-mcp
npm install
npm run build
npm run dev
```

## License

MIT
