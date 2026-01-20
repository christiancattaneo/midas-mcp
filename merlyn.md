
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

[7 tools called]

Based on my research and analysis of your current PLAN phase, here's my assessment:

## Current Flow Analysis

Your current PLAN phase:
```
IDEA → RESEARCH → BRAINLIFT → PRD → GAMEPLAN
```

**What's good:**
- IDEA first (problem definition) is correct
- BRAINLIFT captures domain expertise AI lacks
- GAMEPLAN sequences work with dependencies
- Strong "why" rationale for each step

**Potential gaps identified:**

### 1. Missing Verification Loops

Most agentic AI frameworks use **Plan → Act → Observe → Reflect** loops. Your current flow is linear with no built-in verification:

```
Current:  IDEA → RESEARCH → BRAINLIFT → PRD → GAMEPLAN  (one-way)

Better:   IDEA → VALIDATE → RESEARCH → VALIDATE → BRAINLIFT → 
          PRD → STAKEHOLDER_CHECK → GAMEPLAN → FEASIBILITY_CHECK
```

**Industry insight:** The "LeanAI" methodology distinguishes **should/can/will** at each stage - what you *should* do (ideal), what you *can* do (constraints), what you *will* commit to.

### 2. Missing Risk Assessment Step

Your current flow doesn't have explicit risk identification before committing to build. Research shows teams that identify risks upfront have significantly fewer mid-project surprises.

**Proposed addition:** `RISKS` step between PRD and GAMEPLAN:
- Technical risks (scaling, security, dependencies)
- Business risks (market timing, competition)
- Integration risks (APIs, third-party services)

### 3. PRD Position May Be Wrong

**Current order:** BRAINLIFT → PRD → GAMEPLAN

**Research suggests:** PRD should come *before* deep domain documentation because:
- PRD defines *what* to build (goals, constraints, scope)
- BRAINLIFT then captures *how your context* affects that scope
- Otherwise you risk documenting irrelevant domain knowledge

**Alternative sequence:**
```
IDEA → RESEARCH → PRD → BRAINLIFT → GAMEPLAN
```

### 4. Missing Spike/Prototype Step

Modern agile and AI-assisted development recommends **prototyping unknowns** during planning:

```
GAMEPLAN → SPIKE (optional) → BUILD
```

When the gameplan reveals high-risk technical unknowns, a short prototype validates assumptions before committing.

---

## Recommended Improved Planning Phase

```
PLAN Phase (v2):
  IDEA      → Define problem, audience, why now
  RESEARCH  → Scan landscape, competitors, existing solutions  
  PRD       → Goals, non-goals, scope, success criteria
  BRAINLIFT → Your unique context, domain knowledge, constraints
  RISKS     → Technical/business/integration risks + mitigations
  GAMEPLAN  → Sequenced tasks, dependencies, estimates
  [SPIKE]   → Optional: prototype high-risk unknowns
```

### Verification Gates (new)

Add lightweight verification between phases:

| Transition | Verification Question |
|------------|----------------------|
| IDEA → RESEARCH | "Is the problem worth solving?" |
| RESEARCH → PRD | "Do we understand the landscape enough to scope?" |
| PRD → BRAINLIFT | "Are requirements clear and bounded?" |
| BRAINLIFT → RISKS | "Have we captured our unique constraints?" |
| RISKS → GAMEPLAN | "Are risks understood and mitigated?" |
| GAMEPLAN → BUILD | "Is this plan feasible and sequenced correctly?" |

---

## Test-Code-Debug Loop Improvements

Your current BUILD phase:
```
RULES → INDEX → READ → RESEARCH → IMPLEMENT → TEST → DEBUG
```

**Industry best practice:** The **Red-Green-Refactor** TDD cycle should be embedded in IMPLEMENT:

```
IMPLEMENT = [
  1. Write failing test (red)
  2. Write minimal code to pass (green)  
  3. Refactor if needed
  4. Repeat
]
```

**Missing: Verification after DEBUG**

When DEBUG completes, current flow has no explicit "are we done?" check. Add:

```
DEBUG → VERIFY → (back to IMPLEMENT if more work, or forward to TEST/SHIP)
```

---

## AI Agent Loop Patterns

Research on autonomous AI agents (Devin-style) shows the most effective pattern is:

```
PLAN → ACT → OBSERVE → REFLECT → [loop or advance]
```

Your midas could adopt this at the step level:

```typescript
// Pseudo-structure
interface StepExecution {
  plan: string;      // What we'll do
  act: () => void;   // Do it
  observe: () => Result;  // Check result
  reflect: () => Decision; // Continue, retry, or escalate?
}
```

---

