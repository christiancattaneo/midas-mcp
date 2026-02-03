---
name: build-test
description: Run and fix tests, add edge cases
auto_trigger:
  - "run tests"
  - "fix failing tests"
  - "test coverage"
---

# BUILD: TEST Step

Your change might break something unrelated. Full suite catches regressions.

## What to Do

1. **Run all tests**: Not just the ones you wrote
2. **Fix any failures**: Your change broke something
3. **Add edge cases**: What inputs could break this?
4. **Check coverage**: Are critical paths tested?

## Why This Matters

A failing test is a gift - it caught a bug before users did. The longer you wait to run tests, the harder it is to find what broke.

## Commands

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- path/to/file.test.ts

# Run tests in watch mode (during development)
npm test -- --watch
```

## Edge Cases Checklist

For every function, consider:

- [ ] **Empty input**: `[]`, `""`, `null`, `undefined`
- [ ] **Single item**: Array with one element
- [ ] **Large input**: Performance with 1000+ items
- [ ] **Invalid types**: What if someone passes wrong type?
- [ ] **Boundary values**: 0, -1, MAX_INT, empty string
- [ ] **Concurrent access**: Race conditions?
- [ ] **Error states**: Network failure, disk full, permission denied

## Example Edge Case Tests

```typescript
describe('parseConfig', () => {
  it('should handle valid config', () => {
    expect(parseConfig({ port: 3000 })).toEqual({ port: 3000 });
  });
  
  // Edge cases
  it('should handle empty object', () => {
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG);
  });
  
  it('should handle null', () => {
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG);
  });
  
  it('should reject invalid port', () => {
    expect(() => parseConfig({ port: -1 })).toThrow('Invalid port');
  });
  
  it('should reject port > 65535', () => {
    expect(() => parseConfig({ port: 99999 })).toThrow('Invalid port');
  });
});
```

## When Tests Fail

1. **Read the error carefully** - What's expected vs actual?
2. **Don't change the test first** - The test might be right
3. **Add a console.log** to see actual values
4. **Check recent changes** - `git diff` shows what you touched

## Next Step

When all tests pass, advance to BUILD:DEBUG only if there are issues. Otherwise, move to SHIP:REVIEW.
