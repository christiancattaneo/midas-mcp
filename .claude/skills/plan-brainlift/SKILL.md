---
name: plan-brainlift
description: Document your unique insights and mental models
auto_trigger:
  - "create brainlift"
  - "document context"
  - "what do I know"
---

# PLAN: BRAINLIFT Step

Extract what YOU know that the AI doesn't. This is your competitive advantage.

## What to Do

1. **Domain Knowledge**: What do you know about this problem space?
2. **User Insights**: What have you learned from real users?
3. **Technical Constraints**: What limitations affect the solution?
4. **Past Failures**: What approaches have you tried that didn't work?
5. **Mental Models**: How do you think about this problem?

## Why This Matters

AI read the internet. You have specific context it doesn't. The brainlift document becomes context for every future AI session, making suggestions more relevant.

## Template

Create `docs/brainlift.md`:

```markdown
# Brainlift: [Project Name]

## Problem Statement
[Clear, specific description of the problem]

## Target User
[Specific persona - not "developers" but "solo developers building MVPs"]

## Why Now
[What changed - new API, market shift, personal itch]

## Domain Knowledge
[Industry-specific insights, jargon, constraints]

## Technical Context
- Language: [e.g., TypeScript]
- Environment: [e.g., Node.js, browser, both]
- Key Dependencies: [e.g., React, Express]
- Constraints: [e.g., must work offline, <100ms response]

## What I Know That Others Don't
[Your unique insights - THIS IS THE KEY SECTION]
- [Insight 1]
- [Insight 2]

## Anti-Patterns to Avoid
[What NOT to do based on your experience]

## Success Criteria
[How will you know this is working?]
```

## Next Step

Once brainlift.md is complete, advance to PLAN:PRD to define requirements.
