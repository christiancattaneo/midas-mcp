import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerGrowPrompts(server: McpServer): void {
  // MONITOR step - Production health tracking
  server.prompt(
    'production_health',
    'Review production health metrics and error rates',
    { errorLogs: z.string().optional().describe('Paste recent error logs or metrics') },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Analyze production health:

${args.errorLogs ? `Recent data:\n${args.errorLogs}\n\n---` : ''}

Check:
1. **Error rates** - What's breaking? Frequency? Patterns?
2. **Latency** - p50, p95, p99 response times
3. **Uptime** - Any outages? Duration?
4. **Resources** - CPU, memory, disk usage trends

For each issue:
- Severity (critical/high/medium/low)
- Affected users/requests
- Recommended action

Output a health report with priorities.`,
          },
        },
      ],
    })
  );

  // COLLECT step - Gather feedback
  server.prompt(
    'collect_feedback',
    'Analyze user feedback to identify patterns',
    { feedback: z.string().describe('User feedback to analyze (paste reviews, comments, tickets)') },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Analyze this user feedback:

${args.feedback}

---

1. **Categorize** each piece:
   - Bug report
   - Feature request
   - UX friction
   - Performance complaint
   - Praise

2. **Identify patterns** - Themes appearing multiple times

3. **Extract quotes** - Most impactful user statements

4. **Sentiment** - Overall positive/negative/neutral breakdown

Output a feedback summary with key insights.`,
          },
        },
      ],
    })
  );

  // TRIAGE step - Prioritize issues
  server.prompt(
    'triage_bugs',
    'Prioritize bugs and issues by impact and effort',
    { issues: z.string().describe('List of bugs/issues to triage') },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Triage these issues:

${args.issues}

---

For each issue, determine:
1. **Impact** (1-5): Users affected, severity, revenue impact
2. **Effort** (1-5): Complexity, risk, dependencies
3. **Urgency**: Is it getting worse?

Then categorize:
- **P0 Critical**: Fix immediately (blocking users, security, data loss)
- **P1 High**: Fix this sprint (major functionality broken)
- **P2 Medium**: Schedule soon (degraded experience)
- **P3 Low**: Backlog (minor annoyance)

Output a prioritized list with recommended order.`,
          },
        },
      ],
    })
  );

  // RETROSPECT step - Review the cycle
  server.prompt(
    'sprint_retro',
    'Conduct a sprint/cycle retrospective',
    { 
      accomplishments: z.string().optional().describe('What was shipped'),
      issues: z.string().optional().describe('Problems encountered'),
    },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Sprint retrospective:

${args.accomplishments ? `Shipped:\n${args.accomplishments}\n` : ''}
${args.issues ? `Issues:\n${args.issues}\n` : ''}
---

Guide me through:

1. **What worked well?**
   - Processes that helped
   - Tools that saved time
   - Team dynamics that clicked

2. **What didn't work?**
   - Blockers we hit
   - Time wasted on
   - Communication gaps

3. **What surprised us?**
   - Unexpected wins
   - Hidden complexity
   - User behavior we didn't expect

4. **Action items**
   - One thing to START doing
   - One thing to STOP doing
   - One thing to CONTINUE doing

Output concrete action items for next cycle.`,
          },
        },
      ],
    })
  );

  // PLAN_NEXT step - Scope next iteration
  server.prompt(
    'plan_next_cycle',
    'Plan the next development cycle with clear scope',
    { learnings: z.string().optional().describe('Key learnings from retro') },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Plan next cycle:

${args.learnings ? `Learnings:\n${args.learnings}\n\n---` : ''}

Define:

1. **Hypothesis**
   - What are we testing?
   - What do we believe will happen?
   - How will we validate?

2. **Scope**
   - Single most important thing to build
   - Explicit non-goals (what we WON'T do)
   - Minimum viable version

3. **Success metrics**
   - How do we measure success?
   - Target numbers
   - Timeline

4. **Risks**
   - What could go wrong?
   - Mitigation strategies
   - Kill criteria (when to pivot)

Output a one-page cycle plan.`,
          },
        },
      ],
    })
  );

  // LOOP step - Return to PLAN with context
  server.prompt(
    'cycle_handoff',
    'Prepare context for next PLAN phase',
    {},
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Prepare for next PLAN phase:

Create handoff document:

1. **Context summary**
   - What was built this cycle
   - Current state of the product
   - Active users/usage metrics

2. **Lessons learned**
   - Technical decisions that worked/didn't
   - Process improvements needed
   - Knowledge to preserve

3. **Carry forward**
   - Unresolved bugs (prioritized)
   - Feature requests (prioritized)
   - Technical debt to address

4. **Brainlift updates**
   - New edge knowledge gained
   - Updated constraints
   - Revised assumptions

Output a handoff doc ready to inform the next PLAN phase.`,
          },
        },
      ],
    })
  );

  // Performance optimization (keep existing)
  server.prompt(
    'optimize_performance',
    'Identify and fix performance bottlenecks',
    { area: z.string().optional().describe('Specific area to optimize (frontend/backend/db)') },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Optimize performance${args.area ? ` in ${args.area}` : ''}:

1. **Measure First**
   - What are current response times?
   - Where are the slowest operations?
   - What's the baseline to beat?

2. **Identify Bottlenecks**
   - Database queries (N+1, missing indexes)
   - Network requests (waterfalls, large payloads)
   - Client-side (re-renders, bundle size)
   - Server-side (blocking operations, memory)

3. **Prioritize Fixes**
   - Focus on user-facing impact
   - Start with biggest wins
   - Avoid premature optimization

4. **Verify Improvements**
   - Before/after measurements
   - No regressions introduced
   - Document changes

Analyze the codebase and provide specific optimizations.`,
          },
        },
      ],
    })
  );
}
