/**
 * Recursive Planning Session
 * 
 * TRM-inspired recursive refinement for AI-assisted development.
 * 
 * Based on "Less is More: Recursive Reasoning with Tiny Networks" (Jolicoeur-Martineau, 2025)
 * 
 * Core concepts:
 * - x: input/requirements (stable across iterations)
 * - z: latent reasoning state (accumulated learning, chain-of-thought)
 * - y: current answer/implementation state
 * 
 * Key patterns:
 * 1. Deep supervision: multiple refinement iterations (Nsup=16 default)
 * 2. Recursive z refinement: reasoning improves with each cycle
 * 3. Answer refinement: y improves given z
 * 4. Adaptive halting: stop when correct, don't waste iterations
 * 5. State persistence: z carries forward, preventing "forgetting"
 */

import { existsSync, mkdirSync, readFileSync } from 'fs';
import writeFileAtomic from 'write-file-atomic';
import { join } from 'path';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A single iteration snapshot
 */
export interface IterationSnapshot {
  iteration: number;
  z: string;
  y: string;
  confidence: number;
  duration?: number;
}

/**
 * Session state - the core x, y, z from TRM
 */
export interface SessionState {
  /** x: Input requirements/context (stable) */
  x: string;
  /** y: Current answer/implementation */
  y: string;
  /** z: Latent reasoning (accumulated) */
  z: string;
  /** Current iteration number */
  iteration: number;
  /** Whether session has halted */
  halted: boolean;
  /** Reason for halting (if halted) */
  haltReason: string | null;
  /** History of all iterations */
  history: IterationSnapshot[];
}

/**
 * Session configuration
 */
export interface SessionConfig {
  /** Maximum iterations (Nsup in TRM, default 16) */
  maxIterations: number;
  /** Number of latent recursions per iteration (T in TRM, default 1) */
  latentRecursions: number;
  /** Project path for persistence */
  projectPath: string;
}

/**
 * Full session object
 */
export interface RecursiveSession {
  id: string;
  state: SessionState;
  config: SessionConfig;
  createdAt: number;
}

/**
 * Halt decision
 */
export interface HaltDecision {
  shouldHalt: boolean;
  confidence: number;
  reason: string;
}

/**
 * Refinement result
 */
export interface RefinementResult {
  z: string;
  duration: number;
}

/**
 * Answer refinement result
 */
export interface AnswerRefinementResult {
  y: string;
  duration: number;
}

/**
 * Iteration result
 */
export interface IterationResult {
  state: SessionState;
  duration: number;
}

/**
 * Session run result
 */
export interface SessionRunResult {
  session: RecursiveSession;
  state: SessionState;
  totalDuration: number;
}

/**
 * Refiner function types
 */
export type ReasoningRefiner = (x: string, y: string, z: string) => string;
export type AnswerRefiner = (y: string, z: string) => string;
export type HaltChecker = (x: string, y: string, z: string) => HaltDecision;

/**
 * Session refiners configuration
 */
