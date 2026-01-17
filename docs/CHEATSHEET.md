# Cheat Sheet

Quick reference for the vibecoding methodology.

---

## The Two Phases

**Phase 1: Plan (Pre-Build)**
```
Idea → Research → Brainlift → PRD → Gameplan
```

**Phase 2: Build (7-Step Process)**
```
1. User Rules → 2. Index Codebase → 3. Read Files → 4. Research
5. Write Code + Tests → 6. Run Tests → 7. Log → Fix → Repeat
```

---

## The Three Principles

**Oneshot Paradigm**
```
When broken → STOP → Original prompt + error log → Works
3 strikes = restart with full context
```

**Tornado Building**
```
Research + Logs + Tests = Solution
Each feeds the others until solved
```

**Horizon Thinking**
```
AI = Vertical (implementation)
You = Horizontal (context, patterns, constraints)
Wrong output? Widen your horizontal.
```

---

## Key Prompts

**Session Start:**
```
Read user rules. Ask clarifying questions. Make todos. Don't start yet.
```

**Execution:**
```
Continue todos. Write AND run tests. Commit when done.
```

**When Stuck:**
```
Research [topic]. Add logs at [points]. Write tests for [behavior].
```

---

## The Prompt Formula

```
PROMPT = CONTEXT + TASK + CONSTRAINTS + OUTPUT
```

---

## Quick Fixes

| Problem | Solution |
|---------|----------|
| AI hallucinating | "Ask clarifying questions first" |
| Generic output | Add more horizontal context |
| Broken code | Oneshot: original + error + avoid |
| Stuck on bug | Spin the Tornado |
| Code doesn't fit | Check patterns to follow |

---

## AI Strengths

Let AI handle: boilerplate, types, tests, refactoring, docs, regex, SQL, CSS, API integrations

You control: architecture, security, business logic, performance, UX, code review, deployment

---

## Antipatterns

| Avoid | Instead |
|-------|---------|
| YOLO prompting | One feature at a time |
| Blind trust | Read and test everything |
| Context neglect | Complete context sandwich |
| Fix forward forever | Oneshot after 3 strikes |
| Security afterthought | Security from day 1 |
| No tests | Tests alongside code |

---

## Recovery Phrases

| Problem | Say |
|---------|-----|
| Wrong approach | "Let's try a different approach. What if we..." |
| Too complex | "Simplify this. Give me the minimal version." |
| Missing context | "Here's more context: [paste]" |
| Going in circles | "Let's step back. What's the core problem?" |

---

## Speed Tips

- Use `@file` references instead of pasting
- Batch similar operations
- Template reuse: "Follow the pattern in [file]"
- Stop mid-generation if you have enough (Esc)
- One clear ask per message
