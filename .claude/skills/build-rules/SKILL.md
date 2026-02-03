---
name: build-rules
description: Read and understand project conventions before coding
auto_trigger:
  - "start building"
  - "read cursorrules"
  - "understand conventions"
---

# BUILD: RULES Step

Every project has conventions. Reading first prevents "works but doesn't fit" code.

## What to Do

1. **Read .cursorrules**: Understand project conventions
2. **Check package.json scripts**: Know how to build, test, lint
3. **Review existing patterns**: Look at existing code style
4. **Note constraints**: What tools, versions, patterns are required?

## Why This Matters

Building without knowing the rules wastes time. You'll write code that technically works but violates project conventions, requiring rewrites.

## Create .cursorrules

If `.cursorrules` doesn't exist, create it:

```markdown
# Project Rules

## Language & Runtime
- TypeScript with strict mode
- Node.js 20+
- ES Modules (type: "module")

## Code Style
- Use explicit return types on exported functions
- Prefer `type` imports: `import type { X } from 'y'`
- No `any` - use `unknown` and narrow

## File Naming
- kebab-case for files (my-component.ts)
- PascalCase for types/interfaces
- camelCase for functions/variables

## Testing
- Co-locate tests: `foo.ts` → `foo.test.ts`
- Use descriptive test names
- Test behavior, not implementation

## Git
- Conventional commits: feat:, fix:, docs:, refactor:
- Commit before AND after significant changes

## What NOT to Do
- No console.log in production code (use logger)
- No hardcoded secrets
- No synchronous file operations in async contexts
```

## Commands to Run

```bash
# Check what scripts exist
cat package.json | jq '.scripts'

# Run build to ensure it works
npm run build

# Run tests to see current state
npm test

# Run lint to see style requirements
npm run lint
```

## Next Step

Once you understand the rules and `.cursorrules` exists, advance to BUILD:INDEX.
