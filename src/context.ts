/**
 * Context Utilities for Midas
 * 
 * Token estimation for prompt building.
 * 
 * Note: Context compression via system/user prompt split is handled in analyzer.ts.
 * The system prompt contains stable methodology (cached by Claude API).
 * The user prompt contains dynamic project state (not cached).
 */

// Token estimation (rough: 1 token ≈ 4 chars for English)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
