---
name: plan-gameplan
description: Break the build into ordered, actionable tasks
auto_trigger:
  - "create gameplan"
  - "plan the build"
  - "break down tasks"
---

# PLAN: GAMEPLAN Step

Sequence work so you're never blocked waiting for yourself.

## What to Do

1. **Identify Dependencies**: What must be built first?
2. **Order Tasks**: Sequence by dependency, not preference
3. **Size Tasks**: Each task completable in one session (2-4 hours max)
4. **Define Done**: Clear completion criteria for each task

## Why This Matters

Some things depend on other things. A gameplan prevents the "where was I?" problem and ensures you can measure progress objectively.

## Template

Create `docs/gameplan.md`:

```markdown
# Gameplan

## Tech Stack
- Runtime: [e.g., Node.js 20]
- Language: [e.g., TypeScript 5.x]
- Framework: [e.g., Express, React]
- Database: [e.g., SQLite, Postgres]
- Testing: [e.g., Vitest, Jest]

## Phase 1: Foundation
- [ ] Task 1.1: [Description] - **Done when**: [criteria]
- [ ] Task 1.2: [Description] - **Done when**: [criteria]

## Phase 2: Core Features
- [ ] Task 2.1: [Description] - **Done when**: [criteria]
- [ ] Task 2.2: [Description] - **Done when**: [criteria]

## Phase 3: Polish
- [ ] Task 3.1: [Description] - **Done when**: [criteria]

## Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| [Risk] | [High/Med/Low] | [Plan B] |

## Open Questions
- [ ] [Question that needs answering]
```

## Task Sizing Guidelines

- **Too big**: "Build the auth system" (multi-day)
- **Just right**: "Add JWT token generation with tests" (2-4 hours)
- **Too small**: "Add a comment" (minutes)

## Next Step

Once gameplan.md exists with ordered tasks, advance to BUILD:RULES.

---

**Tip**: The first task should be "Set up project with build/test/lint scripts" - always start with a green CI.
