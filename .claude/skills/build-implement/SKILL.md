---
name: build-implement
description: Write code with tests using test-first methodology
auto_trigger:
  - "implement feature"
  - "write code"
  - "build the"
---

# BUILD: IMPLEMENT Step

Write code that works. Test-first defines "working" before you code.

## The Golden Code Implementation Cycle

```
1. Write test first (defines success)
2. Run test (should fail)
3. Write minimal code to pass
4. Run test (should pass)
5. Refactor if needed
6. Commit
```

## What to Do

1. **Pick ONE task** from gameplan.md
2. **Write a failing test** that describes what "done" looks like
3. **Implement** just enough to pass the test
4. **Run all tests** to catch regressions
5. **Commit** with descriptive message

## Why This Matters

Test-first catches misunderstandings early. Writing the test first forces you to think about the interface before the implementation. It's faster than debugging later.

## Test-First Example

```typescript
// 1. Write the test FIRST
describe('calculateTotal', () => {
  it('should sum prices with tax', () => {
    const items = [{ price: 10 }, { price: 20 }];
    const result = calculateTotal(items, 0.1);
    expect(result).toBe(33); // 30 + 10% tax
  });
  
  it('should handle empty array', () => {
    expect(calculateTotal([], 0.1)).toBe(0);
  });
});

// 2. Run test - it fails (function doesn't exist)

// 3. Write minimal implementation
function calculateTotal(items: Item[], taxRate: number): number {
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  return subtotal * (1 + taxRate);
}

// 4. Run test - it passes

// 5. Commit: "feat: add calculateTotal with tax support"
```

## Commit Discipline

```bash
# Before starting
git status  # Check you're clean
git add -A && git commit -m "checkpoint: before implementing X"

# After completing
npm test  # Ensure all pass
npm run build  # Ensure it compiles
git add -A && git commit -m "feat: implement X with tests"
```

## Next Step

After implementing, advance to BUILD:TEST to verify with full test suite.
