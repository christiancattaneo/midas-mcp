import { z } from 'zod';

export const tornadoSchema = z.object({
  problem: z.string().describe('Description of the problem you are stuck on'),
  currentStep: z.enum(['research', 'logs', 'tests']).optional().describe('Which tornado step you just completed'),
});

export type TornadoInput = z.infer<typeof tornadoSchema>;

interface TornadoResult {
  nextStep: 'research' | 'logs' | 'tests';
  guidance: string;
  prompt: string;
}

export function triggerTornado(input: TornadoInput): TornadoResult {
  // Determine next step in the cycle
  let nextStep: 'research' | 'logs' | 'tests';
  
  if (!input.currentStep) {
    nextStep = 'research';
  } else if (input.currentStep === 'research') {
    nextStep = 'logs';
  } else if (input.currentStep === 'logs') {
    nextStep = 'tests';
  } else {
    nextStep = 'research'; // Cycle back
  }

  const stepDetails: Record<'research' | 'logs' | 'tests', { guidance: string; prompt: string }> = {
    research: {
      guidance: 'Start by researching the problem. Look up documentation, examples, and known issues.',
      prompt: `Research phase for: ${input.problem}

1. Search for documentation related to this problem
2. Look for similar issues and their solutions
3. Find best practices for this use case
4. Note any gotchas or common pitfalls

After research, run midas_tornado with currentStep='research' to move to logging.`,
    },
    logs: {
      guidance: 'Add strategic console.logs or debug statements at decision points.',
      prompt: `Logging phase for: ${input.problem}

1. Add logs at the entry point of the problematic code
2. Log the state/values at each decision point
3. Log before and after async operations
4. Include enough context to trace the flow

Run the code and analyze the logs. Then run midas_tornado with currentStep='logs' to move to testing.`,
    },
    tests: {
      guidance: 'Write tests that verify the expected behavior and help isolate the issue.',
      prompt: `Testing phase for: ${input.problem}

1. Write a test that reproduces the current (broken) behavior
2. Write a test that defines the expected (correct) behavior
3. Run both tests to confirm the failure mode
4. Use test output to narrow down the root cause

If still stuck, run midas_tornado with currentStep='tests' to cycle back to more research.`,
    },
  };

  return {
    nextStep,
    ...stepDetails[nextStep],
  };
}
