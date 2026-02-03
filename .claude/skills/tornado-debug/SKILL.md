---
name: tornado-debug
description: Systematic debugging - Research + Logs + Tests cycle
auto_trigger:
  - "tornado"
  - "stuck debugging"
  - "same error again"
  - "tried everything"
---

# Tornado Debugging

You've hit the same error multiple times. Random fixes won't work. Time for systematic debugging.

## The Tornado Formula

```
TORNADO = RESEARCH + LOGS + TESTS → REPEAT
```

## Step 1: RESEARCH (10 minutes)

Search for the **exact** error message:

```bash
# GitHub Issues
gh search issues "[paste exact error]"

# Stack Overflow (in browser)
site:stackoverflow.com "[paste exact error]"

# Library docs
open https://[library].dev/docs/troubleshooting
```

**Look for:**
- ✅ Same error, solved issue → try their solution
- ✅ Same error, open issue → workaround in comments?
- ✅ Version-specific → check your version
- ❌ No results → your bug is novel (rare)

## Step 2: LOGS (5 minutes)

Add strategic logging around the failure point:

```typescript
// Log inputs
console.log('=== TORNADO DEBUG ===');
console.log('function:', 'problematicFunction');
console.log('args:', JSON.stringify(args, null, 2));

// Log state
console.log('this.state:', this.state);
console.log('env:', process.env.NODE_ENV);

// Log the failure
try {
  const result = problematicFunction(args);
  console.log('result:', result);
  console.log('typeof:', typeof result);
} catch (e) {
  console.log('CAUGHT:', e.message);
  console.log('STACK:', e.stack);
  console.log('ARGS WERE:', args);
}
```

## Step 3: TESTS (15 minutes)

Write a minimal reproduction:

```typescript
describe('bug reproduction', () => {
  it('fails with specific input', () => {
    // EXACT values from your logs
    const input = { /* paste from logs */ };
    
    // What SHOULD happen
    expect(buggyFunction(input)).toBe(expected);
    
    // If it throws, test that:
    // expect(() => buggyFunction(input)).toThrow('specific error');
  });
});
```

**Run it:**
```bash
npm test -- --grep "bug reproduction" --watch
```

Now iterate: change code → test runs → see result.

## Step 4: REPEAT

After each cycle, you know more:
- Cycle 1: You know the exact error message
- Cycle 2: You know the input that causes it
- Cycle 3: You know which line fails
- Cycle 4: You understand why → you can fix it

## Common Breakthroughs

| After Research | Try This |
|----------------|----------|
| "Known issue in v2.3" | Upgrade/downgrade dependency |
| "Requires config option X" | Add missing configuration |
| "Bug in library" | Workaround or fork |

| After Logs | Try This |
|------------|----------|
| Input is undefined | Trace where it should come from |
| Type is wrong | Check where type changes |
| Called with old value | Stale closure or async issue |

| After Tests | Try This |
|-------------|----------|
| Test passes, production fails | Environment difference |
| Test fails same way | Minimal fix iterations |

## Exit Criteria

You're done with Tornado when:
- ✅ Test passes
- ✅ You can explain WHY it was broken
- ✅ You can explain WHY your fix works

Now commit and move on.
