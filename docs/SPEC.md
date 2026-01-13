# Midas MCP Technical Specification

Technical design for the midas-mcp server.

---

## Architecture

```
midas-mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── server.ts             # Server setup and configuration
│   ├── tools/
│   │   ├── index.ts          # Tool exports
│   │   ├── phase.ts          # Phase tracking tools
│   │   ├── audit.ts          # 12 ingredients audit
│   │   ├── docs.ts           # Check docs completeness
│   │   ├── oneshot.ts        # Oneshot paradigm helper
│   │   ├── tornado.ts        # Tornado cycle trigger
│   │   └── horizon.ts        # Horizon expansion helper
│   ├── prompts/
│   │   ├── index.ts          # Prompt exports
│   │   ├── session.ts        # Master/execution prompts
│   │   ├── development.ts    # Feature/bug prompts
│   │   ├── review.ts         # Security/performance review
│   │   └── research.ts       # Research prompts
│   ├── resources/
│   │   ├── index.ts          # Resource exports
│   │   ├── methodology.ts    # Core methodology content
│   │   ├── prompts.ts        # Prompt library content
│   │   └── ingredients.ts    # 12 ingredients content
│   └── state/
│       └── phase.ts          # Phase state machine
├── docs/
│   ├── METHODOLOGY.md        # Source content
│   ├── PROMPTS.md            # Source content
│   ├── INGREDIENTS.md        # Source content
│   ├── USER_RULES.md         # Source content
│   └── SPEC.md               # This file
├── package.json
├── tsconfig.json
└── README.md
```

---

## Phase State Machine

```typescript
type EagleSightStep = 
  | 'IDEA'
  | 'RESEARCH'
  | 'BRAINLIFT'
  | 'PRD'
  | 'GAMEPLAN';

type BuildStep =
  | 'RULES_LOADED'
  | 'CODEBASE_INDEXED'
  | 'FILES_READ'
  | 'RESEARCHING'
  | 'IMPLEMENTING'
  | 'TESTING'
  | 'DEBUGGING';

type Phase =
  | { phase: 'IDLE' }
  | { phase: 'EAGLE_SIGHT'; step: EagleSightStep }
  | { phase: 'BUILD'; step: BuildStep }
  | { phase: 'SHIPPED' };

interface PhaseState {
  current: Phase;
  history: Phase[];
  startedAt: string;
  docs: {
    brainlift: boolean;
    prd: boolean;
    gameplan: boolean;
  };
}
```

---

## Tools Specification

### midas_start_project

Initializes a new project with Eagle Sight.

**Input:**
```typescript
{
  projectName: string;
  projectPath?: string; // defaults to cwd
}
```

**Behavior:**
1. Creates `docs/` folder
2. Creates `docs/brainlift.md` with template
3. Creates `docs/prd.md` with template
4. Creates `docs/gameplan.md` with template
5. Sets phase to `EAGLE_SIGHT.IDEA`
6. Returns guidance for next step

---

### midas_get_phase

Returns current phase and recommended actions.

**Input:** none

**Output:**
```typescript
{
  current: Phase;
  nextSteps: string[];
  prompt?: string; // suggested prompt for this phase
}
```

---

### midas_set_phase

Manually set the current phase.

**Input:**
```typescript
{
  phase: 'EAGLE_SIGHT' | 'BUILD' | 'SHIPPED';
  step?: string;
}
```

---

### midas_audit

Audit project against 12 ingredients.

**Input:**
```typescript
{
  projectPath?: string;
}
```

**Output:**
```typescript
{
  scores: {
    [ingredient: string]: {
      exists: boolean;
      score: number; // 0-100
      issues: string[];
      suggestions: string[];
    }
  };
  overall: number;
  level: 'functional' | 'integrated' | 'protected' | 'production';
}
```

---

### midas_check_docs

Verify Eagle Sight docs exist and are complete.

**Input:**
```typescript
{
  projectPath?: string;
}
```

**Output:**
```typescript
{
  brainlift: { exists: boolean; complete: boolean; issues: string[] };
  prd: { exists: boolean; complete: boolean; issues: string[] };
  gameplan: { exists: boolean; complete: boolean; issues: string[] };
  ready: boolean;
}
```

---

### midas_oneshot

Construct a Oneshot retry prompt.

**Input:**
```typescript
{
  originalPrompt: string;
  error: string;
  learnings?: string[];
}
```

**Output:**
```typescript
{
  prompt: string; // constructed oneshot prompt
}
```

---

### midas_tornado

Guide through tornado cycle.

**Input:**
```typescript
{
  problem: string;
  currentStep?: 'research' | 'logs' | 'tests';
}
```

**Output:**
```typescript
{
  nextStep: 'research' | 'logs' | 'tests';
  guidance: string;
  prompt: string;
}
```

---

### midas_horizon

Expand horizontal context.

**Input:**
```typescript
{
  currentOutput: string;
  expectedOutput: string;
}
```

**Output:**
```typescript
{
  missingContext: string[];
  expandedPrompt: string;
  checklist: string[];
}
```

---

## Prompts Specification

Each prompt is exposed via MCP prompt capability.

### Session Prompts
- `master_prompt` - Initialize session
- `execution_prompt` - Start building

### Development Prompts
- `feature_planning` - Plan before implementing
- `feature_implementation` - Implement with TDD
- `bug_investigation` - Diagnose before fixing
- `bug_fix` - Fix with test-first

### Review Prompts
- `security_review` - Check for vulnerabilities
- `performance_review` - Check for bottlenecks
- `safe_refactor` - Move code safely

### Problem-Solving Prompts
- `oneshot_retry` - Retry with full context
- `tornado_trigger` - Research + Logs + Tests
- `horizon_expansion` - Add missing context

---

## Resources Specification

Resources are served via MCP resource capability.

| URI | Content |
|-----|---------|
| `midas://methodology` | METHODOLOGY.md |
| `midas://prompts` | PROMPTS.md |
| `midas://ingredients` | INGREDIENTS.md |
| `midas://user-rules` | USER_RULES.md |
| `midas://cheatsheet` | Quick reference |

---

## Implementation Notes

### Dependencies
- `@modelcontextprotocol/sdk` - MCP SDK
- `zod` - Input validation

### State Persistence
Phase state stored in `.midas/state.json` in project root.

### Error Handling
All tools return structured errors:
```typescript
{
  error: string;
  code: 'NOT_FOUND' | 'INVALID_INPUT' | 'PHASE_ERROR';
  suggestion?: string;
}
```

### Logging
Use structured logging for debugging:
```typescript
console.error(JSON.stringify({
  level: 'error',
  tool: 'midas_audit',
  message: 'Failed to scan project',
  error: err.message
}));
```
