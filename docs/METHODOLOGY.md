# Golden Code Methodology

The complete methodology that Midas teaches and enforces.

## Core Philosophy

**Vibecoding** = Using AI as a pair programmer, not a replacement. You drive the vision, AI handles implementation.

**The 80/20 Rule:** AI handles ~80% of boilerplate and patterns. You handle the 20% that requires judgment, architecture, and domain knowledge.

**The Genie Mindset:** You have a genie. It will build anything — if you learn how to ask.

---

## The Two Phases

### Phase 1: Plan (Pre-Build)

```
💡 IDEA → 🔍 RESEARCH → 🧠 BRAINLIFT → 📋 PRD → 🗺️ GAMEPLAN → ⚡ BUILD
```

| Step | What It Is | Time |
|------|------------|------|
| 💡 Idea | The spark — what and why | 5 min |
| 🔍 Research | Landscape scan — what exists | 30-60 min |
| 🧠 Brainlift | Your edge — what AI doesn't know | 15-30 min |
| 📋 PRD | Requirements — what exactly to build | 30-60 min |
| 🗺️ Gameplan | Strategy — how to build it | 15-30 min |

**Total: 2-3 hours** → Saves 20-40 hours of confused building

#### Brainlift Template

```markdown
# Brainlift

## Contrarian Insights
- [What do YOU know that contradicts conventional wisdom?]
- [What have you learned from experience that AI can't know?]

## Domain Knowledge
- [Industry-specific context]
- [User behavior patterns you've observed]

## Hard-Won Lessons
- [What NOT to do based on past experience]
- [Hidden gotchas in this space]

## Current Context
- [Recent market changes]
- [Technology updates post-training-cutoff]
```

#### PRD Template

```markdown
# PRD: [Project Name]

## Overview
[One-paragraph description]

## Goals
1. [Primary goal]
2. [Secondary goal]

## Non-Goals (Equally Important!)
- [What you're explicitly NOT building]

## User Stories
- As a [user type], I want to [action] so that [benefit]

## Technical Requirements
- [Performance, security, integration requirements]

## Success Metrics
- [How you'll measure success]
```

#### Gameplan Template

```markdown
# Gameplan: [Project Name]

## Tech Stack
[Stack choice with justification]

## Architecture Overview
[High-level system design]

## Phase 1: Foundation
- [ ] Task 1
- [ ] Task 2

## Phase 2: Core Features
- [ ] Task 1
- [ ] Task 2

## Risk Mitigation
- Risk: [issue] → Mitigation: [solution]
```

---

### Phase 2: The 7-Step Process (Build)

```
        ▲
       /░\        1. USER RULES (.cursorrules)
      /░░░\           (Identity + Guardrails)
     /▓▓▓▓▓\      2. INDEX CODEBASE STRUCTURE
    /▓▓▓▓▓▓▓\         (Architecture Context)
   /▒▒▒▒▒▒▒▒▒\    3. READ SPECIFIC FILES
  /▒▒▒▒▒▒▒▒▒▒▒\       (Implementation Details)
 /█████████████\  4. RESEARCH DOCS + ONLINE
/███████████████\     (External Knowledge)
       ↓
5. WRITE CODE + TESTS → 6. RUN TESTS → 7. LOG → FIX → REPEAT
```

Each layer builds on the one above. You can't skip layers.

---

## The Three Principles

### 1. Oneshot Paradigm

When something breaks, **go back with full context** instead of patching forward.

```
❌ Prompt → Broken → Fix → More broken → Fix → Chaos
✅ Prompt → Broken → STOP → Original prompt + error log → Works
```

**The Formula:**
```
[Original Prompt] + [Error Log] + [What to Avoid] = Working Solution
```

**The 3-Strike Rule:**
```
Strike 1: "Fix this" → Still broken
Strike 2: "Try this" → Different error  
Strike 3: "What about..." → Even more broken
STOP! → Oneshot with full context → Works
```

### 2. Tornado Building

Three forces spinning together solve any problem:

