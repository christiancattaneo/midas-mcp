---
name: plan-research
description: Scan the landscape - what exists, what works, what fails
auto_trigger:
  - "research alternatives"
  - "what already exists"
  - "competitor analysis"
---

# PLAN: RESEARCH Step

Before building, study what exists. Don't reinvent wheels.

## What to Do

1. **Find Existing Solutions**: Search GitHub, npm, PyPI for similar projects
2. **Study What Works**: Which alternatives are popular? Why?
3. **Identify Gaps**: What do existing solutions miss?
4. **Note Dependencies**: What libraries/APIs will you need?

## Why This Matters

Someone has solved 80% of this already. Libraries, patterns, and anti-patterns exist. Research is cheap; rebuilding from scratch is expensive.

## Research Checklist

```markdown
## Research Notes

### Existing Solutions
- [ ] Solution A: [link] - Pros: X, Cons: Y
- [ ] Solution B: [link] - Pros: X, Cons: Y
- [ ] Solution C: [link] - Pros: X, Cons: Y

### What Works Well
- [Pattern/approach that successful projects use]

### Gaps I Can Fill
- [What existing solutions miss that I can address]

### Dependencies to Consider
- [ ] [Library 1] - for [purpose]
- [ ] [Library 2] - for [purpose]

### Anti-Patterns to Avoid
- [Common mistake from research]
```

## Commands to Run

```bash
# Search npm for similar packages
npm search [keywords]

# Check GitHub trending in your space
gh repo list --topic=[your-topic] --sort=stars

# Read docs of key dependencies
```

## Next Step

Once you understand the landscape, move to PLAN:PRD to define requirements.
