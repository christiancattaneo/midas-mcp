---
name: plan-prd
description: Define requirements, scope, and success criteria
auto_trigger:
  - "create prd"
  - "define requirements"
  - "what should it do"
---

# PLAN: PRD Step

Turn your idea into actionable requirements. A PRD defines the finish line.

## What to Do

1. **Goals**: What must this achieve? (3-5 specific outcomes)
2. **Non-Goals**: What are you explicitly NOT building? (prevents scope creep)
3. **Requirements**: Specific, testable features
4. **User Stories**: "As a [user], I want [action] so that [benefit]"
5. **Success Metrics**: How will you measure success?

## Why This Matters

"I'll know it when I see it" means you'll never finish. Vague requirements lead to vague implementations. The PRD is your contract with yourself.

## Template

Create `docs/prd.md`:

```markdown
# Product Requirements Document

## Overview
[One paragraph summary]

## Goals
1. [Specific, measurable goal]
2. [Specific, measurable goal]
3. [Specific, measurable goal]

## Non-Goals (Explicitly Out of Scope)
- [Thing you won't build]
- [Thing you won't build]

## Requirements

### Must Have (P0)
- [ ] [Feature] - [Why essential]
- [ ] [Feature] - [Why essential]

### Should Have (P1)
- [ ] [Feature] - [Why important]

### Nice to Have (P2)
- [ ] [Feature] - [Why nice]

## User Stories

### Primary User: [Persona Name]
- As a [user type], I want to [action] so that [benefit]
- As a [user type], I want to [action] so that [benefit]

## Technical Requirements
- Performance: [e.g., <100ms response time]
- Compatibility: [e.g., Node 18+, modern browsers]
- Security: [e.g., no secrets in code, auth required]

## Success Metrics
- [Metric 1]: [Target]
- [Metric 2]: [Target]

## Timeline
- MVP: [Date/milestone]
- V1: [Date/milestone]
```

## Next Step

Once PRD is complete, advance to PLAN:GAMEPLAN to sequence the work.