export interface SessionRefiners {
  reasoningRefiner: ReasoningRefiner;
  answerRefiner: AnswerRefiner;
  haltChecker: HaltChecker;
  latentRecursions?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MIDAS_DIR = '.midas';
const SESSION_FILE = 'recursive-session.json';
const MAX_REASONING_LENGTH = 8000;
const DEFAULT_MAX_ITERATIONS = 16;  // Nsup from TRM paper
const DEFAULT_LATENT_RECURSIONS = 1;  // T from TRM paper (simplified default)

// ============================================================================
// SESSION CREATION
// ============================================================================

/**
 * Generate unique session ID
 */
function generateSessionId(): string {
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a new recursive session
 */
export function createSession(options: {
  x: string;
  y?: string;
  z?: string;
  projectPath: string;
  maxIterations?: number;
  latentRecursions?: number;
  resume?: boolean;
}): RecursiveSession {
  const {
    x,
    y = '',
    z = '',
    projectPath,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    latentRecursions = DEFAULT_LATENT_RECURSIONS,
    resume = false,
  } = options;

  // Try to resume from disk if requested
  if (resume) {
    const existingState = loadSessionState(projectPath);
    if (existingState && existingState.x === x) {
      return {
        id: generateSessionId(),
        state: existingState,
        config: {
          maxIterations,
          latentRecursions,
          projectPath,
        },
        createdAt: Date.now(),
      };
    }
  }

  return {
    id: generateSessionId(),
    state: {
      x,
      y,
      z,
      iteration: 0,
      halted: false,
      haltReason: null,
      history: [],
    },
    config: {
      maxIterations,
      latentRecursions,
      projectPath,
    },
    createdAt: Date.now(),
  };
}

// ============================================================================
// STATE SERIALIZATION
// ============================================================================

/**
 * Serialize session state to JSON
 */
export function serializeState(state: SessionState): string {
  return JSON.stringify(state, null, 2);
}

/**
 * Deserialize session state from JSON
 */
export function deserializeState(json: string): SessionState {
  try {
    const data = JSON.parse(json);
    return {
      x: data.x ?? '',
      y: data.y ?? '',
      z: data.z ?? '',
      iteration: data.iteration ?? 0,
      halted: data.halted ?? false,
      haltReason: data.haltReason ?? null,
      history: data.history ?? [],
    };
  } catch {
    return {
      x: '',
      y: '',
      z: '',
      iteration: 0,
      halted: false,
      haltReason: null,
      history: [],
    };
  }
}

/**
 * Save session state to disk
 */
function saveSessionState(projectPath: string, state: SessionState): void {
  try {
    const dir = join(projectPath, MIDAS_DIR);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const path = join(dir, SESSION_FILE);
    writeFileAtomic.sync(path, serializeState(state));
  } catch {
    // Ignore save errors
  }
}

/**
 * Load session state from disk
 */
function loadSessionState(projectPath: string): SessionState | null {
  try {
    const path = join(projectPath, MIDAS_DIR, SESSION_FILE);
    if (!existsSync(path)) return null;
    const json = readFileSync(path, 'utf-8');
    return deserializeState(json);
  } catch {
    return null;
  }
}

// ============================================================================
// REFINEMENT FUNCTIONS
// ============================================================================

/**
 * Refine reasoning (z) given x, y, and current z
 * 
 * This is the core "latent recursion" from TRM:
 * z = net(x, y, z)
 */
export function refineReasoning(options: {
  x: string;
  y: string;
  z: string;
  refiner: ReasoningRefiner;
}): RefinementResult {
  const { x, y, z, refiner } = options;
  const start = Date.now();

  const newZ = refiner(x, y, z);

  return {
    z: newZ,
    duration: Date.now() - start,
  };
}

/**
 * Refine answer (y) given current y and z
 * 
 * This is the answer update from TRM:
 * y = net(y, z)
 */
export function refineAnswer(options: {
  y: string;
  z: string;
  refiner: AnswerRefiner;
}): AnswerRefinementResult {
  const { y, z, refiner } = options;
  const start = Date.now();

  const newY = refiner(y, z);

  return {
    y: newY,
    duration: Date.now() - start,
  };
}

/**
 * Merge old and new reasoning, with length cap
 */
export function mergeReasoning(oldZ: string, newZ: string): string {
  if (!oldZ) return newZ;
  if (!newZ) return oldZ;

  const merged = `${oldZ}\n${newZ}`;

  // Cap length to prevent unbounded growth
  if (merged.length > MAX_REASONING_LENGTH) {
    // Keep the most recent reasoning (tail)
    return merged.slice(-MAX_REASONING_LENGTH);
  }

  return merged;
}

// ============================================================================
// HALTING
// ============================================================================

/**
 * Check if session should halt
 */
export function checkHalt(options: {
  x: string;
  y: string;
  z: string;
  iteration?: number;
  maxIterations?: number;
  checker: HaltChecker;
}): HaltDecision {
  const { x, y, z, iteration = 0, maxIterations = 16, checker } = options;

  // Force halt at max iterations
  if (iteration >= maxIterations) {
    return {
      shouldHalt: true,
      confidence: calculateConfidence(x, y, z),
      reason: `Reached max iterations (${maxIterations})`,
    };
  }

  return checker(x, y, z);
}

/**
 * Calculate confidence based on state
 */
export function calculateConfidence(x: string, y: string, z: string): number {
  if (!y) return 0;

  // Simple heuristic: more reasoning iterations = higher confidence
  const iterations = (z.match(/iteration:/g) || []).length;
  
  // Base confidence + iteration bonus, capped at 100
  const base = 20;
  const iterationBonus = iterations * 15;

  return Math.min(100, base + iterationBonus);
}

// ============================================================================
// ITERATION
// ============================================================================

/**
 * Run a single iteration of the recursive refinement loop
 * 
 * Pattern from TRM:
 * 1. Refine z (latent reasoning) - potentially T times
 * 2. Refine y (answer) based on z
 * 3. Check if should halt
 */
export function runIteration(
  state: SessionState,
  refiners: SessionRefiners
): IterationResult {
  const {
    reasoningRefiner,
    answerRefiner,
    haltChecker,
    latentRecursions = DEFAULT_LATENT_RECURSIONS,
  } = refiners;

  const start = Date.now();

  // Clone state to avoid mutation
  let newState: SessionState = {
    ...state,
    history: [...state.history],
  };

  // Step 1: Refine z (latent reasoning) - T times
  let currentZ = newState.z;
  for (let t = 0; t < latentRecursions; t++) {
    const result = refineReasoning({
      x: newState.x,
      y: newState.y,
      z: currentZ,
      refiner: reasoningRefiner,
    });
    currentZ = result.z;
  }
  newState.z = currentZ;

  // Step 2: Refine y (answer) based on z
  const answerResult = refineAnswer({
    y: newState.y,
    z: newState.z,
    refiner: answerRefiner,
  });
  newState.y = answerResult.y;

  // Step 3: Increment iteration and record history
  newState.iteration++;
  const confidence = calculateConfidence(newState.x, newState.y, newState.z);
  newState.history.push({
    iteration: newState.iteration,
    z: newState.z,
    y: newState.y,
    confidence,
  });

  // Step 4: Check halt condition
  const haltDecision = checkHalt({
    x: newState.x,
    y: newState.y,
    z: newState.z,
    iteration: newState.iteration,
    checker: haltChecker,
  });

  if (haltDecision.shouldHalt) {
    newState.halted = true;
    newState.haltReason = haltDecision.reason;
  }

  return {
    state: newState,
    duration: Date.now() - start,
  };
}

// ============================================================================
// FULL SESSION RUN
// ============================================================================

/**
 * Run a full recursive session until halt
 * 
 * This implements the "deep supervision" loop from TRM:
 * for step in range(N_supervision):
 *   z, y = refine(x, y, z)
 *   if should_halt: break
 */
export function runSession(
  session: RecursiveSession,
  refiners: SessionRefiners
): SessionRunResult {
  const start = Date.now();
  let currentState = { ...session.state };

  // Handle zero or negative maxIterations
  if (session.config.maxIterations <= 0) {
    currentState.halted = true;
    currentState.haltReason = 'maxIterations is 0';
    saveSessionState(session.config.projectPath, currentState);
    return {
      session,
      state: currentState,
      totalDuration: Date.now() - start,
    };
  }

  // Deep supervision loop
  while (!currentState.halted && currentState.iteration < session.config.maxIterations) {
    try {
      const result = runIteration(currentState, {
        ...refiners,
        latentRecursions: refiners.latentRecursions ?? session.config.latentRecursions,
      });
      currentState = result.state;
    } catch (error) {
      // Handle refiner errors gracefully
      currentState.halted = true;
      currentState.haltReason = `Refinement error: ${error instanceof Error ? error.message : 'unknown'}`;
    }
  }

  // Ensure halted at max iterations
  if (!currentState.halted && currentState.iteration >= session.config.maxIterations) {
    currentState.halted = true;
    currentState.haltReason = `Reached max iterations (${session.config.maxIterations})`;
  }

  // Persist state
  saveSessionState(session.config.projectPath, currentState);

  return {
    session: {
      ...session,
      state: currentState,
    },
    state: currentState,
    totalDuration: Date.now() - start,
  };
}
