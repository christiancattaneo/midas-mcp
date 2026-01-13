# Recommended .cursorrules for Midas Users

Add this to your project's `.cursorrules` file to get the most out of Midas:

```
# Golden Code Methodology

This project follows the Golden Code methodology. Use the Midas MCP tools to guide development.

## Workflow Rules

1. **Before any code changes**: Call `midas_analyze` to understand current phase and get guidance
2. **After important discussions**: Call `midas_journal_save` to preserve context for future sessions
3. **When stuck**: Call `midas_tornado` to get unstuck with the Research + Logs + Tests cycle
4. **When output doesn't fit**: Call `midas_horizon` to expand context
5. **When retrying failed prompts**: Call `midas_oneshot` to construct a better retry

## The 4 Phases

### EAGLE_SIGHT (Planning)
- Start here for new features
- Complete brainlift.md, prd.md, and gameplan.md before coding
- Never skip planning - it prevents costly rewrites

### BUILD (7-Step Cycle)
1. RULES - Read .cursorrules and project constraints
2. INDEX - Understand codebase structure
3. READ - Read specific implementation files
4. RESEARCH - Look up docs, APIs, best practices
5. IMPLEMENT - Write code with tests
6. TEST - Run tests, fix failures
7. DEBUG - Use Tornado cycle if stuck

### SHIP (Deployment)
- Code review, security audit
- CI/CD and production deploy
- Monitoring and health checks

### GROW (Iteration)
- Collect feedback
- Analyze metrics
- Plan next cycle (back to EAGLE_SIGHT)

## Journal Important Conversations

When making significant decisions or completing major implementations, save the conversation:

"Save this conversation to the Midas journal with title 'Implemented user authentication'"

This preserves context for future sessions and helps track project history.

## Key Principles

1. **Oneshot Paradigm**: One clear task per prompt
2. **Tornado Building**: When stuck: Research → Logs → Tests
3. **Horizon Thinking**: Expand context when output doesn't fit
```

## Installation

1. Create a `.cursorrules` file in your project root
2. Paste the content above
3. Cursor will now follow Golden Code methodology and use Midas tools

## Why This Matters

- **Midas tools only work when called** - these rules tell Cursor WHEN to call them
- **Journal entries persist context** - unlike chat history which is ephemeral
- **Phase tracking helps stay focused** - prevents scope creep and random tangents
