import { z } from 'zod';

export const oneshotSchema = z.object({
  originalPrompt: z.string().describe('The original prompt that failed'),
  error: z.string().describe('The error message or description of what went wrong'),
  learnings: z.array(z.string()).optional().describe('What you learned from the failure'),
});

export type OneshotInput = z.infer<typeof oneshotSchema>;

interface OneshotResult {
  prompt: string;
}

export function constructOneshot(input: OneshotInput): OneshotResult {
  const learningsSection = input.learnings && input.learnings.length > 0
    ? `\nWhat I learned:\n${input.learnings.map(l => `- ${l}`).join('\n')}`
    : '';

  const prompt = `${input.originalPrompt}

---

Previous attempt failed with:
\`\`\`
${input.error}
\`\`\`
${learningsSection}

Requirements for this retry:
- Avoid the approach that caused the above error
- Explain your reasoning before implementing
- Test the solution before considering it complete`;

  return { prompt };
}
