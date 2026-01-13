# Midas - Cursor User Rules

Add these rules to your **Cursor User Rules** (Settings → Rules for AI) to make Cursor automatically follow the Golden Code methodology across ALL projects.

## The Rules to Add

```
# Golden Code Methodology (via Midas MCP)

## AUTOMATIC BEHAVIOR - Do these without being asked:

### On EVERY new chat session:
1. Call `midas_journal_list` to load context from previous sessions
2. Call `midas_analyze` to understand current project phase
3. Follow the suggested approach from the analysis

### After EVERY significant code change:
1. Git commit with descriptive message before AND after major changes
2. Call `midas_journal_save` with title describing what was done
3. Include the full conversation in the journal entry

### Before EVERY implementation:
1. Call `midas_suggest_prompt` to get phase-appropriate guidance
2. Follow the Golden Code methodology for current phase

## When Things Go Wrong:
- **Stuck/confused**: Call `midas_tornado` for Research + Logs + Tests cycle
- **Output doesn't fit**: Call `midas_horizon` to expand context
- **Retry after error**: Call `midas_oneshot` to construct better retry

## Git Discipline:
- Commit BEFORE starting any significant change (checkpoint)
- Commit AFTER completing each logical unit of work
- Use descriptive commit messages that explain WHY not just WHAT

## The 7-Step BUILD Cycle:
RULES → INDEX → READ → RESEARCH → IMPLEMENT → TEST → DEBUG
Always complete earlier steps before jumping to implementation.

## The 4 Phases:
1. EAGLE_SIGHT: Plan before coding (brainlift, PRD, gameplan)
2. BUILD: The 7-step cycle above
3. SHIP: Review, deploy, monitor
4. GROW: Feedback, analyze, iterate back to EAGLE_SIGHT
```

## How to Add

1. Open Cursor Settings (Cmd+,)
2. Search for "Rules for AI" or navigate to it
3. Paste the rules above
4. Save

Now Cursor will automatically:
- Load journal context at session start
- Analyze project phase
- Save conversations to journal
- Git commit before/after changes
- Follow the Golden Code methodology

## Why User Rules Instead of .cursorrules

| Feature | User Rules | .cursorrules |
|---------|-----------|--------------|
| Scope | All projects | One project |
| Git tracked | No | Yes |
| Setup | Once | Per project |
| Override | Per-project can override | N/A |

User Rules are ideal for methodology/workflow rules that should apply everywhere.
Project `.cursorrules` are for project-specific conventions (TypeScript config, naming, etc).
