import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerGrowPrompts(server: McpServer): void {
  // User feedback analysis
  server.prompt(
    'analyze_feedback',
    'Analyze user feedback to identify patterns and priorities',
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

1. **Categorize** each piece of feedback:
   - Bug report
   - Feature request
   - UX issue
   - Performance complaint
   - Praise

2. **Identify patterns** - What themes appear multiple times?

3. **Prioritize** using impact vs effort matrix:
   - Quick wins (low effort, high impact)
   - Major projects (high effort, high impact)
   - Nice to haves (low effort, low impact)
   - Avoid (high effort, low impact)

4. **Recommend** top 3 actions for next iteration.`,
          },
        },
      ],
    })
  );

  // Metrics review
  server.prompt(
    'metrics_review',
    'Review product metrics to identify opportunities',
    { metrics: z.string().optional().describe('Key metrics data if available') },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Review product metrics and health:

${args.metrics ? `Data:\n${args.metrics}\n\n---` : ''}

Analyze (or help me set up tracking for):

1. **Acquisition** - How users find us
2. **Activation** - First value moment
3. **Retention** - Users coming back
4. **Revenue** - Monetization health
5. **Referral** - Viral coefficient

For each stage:
- What's the current state?
- What's the bottleneck?
- What's one experiment to try?

Provide specific, actionable recommendations.`,
          },
        },
      ],
    })
  );

  // Iteration planning
  server.prompt(
    'plan_iteration',
    'Plan the next development iteration based on learnings',
    {},
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Plan the next iteration:

1. **Retrospective**
   - What worked well last iteration?
   - What didn't work?
   - What did we learn?

2. **Scope Definition**
   - What's the single most important thing to build next?
   - What's explicitly OUT of scope?
   - What's the hypothesis we're testing?

3. **Success Criteria**
   - How will we know this succeeded?
   - What metrics will we track?
   - What's the minimum viable version?

4. **Return to Plan Phase**
   - Update brainlift with new learnings
   - Revise PRD for next feature
   - Create new gameplan

Output a clear plan I can execute.`,
          },
        },
      ],
    })
  );

  // Performance optimization
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
