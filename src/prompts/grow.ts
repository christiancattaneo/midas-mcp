import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * GROW phase prompts - focused on the graduation checklist
 * These help users take action on the 6 growth steps
 */
export function registerGrowPrompts(server: McpServer): void {
  // Announce - Help craft launch posts
  server.prompt(
    'announce_launch',
    'Craft a launch announcement for your project',
    { 
      projectName: z.string().describe('Name of your project'),
      oneLiner: z.string().describe('One sentence describing what it does'),
      platform: z.string().optional().describe('Target platform: reddit, twitter, discord, hackernews, producthunt'),
    },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Help me announce "${args.projectName}" on ${args.platform || 'social media'}.

One-liner: ${args.oneLiner}

Write 3 versions:
1. **Short** (under 280 chars for Twitter/X)
2. **Medium** (Reddit/Discord post - 2-3 paragraphs)
3. **Long** (Hacker News/Product Hunt - full story)

Each version should:
- Lead with the problem, not the solution
- Be genuine, not salesy
- Include a clear call to action
- Avoid buzzwords and hype

Match the platform's tone and culture.`,
          },
        },
      ],
    })
  );

  // Network - Help with outreach messages
  server.prompt(
    'outreach_message',
    'Write a personal outreach message for potential users',
    {
      projectName: z.string().describe('Name of your project'),
      targetPerson: z.string().describe('Who you are reaching out to (role/context)'),
      connection: z.string().optional().describe('How you know them or why you chose them'),
    },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Write a personal DM to introduce "${args.projectName}" to ${args.targetPerson}.

${args.connection ? `Connection: ${args.connection}` : ''}

The message should:
- Be genuinely helpful, not pitchy
- Acknowledge their time is valuable
- Explain why you thought of THEM specifically
- Make it easy to say no
- Be under 150 words

Write 2 versions: one casual, one more professional.`,
          },
        },
      ],
    })
  );

  // Feedback - Help ask good questions
  server.prompt(
    'feedback_questions',
    'Generate questions to ask early users',
    { projectName: z.string().describe('Name of your project') },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Create a short user feedback script for "${args.projectName}".

Generate 5-7 questions that:
1. Start with their experience (open-ended)
2. Identify confusion points
3. Uncover missing features
4. Find what they love
5. End with whether they'd recommend it

Rules:
- No leading questions
- No yes/no questions
- Ask about behavior, not opinions
- Keep it under 5 minutes total

Also provide 3 follow-up probes for when they give short answers.`,
          },
        },
      ],
    })
  );

  // Proof - Help collect and display social proof
  server.prompt(
    'testimonial_request',
    'Write a testimonial request message',
    {
      projectName: z.string().describe('Name of your project'),
      userName: z.string().optional().describe('Name of the user you are asking'),
    },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Write a message asking ${args.userName || 'a user'} for a testimonial about "${args.projectName}".

The message should:
- Thank them for using the product
- Make it easy (suggest 2-3 prompts they can respond to)
- Offer to write a draft they can edit
- Ask permission to use their name/photo
- Be gracious if they decline

Also suggest:
- Where to display testimonials (landing page, GitHub, etc.)
- How to screenshot/document usage metrics`,
          },
        },
      ],
    })
  );

  // Iterate - Help prioritize feedback
  server.prompt(
    'prioritize_feedback',
    'Turn user feedback into actionable improvements',
    { feedback: z.string().describe('Raw user feedback to analyze') },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Analyze this user feedback and prioritize improvements:

${args.feedback}

---

1. **Categorize** each piece:
   - Bug (broken functionality)
   - UX friction (confusing/hard to use)
   - Missing feature (requested addition)
   - Performance (slow/resource issues)

2. **Identify the ONE thing** to fix first:
   - Highest impact (affects most users)
   - Lowest effort (quick win)
   - Most urgent (blocking adoption)

3. **Write a specific task** for that improvement:
   - What exactly to change
   - How to verify it's fixed
   - What to ignore for now`,
          },
        },
      ],
    })
  );

  // Content - Help write about the project
  server.prompt(
    'write_launch_post',
    'Write a "what I learned building X" post',
    {
      projectName: z.string().describe('Name of your project'),
      buildTime: z.string().optional().describe('How long it took to build'),
      techStack: z.string().optional().describe('Main technologies used'),
    },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Help me write a "What I learned building ${args.projectName}" post.

${args.buildTime ? `Build time: ${args.buildTime}` : ''}
${args.techStack ? `Tech stack: ${args.techStack}` : ''}

Create an outline covering:
1. **The problem** - Why I built this
2. **The journey** - Key decisions and pivots
3. **Mistakes** - What I'd do differently
4. **Wins** - What worked well
5. **Advice** - For others building similar things

Make it:
- Honest and vulnerable (not a humble brag)
- Specific with concrete examples
- Useful for readers (actionable takeaways)
- Personal but not navel-gazing

Suggest 3 title options.`,
          },
        },
      ],
    })
  );

  // Bonus: Quick wins prompt
  server.prompt(
    'growth_quick_wins',
    'Get quick wins to grow your project this week',
    { projectName: z.string().describe('Name of your project') },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Give me 5 quick wins to grow "${args.projectName}" this week.

Each should be:
- Completable in under 1 hour
- Free (no paid ads)
- Measurable (I can see if it worked)

Focus on:
- Places my target users already hang out
- Ways to get feedback loops going
- Low-effort, high-visibility actions

For each, give me:
1. The action (specific, not vague)
2. Expected outcome
3. How to measure success`,
          },
        },
      ],
    })
  );
}
