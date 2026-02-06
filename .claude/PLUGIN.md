# Midas Plugin for Claude Code

This is a Claude Code plugin that provides the Golden Code methodology for structured software development.

## Installation

Copy the `.claude/` directory to your project root, or install via:

```bash
npx midas-mcp init
```

## What's Included

### Skills (`.claude/skills/`)

Phase-specific prompts that auto-trigger based on context:

| Skill | Triggers On | Purpose |
|-------|-------------|---------|
| `plan-idea` | "new project", "start project" | Define problem and audience |
| `plan-research` | "research alternatives" | Scan existing solutions |
| `plan-prd` | "define requirements" | Specify requirements |
| `plan-gameplan` | "break down tasks" | Sequence the work |
| `build-rules` | "start building" | Set up conventions |
| `build-implement` | "implement feature" | Test-first development |
| `build-test` | "run tests" | Verify with full suite |
| `build-debug` | "debug" | Systematic debugging |
| `tornado-debug` | "stuck", "tried everything" | Research + Logs + Tests cycle |
| `oneshot-retry` | "try again" | Construct better retry prompt |
| `horizon-expand` | "doesn't fit" | Widen context for better output |

### Agents (`.claude/agents/`)

Specialized subagents for different tasks:

| Agent | Type | Purpose |
|-------|------|---------|
| `midas-coach` | general-purpose | Orchestrates the methodology |
| `midas-verifier` | explore (read-only) | Checks build/test/lint gates |
| `midas-reviewer` | explore (read-only) | Security and code review |

### Hooks (`.claude/hooks/`)

Automated behaviors:

- **SessionStart**: Load Midas state and context
- **PreToolUse**: Remind about tests before editing
- **PostToolUse**: Suggest verification after changes  
- **Stop**: Verify task completion before ending

## Usage

### Invoke Skills

Skills auto-trigger, or invoke manually:

```
/plan-idea
/tornado-debug
/horizon-expand
```

### Invoke Agents

```
/midas-coach    # Get methodology guidance
/midas-verifier # Check all gates
/midas-reviewer # Pre-ship code review
```

### Check Status

```bash
midas status        # One-shot status
midas status --watch # Live updating display
```

## The Golden Code Lifecycle

```
PLAN  →  BUILD  →  SHIP  →  GROW
  │         │         │        │
  ▼         ▼         ▼        ▼
Idea     Rules     Review   Feedback
Research Index     Deploy   Analyze
PRD      Read      Monitor  Iterate
Gameplan Research
Gameplan Implement
         Test
         Debug
```

## Migration from MCP Tools

If you were using Midas MCP tools, here's the mapping:

| Old MCP Tool | New Skill/Agent |
|--------------|-----------------|
| `midas_analyze` | `/midas-coach` |
| `midas_tornado` | `/tornado-debug` |
| `midas_oneshot` | `/oneshot-retry` |
| `midas_horizon` | `/horizon-expand` |
| `midas_verify` | `/midas-verifier` |
| `midas_audit` | `/midas-reviewer` |
| `midas_journal_*` | Use `--continue`/`--resume` |

The MCP server remains available for IDE integration, but for CLI usage, Skills and Agents provide a more native Claude Code experience.

## Configuration

Edit `.claude/settings.json` to customize:

- Permissions
- Context includes/excludes
- Skill directories
- Hook configuration

## Learn More

- [Golden Code Methodology](https://midasmcp.com)
- [Claude Code Skills](https://docs.anthropic.com/claude-code/skills)
- [Claude Code Hooks](https://docs.anthropic.com/claude-code/hooks)
