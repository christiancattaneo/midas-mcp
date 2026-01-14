# midas-mcp

[![CI](https://github.com/christiancattaneo/midas-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/christiancattaneo/midas-mcp/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/midas-mcp.svg)](https://www.npmjs.com/package/midas-mcp)

**Everything you vibecode turns to gold.**

An MCP server that brings the Golden Code methodology into Cursor as an interactive coach. Guides users through the two-phase process, provides expert prompts, and audits projects against the 12 ingredients of production readiness.

## Installation

```bash
npm install -g midas-mcp
```

## Cursor Configuration

Add to your Cursor settings (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "midas": {
      "command": "npx",
      "args": ["midas-mcp"]
    }
  }
}
```

## What Midas Does

### Phase Guidance

Midas tracks your current phase and guides you through:

**Phase 1: Eagle Sight (Pre-Build)**
```
💡 Idea → 🔍 Research → 🧠 Brainlift → 📋 PRD → 🗺️ Gameplan
```

**Phase 2: Build (7-Step Process)**
```
1. User Rules → 2. Index Codebase → 3. Read Files → 4. Research
5. Write Code + Tests → 6. Run Tests → 7. Log → Fix → Repeat
```

### Tools

| Tool | Description |
|------|-------------|
| `midas_start_project` | Initialize Eagle Sight, create docs folder structure |
| `midas_get_phase` | Get current phase and recommended next steps |
| `midas_set_phase` | Move to a specific phase |
| `midas_audit` | Score project against 12 ingredients |
| `midas_check_docs` | Verify brainlift/prd/gameplan completeness |
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
- `midas://eagle-sight` - Pre-build process
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

Midas: Initiates Eagle Sight phase, creates docs folder,
       guides through Brainlift → PRD → Gameplan
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

## Development

```bash
cd midas-mcp
npm install
npm run build
npm run dev
```

## License

MIT