## Summary: Recommended Changes

| Change | Impact | Effort |
|--------|--------|--------|
| Add RISKS step between PRD and GAMEPLAN | High - prevents mid-build surprises | Low |
| Swap PRD ↔ BRAINLIFT order | Medium - better scoping | Low |
| Add verification gates between steps | High - catches bad assumptions | Medium |
| Add optional SPIKE step | Medium - de-risks unknowns | Low |
| Embed TDD cycle in IMPLEMENT | High - catches bugs earlier | Already have it |
| Add VERIFY after DEBUG | Medium - confirms completion | Low |

Would you like me to draft the updated `PHASE_INFO` structure with these changes? Switch to agent mode and I can implement it.


[5 tools called]

This is a profound question about the **meta-layer** of development. Let me analyze what exists and synthesize options.

## Current Architecture

| Layer | What It Does | Gap |
|-------|--------------|-----|
| **Phase/Step** | Tactical position (BUILD→IMPLEMENT) | Tells you WHERE, not WHY |
| **Gameplan** | Task checklist | Convergent, not divergent |
| **Brainlift** | Domain knowledge dump | Static, captured once |
| **Analyzer** | "What's next?" | Reactive, not visionary |

**The missing layer**: A **vision keeper** that asks "Is this still the most transformative path?"

## Research Synthesis

From industry patterns and AI agent research:

1. **Teleological agents** (goal-directed) outperform reactive agents when goals can shift mid-execution
2. **North Star prompts** periodically re-evaluate: "Does this still serve the ultimate purpose?"
3. **Divergent checkpoints** ask boundary-pushing questions that might invalidate current work (scary but valuable)

## Proposed: The "Oracle" Layer

A periodic high-level prompt that:

```
┌─ ORACLE CHECK ──────────────────────────────────────┐
│ Vision: "Democratize AI coding for non-engineers"  │
│                                                     │
│ Current trajectory: Building syntax highlighter     │
│                                                     │
│ ⚡ Questions:                                       │
│ • Is this the highest-leverage work right now?     │
│ • What would 10x the impact of this project?       │
│ • What assumption, if wrong, invalidates this?     │
│ • Is there a simpler path to the vision?           │
└─────────────────────────────────────────────────────┘
```

### Three Design Options

**Option A: Vision Doc + Periodic Oracle Prompt**
- New `docs/vision.md` - the transformative goal (stable)
- Oracle prompt triggers every N tasks or on demand
- Asks: "Given vision X, is current work Y optimal?"

**Option B: Embedded in Analyzer**
- Add to analysis: "Vision alignment score: 72%"
- When < 50%, suggest: "Consider pivoting to higher-leverage work"
- Passive, always running

**Option C: Separate "Diverge" Mode**
- Hotkey `[d]` in TUI: "Diverge - challenge assumptions"
- Enters a Socratic dialogue:
  - "What's the ultimate goal?"
  - "What would make this 10x more valuable?"
  - "What's the riskiest assumption?"
- Outputs either: "Stay the course" or "Consider: [alternative]"

## Highest-IQ Implementation

I'd recommend **Option A + C combined**:

1. **vision.md** - Captures the north star (1 paragraph max)
2. **Oracle prompt** (MCP prompt) - "Challenge my current trajectory"
3. **TUI integration** - `[o]` Oracle: shows vision + asks if current work aligns

### vision.md Example

```markdown
# Vision

Create something so valuable that users can't imagine working without it.
The test: Would someone pay for this even if alternatives existed?

## Current Bet
[What we're betting will achieve this]

## Kill Conditions  
[If X happens, we should pivot]
```

### Oracle Prompt Logic

```typescript
// Trigger conditions:
// 1. Every 5 gameplan tasks completed
// 2. On-demand via 'o' key
// 3. When stuck for > 30 minutes

const oraclePrompt = `
Given this vision: ${vision}
And current work: ${currentTask}

Ask yourself:
1. Does this directly serve the vision, or is it adjacent?
2. What's the fastest path to something users would pay for?
3. What am I avoiding that might be more important?
4. If I had to ship tomorrow, what would I cut?

Respond with: CONTINUE, PIVOT, or SIMPLIFY with reasoning.
`;
```

## My Recommendation

Start minimal:

1. Add `docs/vision.md` as a first-class planning doc (like brainlift)
2. Add one Oracle prompt in `src/prompts/oracle.ts`
3. Show vision summary in TUI info screen
4. Add `[o]` key to trigger Oracle reflection

This keeps the checklist (convergent execution) while adding periodic divergent thinking.

---

Want me to sketch out the implementation? You're in ask mode - switch to agent mode if you want me to build it.