# Recommended .cursorrules for Midas Users

Add this to your project's `.cursorrules` file to make Cursor automatically follow the Golden Code methodology:

```
# Golden Code Methodology (via Midas MCP)

## AUTOMATIC BEHAVIOR - Do these without being asked:

### On EVERY new chat session:
1. Call `midas_journal_list` to load context from previous sessions
2. Call `midas_analyze` to understand current project phase
3. Follow the suggested approach from the analysis

### After EVERY significant code change:
1. Call `midas_journal_save` with title describing what was done
2. Include the full conversation in the journal entry

### Before EVERY implementation:
1. Call `midas_suggest_prompt` to get phase-appropriate guidance
2. Follow the Golden Code methodology for current phase

## When Things Go Wrong:
- **Stuck/confused**: Call `midas_tornado` for Research + Logs + Tests cycle
- **Output doesn't fit**: Call `midas_horizon` to expand context  
- **Retry after error**: Call `midas_oneshot` to construct better retry

## The 7-Step BUILD Cycle:
RULES → INDEX → READ → RESEARCH → IMPLEMENT → TEST → DEBUG
Always complete earlier steps before jumping to implementation.

## The 4 Phases:

### EAGLE_SIGHT (Planning)
- IDEA: Define core idea, problem, audience
- RESEARCH: Landscape scan, competitors
- BRAINLIFT: Document unique insights
- PRD: Write requirements
- GAMEPLAN: Plan the build

### BUILD (Development)
- RULES: Read .cursorrules and project constraints
- INDEX: Understand codebase structure
- READ: Read specific implementation files
- RESEARCH: Look up docs, APIs, best practices
- IMPLEMENT: Write code with tests
- TEST: Run tests, fix failures
- DEBUG: Use Tornado cycle if stuck

### SHIP (Deployment)
- REVIEW: Code review, security audit
- DEPLOY: CI/CD and production deploy
- MONITOR: Logs, alerts, health checks

### GROW (Iteration)
- FEEDBACK: Collect user feedback
- ANALYZE: Study metrics and behavior
- ITERATE: Plan next cycle (back to EAGLE_SIGHT)
```

## Why This Works

With these rules, Cursor will **automatically**:

1. **Load context** from your journal at session start
2. **Analyze the project** to understand where you are
3. **Save conversations** to journal after changes
4. **Follow methodology** without you having to ask

You still initiate each chat, but Cursor does the Midas calls automatically.

## Installation

1. Run `midas-mcp tui` in your project
2. Press `[a]` to add these rules to `.cursorrules`
3. Or manually create `.cursorrules` with the content above

## What You DON'T Get (Yet)

- Auto-starting new chats (Cursor must be manually opened)
- Auto-committing before/after prompts (would need Claude Code CLI)
- Proactive notifications (MCP is request/response only)

For fully automated workflows, consider wrapping Claude Code CLI.
