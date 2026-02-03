---
name: build-debug
description: Debug systematically using the Tornado cycle
auto_trigger:
  - "debug"
  - "stuck on error"
  - "can't figure out"
---

# BUILD: DEBUG Step

When stuck, random changes make it worse. Tornado systematically narrows possibilities.

## The Tornado Cycle

```
     RESEARCH
       /   \
      /     \
   LOGS  ←→  TESTS
      \     /
       \   /
      REPEAT
```

1. **RESEARCH**: Search for the exact error message
2. **LOGS**: Add logging to see actual runtime values
3. **TESTS**: Write a minimal test that reproduces the bug
4. **REPEAT**: Until you understand the root cause

## When to Use Tornado

- Same error after 2+ fix attempts
- Error message doesn't make sense
- Fix in one place breaks another
- "It works on my machine" situations

## Research Phase

```bash
# Search GitHub for the exact error
gh search issues "[exact error message]"

# Search Stack Overflow
# Copy the error and search directly

# Check library issues
open https://github.com/[lib]/[repo]/issues
```

**What to look for:**
- Is this a known issue?
- What versions are affected?
- What workarounds exist?

## Logs Phase

```typescript
// Before the failing line
console.log('=== DEBUG ===');
console.log('input:', JSON.stringify(input, null, 2));
console.log('config:', config);
console.log('typeof value:', typeof value);

// Around the error
try {
  result = problematicFunction(input);
  console.log('success:', result);
} catch (e) {
  console.log('error:', e);
  console.log('stack:', e.stack);
  throw e;
}
```

## Tests Phase

Write the smallest possible test that fails:

```typescript
it('reproduces the bug', () => {
  // Minimal setup
  const input = { /* exact values that cause failure */ };
  
  // This should fail the same way as production
  expect(() => buggyFunction(input)).toThrow('Expected error');
});
```

**Why this works:**
- Small test = fast iteration
- Reproducible = you can fix it
- When the test passes, the bug is fixed

## Common Bug Patterns

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| "undefined is not a function" | Wrong import, typo | Check import statement |
| "Cannot read property of null" | Missing null check | Add `?.` or early return |
| Works sometimes, fails sometimes | Race condition | Add proper async/await |
| Works locally, fails in CI | Environment difference | Check env vars, paths |

## Next Step

Once the bug is fixed and tests pass, return to BUILD:IMPLEMENT for the next task.
