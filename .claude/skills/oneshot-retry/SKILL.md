---
name: oneshot-retry
description: Construct a perfect retry prompt after an error
auto_trigger:
  - "oneshot"
  - "retry prompt"
  - "try again with"
  - "that didn't work"
---

# Oneshot Retry

First attempt failed? Don't just retry - construct a better prompt.

## The Oneshot Formula

```
ONESHOT = ORIGINAL + ERROR + AVOID = WORKS
```

## Template

Copy this exact structure for your retry:

```
## Original Request
[Paste what you originally asked for]

## What Happened
[Paste the exact error or unexpected result]

## What to Avoid
- Don't [specific approach that failed]
- Don't [another thing that didn't work]
- Don't [assumption that was wrong]

## Additional Context
[New information you discovered]

## Try This Instead
[Specific alternative approach if you have one]
```

## Example

### Bad Retry (Vague)
> "That didn't work, try again"

### Good Retry (Oneshot)
```
## Original Request
Create a function to parse CSV files

## What Happened
Error: Cannot read property 'split' of undefined at line 15
The function failed when the CSV had empty lines at the end.

## What to Avoid
- Don't assume all lines have content
- Don't use .split() without null checking
- Don't process the file line-by-line (memory issues with large files)

## Additional Context
- CSV files can be up to 100MB
- Empty lines are valid in our format
- Need to handle quoted fields with commas

## Try This Instead
Use a streaming CSV parser like 'csv-parse' that handles edge cases.
```

## Why Oneshot Works

1. **Context**: AI sees the full picture
2. **Constraints**: AI knows what NOT to do
3. **Direction**: AI has a starting point
4. **Efficiency**: One well-constructed prompt > 5 vague retries

## When to Use Oneshot

- ❌ First attempt failed
- ❌ Same error twice
- ❌ AI made wrong assumptions
- ❌ Output was close but not quite right

## Quick Oneshot Checklist

Before sending your retry, ensure you have:
- [ ] Original request (what you wanted)
- [ ] Error/result (what happened)
- [ ] At least 2 "don't do X" constraints
- [ ] Any new context you discovered

## Next Step

After successful Oneshot, commit your working code and continue with the next task.
