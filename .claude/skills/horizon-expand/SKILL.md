---
name: horizon-expand
description: Widen context when AI output doesn't fit the codebase
auto_trigger:
  - "horizon"
  - "doesn't fit"
  - "wrong pattern"
  - "not how we do it"
---

# Horizon Expansion

AI output technically works but doesn't fit your codebase? Widen the context.

## The Horizon Formula

```
Wrong Output? → Widen Context → Correct Output
```

## When to Use Horizon

- AI wrote code that works but uses wrong patterns
- AI missed existing utilities you already have
- AI created duplicate functionality
- AI used different naming conventions
- AI didn't follow your architecture

## How to Expand

### 1. Show Related Files

```
Before implementing [feature], read these files to understand our patterns:

- src/utils/helpers.ts (reusable utilities we already have)
- src/types/index.ts (type conventions)
- src/services/auth.ts (example of how we structure services)
```

### 2. Show Examples

```
Here's how we implement similar features in this codebase:

Example 1 (from src/services/user.ts):
[paste relevant code section]

Example 2 (from src/services/product.ts):
[paste relevant code section]

Please follow these patterns for the new implementation.
```

### 3. Specify Constraints

```
When implementing this:
- Use our existing logger at src/utils/logger.ts, not console.log
- Follow the Repository pattern we use in src/repositories/
- Use the existing ErrorHandler class, don't throw raw errors
- Name files in kebab-case, types in PascalCase
```

## Horizon Template

```
## Context Files to Read First
- [file1] - for [pattern/utility]
- [file2] - for [pattern/utility]

## Existing Patterns to Follow
[paste or describe 1-2 examples from your codebase]

## Constraints
- Use existing [X], don't create new
- Follow [pattern] as seen in [file]
- Match naming: [conventions]

## Now Implement
[your actual request]
```

## Common Horizon Fixes

| Problem | Expand With |
|---------|-------------|
| Wrong import style | Show tsconfig.json, existing imports |
| Duplicate utility | Link to existing util file |
| Wrong architecture | Show 2 similar services as examples |
| Wrong naming | Show naming conventions doc or examples |
| Missed types | Show types directory |

## Prevention

To avoid needing Horizon in the future:
1. Keep `.cursorrules` updated with conventions
2. Use `@codebase` or `@folder` references liberally
3. Start prompts with "Following our existing patterns in [file]..."

## Next Step

After expanding context, retry your request. The output should now fit your codebase naturally.