```
         ┌─────────────┐
         │  RESEARCH   │
         │  + DOCS     │
         └──────┬──────┘
                │
    ╭───────────┼───────────╮
   ╱            │            ╲
┌──────────┐    │    ┌──────────┐
│   LOGS   │◄───┴───►│   TESTS  │
└────┬─────┘         └────┬─────┘
     │                    │
     ╰────────┬───────────╯
              ▼
     ┌─────────────────┐
     │ SOLUTION EMERGES│
     └─────────────────┘
```

Each feeds the others:
- RESEARCH → informs what to LOG → informs what to TEST
- Test failures → inform more RESEARCH

### 3. Horizon Thinking

AI thinks **vertical** (top-to-bottom implementation).
You provide **horizontal** (context, patterns, constraints).

```
                          YOU
                           │
     ◄─────────────────────┼─────────────────────►  HORIZONTAL
                           │
     Patterns              │              Constraints
     History               │              Integrations
     Domain Knowledge      │              Future Plans
                           │
                          ─┼─
                           │
                           │  AI
                           ▼  VERTICAL
```

**Wrong output? Widen your horizontal context.**

The Horizon Checklist:
```
□ INTEGRATIONS   "This connects to [existing system]"
□ PATTERNS       "Follow the pattern in [file]"
□ CONSTRAINTS    "Cannot use [limitation]"
□ HISTORY        "We use X because [reason]"
□ FUTURE         "Must support [planned feature] later"
□ DOMAIN         "Users typically [behavior]"
```

---

## Context Management

### The Context Pyramid

```
Layer 1: USER RULES      (Identity + Guardrails)
Layer 2: CODEBASE        (Architecture Context)
Layer 3: SPECIFIC FILES  (Implementation Details)
Layer 4: RESEARCH        (External Knowledge)
```

### When to Start Fresh

- After shipping a feature (clean slate)
- AI keeps making the same mistake
- Switching to unrelated work
- Responses get confused/repetitive

### Bringing Context into New Chats

1. Reference user rules first
2. Point to specific files with `@filename`
3. Provide horizontal context (patterns, constraints)
4. Summarize previous decisions

---

## AI Strengths vs Your Job

### Let AI Handle
- Boilerplate code
- Type definitions
- Unit tests
- Refactoring
- Documentation
- Error message parsing
- Regex patterns
- SQL queries
- CSS/styling
- API integrations

### You Control
- Architecture decisions
- Security-critical code
- Business logic
- Performance optimization
- Database schema design
- UX decisions
- Code review
- Deployment/infra

---

## Testing Loop

```
1. AI generates code
2. You READ it (actually read it)
3. Run it locally
4. Check edge cases
5. Run tests
6. Build passes
7. Only then commit
```

### Test-Driven Vibecoding

```
Step 1: "Write a test for [function]"
Step 2: "Implement to make test pass"
Step 3: Run test → verify
Step 4: "Add edge case tests"
Step 5: Iterate until solid
```

---

## Speed Techniques

### Token Efficiency
- Use file references instead of pasting
- Don't repeat context AI has
- Stop mid-generation if you have enough
- One clear ask per message

### Batch Operations
```
❌ "Create User model" → "Create Post model" → "Create Comment model"
✅ "Create these models: User, Post, Comment with these relationships..."
```

### Template Reuse
```
"Create CommentsService following the exact pattern in PostsService"
```

---

## Security Mindset

### Core Principles
- Never Trust User Input
- Defense in Depth
- Least Privilege
- Fail Securely
- Security by Design

### Cost Control (Paid Services)
- SHOW THE MATH - Calculate max monthly cost
- LIMIT EVERYTHING - No operation without maximum
- PREVENT LOOPS - Circuit breakers for recursion

---

## Common Antipatterns

| Antipattern | Fix |
|-------------|-----|
| YOLO Prompting (huge requests) | One feature at a time |
| Blind Trust | Read and test everything |
| Context Neglect | Complete context sandwich |
| Fix Forward Forever | Oneshot after 3 strikes |
| Security Afterthought | Security from day 1 |
| No Tests | Tests alongside code |
| Dependency Bloat | Ask "Can this be done without a library?" |
