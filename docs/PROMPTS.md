# Expert Prompts Library

All the expert prompts that Midas exposes.

---

## Session Prompts

### master_prompt

The prompt that sets up an entire development session:

```
# Read and understand user rules, research each for complete understanding

# Ask me any clarifying questions (hallucination avoidance)

# Make todos of all tasks, use high IQ strategy for safety and 
# correctness as you create and order each, add todos for testing 
# of all code changes and additions, research documentation and 
# best practices online, don't start yet
```

**Why it works:**
1. Loads rules first (foundation)
2. Forces clarifying questions (prevents hallucination)
3. Creates structured plan (prevents chaos)
4. Doesn't start yet (planning before execution)

---

### execution_prompt

After planning, kick off execution:

```
# Continue todos, do each comprehensively and in highest IQ way possible

# Build test and write AND run test scripts then fix and repeat 
# process of writing tests and running them until all tests pass

# Short commit message once individual todos are complete and proceed
```

**Why it works:**
- Separates planning from execution
- Forces test-driven approach
- Incremental commits (clean history)

---

## Refactoring Prompts

### safe_refactor

When moving code between files:

```
SAFE REFACTORING GUIDE:

0. Comment out code on original file first
1. Split large classes into smaller, focused class files
2. Copy code verbatim - Don't modify logic when moving to new files
3. Extract logical groups - Move related functions/components together
4. Use proper exports/imports - Maintain all references between files
5. Keep dependencies intact - Ensure imports are accessible to new files
6. Test frequently - Verify functionality after each extraction
```

**Why Step 0 is crucial:** Commenting first means you can instantly restore if something breaks.

---

## Feature Development Prompts

### feature_planning

```
I need to implement [FEATURE].

1. First, read these files to understand current implementation:
   - [file1]
   - [file2]

2. Research the documentation for [LIBRARY/API]

3. Create a plan with:
   - Files to create/modify
   - Tests to write
   - Edge cases to handle

4. Don't write code yet - just the plan.
```

---

### feature_implementation

```
Now implement [FEATURE] following the plan.

Requirements:
- Write the test file FIRST
- Then implement to make tests pass
- Each function should do ONE thing
- No external dependencies unless absolutely necessary
- Add error handling for: [list edge cases]

After each file, run: npm run test
```

---

## Bug Fixing Prompts

### bug_investigation

```
There's a bug where [DESCRIBE BEHAVIOR].

Expected: [WHAT SHOULD HAPPEN]
Actual: [WHAT HAPPENS]

Here's the error log:
```
[PASTE ERROR]
```

1. Read the relevant files
2. Identify the root cause (not just symptoms)
3. Explain WHY the bug occurs
4. Don't fix yet - just diagnose
```

---

### bug_fix

```
Now fix the bug.

Requirements:
- Write a test that FAILS with the current bug
- Fix the code to make the test pass
- Verify no other tests broke
- Explain what you changed and why
```

---

## Code Review Prompts

### security_review

```
Review this code for security vulnerabilities:

[PASTE CODE or @file reference]

Check specifically for:
- SQL injection
- XSS vulnerabilities
- Authentication bypasses
- Authorization flaws
- Data exposure
- Insecure dependencies
- Hardcoded secrets

For each issue found:
1. Describe the vulnerability
2. Show the vulnerable code
3. Provide the fix
```

---

### performance_review

```
Review this code for performance issues:

[PASTE CODE or @file reference]

Check for:
- N+1 queries
- Unnecessary re-renders
- Memory leaks
- Blocking operations
- Missing caching opportunities
- Inefficient algorithms

For each issue:
1. Current complexity (O notation if applicable)
2. Impact on user experience
3. Suggested optimization
```

---

## Research Prompts

### technology_comparison

```
I need to choose between [OPTION A] and [OPTION B] for [USE CASE].

My requirements:
- [Requirement 1]
- [Requirement 2]
- [Requirement 3]

Compare them on:
1. Learning curve
2. Performance
3. Community/support
4. Cost
5. Integration with my stack: [LIST STACK]

Give me a recommendation with reasoning.
```

---

### best_practices_research

```
Research current best practices for [TOPIC] in 2024.

I'm using: [TECH STACK]

I need to know:
1. Industry standard approach
2. Common pitfalls to avoid
3. Security considerations
4. Performance implications
5. Code examples

Cite sources where possible.
```

---

## Problem-Solving Prompts

### oneshot_retry

When first attempt fails:

```
[ORIGINAL REQUEST]

Here's what happened on first attempt:
- Error: [PASTE ERROR]
- What I observed: [DESCRIBE BEHAVIOR]

What I learned:
- [Insight 1]
- [Insight 2]

Requirements for retry:
- [Specific requirement based on learning]
- [Another requirement]
- Avoid: [What NOT to do]
```

---

### tornado_trigger

When stuck on a problem:

```
I need to [implement feature / fix bug].

Before writing code:
1. RESEARCH: Look up the documentation for [relevant APIs/libraries]
2. Identify common pitfalls and best practices

Then:
3. LOGS: Add strategic console.logs at decision points
4. TESTS: Write tests that verify the expected behavior

Show me all three parts, then implement the solution.
```

---

### horizon_expansion

When output doesn't fit:

```
The output doesn't match what I need.

HORIZONTAL CONTEXT (what AI was missing):

Integrations:
- This connects to [existing system]
- Must use [existing pattern/service]

Constraints:
- Cannot use [limitation]
- Must stay under [limit]

Patterns:
- Follow the pattern in [file]
- Use [naming convention]

History:
- We use X because [reason]

Please regenerate with this context.
```

---

## The Prompt Formula

Every effective prompt follows:

```
[CONTEXT] + [TASK] + [CONSTRAINTS] + [OUTPUT FORMAT]
```

**Example:**
```
CONTEXT:     "We have a Next.js 14 app with Prisma and PostgreSQL."
TASK:        "Add rate limiting to the /api/auth endpoints."
CONSTRAINTS: "Use Redis. Max 5 attempts per minute per IP."
OUTPUT:      "Provide the middleware code and explain implementation."
```

---

## Quick Reference Phrases

| Situation | Key Phrase |
|-----------|------------|
| Prevent hallucination | "Ask me clarifying questions first" |
| Force planning | "Don't write code yet - just the plan" |
| Ensure testing | "Write the test FIRST, then implement" |
| Safe refactoring | "Comment out before moving" |
| Root cause analysis | "Explain WHY, don't just fix" |
| Current practices | "Research best practices for 2024" |
| Simplicity | "Give me the simplest possible implementation" |
| No dependencies | "Can this be done without adding a library?" |
| Focus | "Each function should do ONE thing" |
