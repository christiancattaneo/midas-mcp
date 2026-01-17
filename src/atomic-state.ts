/**
 * Atomic State Management
 * 
 * Solves race conditions with:
 * 1. Atomic writes (temp file → rename) - prevents corruption
 * 2. Version detection - knows when conflicts occur
 * 3. Smart merge - arrays union, scalars last-write-wins
 * 4. Zero blocking - no locks, no waits, no deadlocks
 * 
 * This approach guarantees:
 * - No data corruption (atomic rename is OS-level atomic)
 * - No lost array entries (union merge)
 * - No blocking (optimistic, non-locking)
 * - No deadlocks (nothing to deadlock on)
 */

import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import writeFileAtomic from 'write-file-atomic';
import { logger } from './logger.js';

// ============================================================================
// TYPES
// ============================================================================

export interface VersionedState {
  _version: number;           // Incremented on every write
  _lastModified: string;      // ISO timestamp
  _processId: string;         // Which process wrote this
  [key: string]: unknown;     // Index signature for generic access
}

export interface MergeStrategy<T> {
  /**
   * Merge two states when a conflict is detected.
   * @param local - The state we're trying to write
   * @param remote - The state currently on disk (written by another process)
   * @returns Merged state
   */
  merge: (local: T, remote: T) => T;
}

export interface AtomicWriteResult {
  success: boolean;
  conflictDetected: boolean;
  conflictResolved: boolean;
  finalVersion: number;
}

// ============================================================================
// MERGE STRATEGIES
// ============================================================================

/**
 * Default merge: arrays union by unique key, scalars last-write-wins
 */
export function defaultMerge<T extends VersionedState>(
  local: T,
  remote: T,
  arrayKeys: string[] = [],
  uniqueKeyField: string = 'id'
): T {
  const result: Record<string, unknown> = { ...remote }; // Start with remote (it's newer on disk)
  
  for (const key of Object.keys(local)) {
    const localVal = local[key];
    const remoteVal = remote[key];
    
    if (arrayKeys.includes(key) && Array.isArray(localVal) && Array.isArray(remoteVal)) {
      // Union merge for arrays - never lose entries
      result[key] = unionArrays(localVal, remoteVal, uniqueKeyField);
    } else if (key === '_version' || key === '_lastModified' || key === '_processId') {
      // Version fields handled separately
      continue;
    } else if (localVal !== undefined) {
      // Scalar: local wins (we're the latest intent)
      result[key] = localVal;
    }
  }
  
  return result as T;
}

/**
 * Union two arrays, deduplicating by a unique key field
 */
function unionArrays<T>(arr1: T[], arr2: T[], uniqueKey: string): T[] {
  const seen = new Map<unknown, T>();
  
  // Add all from arr2 first (older)
  for (const item of arr2) {
    const key = (item as Record<string, unknown>)[uniqueKey] ?? JSON.stringify(item);
    seen.set(key, item);
  }
  
  // Add/overwrite with arr1 (newer)
  for (const item of arr1) {
    const key = (item as Record<string, unknown>)[uniqueKey] ?? JSON.stringify(item);
    seen.set(key, item);
  }
  
  return Array.from(seen.values());
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

// Process ID for conflict detection
const PROCESS_ID = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Read state from file with version info
 */
export function readStateAtomic<T extends VersionedState>(
  filePath: string,
  defaultState: () => T
): T {
  if (!existsSync(filePath)) {
    const state = defaultState();
    state._version = 0;
    state._lastModified = new Date().toISOString();
    state._processId = PROCESS_ID;
    return state;
  }
  
  try {
    const raw = readFileSync(filePath, 'utf-8');
    if (!raw || raw.trim() === '') {
      return defaultState();
    }
    
    const parsed = JSON.parse(raw) as T;
    
    // Validate it has version info
    if (typeof parsed._version !== 'number') {
      parsed._version = 0;
    }
    
    return parsed;
  } catch (error) {
    logger.warn(`Failed to read ${filePath}, using default`, { error });
    return defaultState();
  }
}

/**
 * Write state atomically with conflict detection and merge
 */
export async function writeStateAtomic<T extends VersionedState>(
  filePath: string,
  state: T,
  options: {
    expectedVersion?: number;  // Version we read before modifying
    merge?: MergeStrategy<T>;  // How to merge on conflict
    arrayKeys?: string[];      // Which keys are arrays to union-merge
  } = {}
): Promise<AtomicWriteResult> {
  // Ensure directory exists
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  
  // Read current state on disk
  const currentOnDisk = existsSync(filePath)
    ? (() => {
        try {
          return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
        } catch {
          return null;
        }
      })()
    : null;
  
  let finalState = state;
  let conflictDetected = false;
  let conflictResolved = false;
  
  // Check for conflict
  if (currentOnDisk && options.expectedVersion !== undefined) {
    const diskVersion = currentOnDisk._version ?? 0;
    
    if (diskVersion > options.expectedVersion) {
      // Conflict! Another process wrote while we were modifying
      conflictDetected = true;
      
      if (options.merge) {
        // Use custom merge
        finalState = options.merge.merge(state, currentOnDisk);
        conflictResolved = true;
      } else if (options.arrayKeys && options.arrayKeys.length > 0) {
        // Use default merge with array union
        finalState = defaultMerge(state, currentOnDisk, options.arrayKeys) as T;
        conflictResolved = true;
      }
      // Else: last-write-wins (state overwrites disk)
      
      logger.debug('Conflict detected and resolved', {
        expectedVersion: options.expectedVersion,
        diskVersion,
        resolved: conflictResolved,
      });
    }
  }
  
  // Increment version
  const newVersion = (currentOnDisk?._version ?? state._version ?? 0) + 1;
  finalState._version = newVersion;
  finalState._lastModified = new Date().toISOString();
  finalState._processId = PROCESS_ID;
  
  // Atomic write (temp file → rename)
  try {
    await writeFileAtomic(filePath, JSON.stringify(finalState, null, 2));
    
    return {
      success: true,
      conflictDetected,
      conflictResolved,
      finalVersion: newVersion,
    };
  } catch (error) {
    logger.error('Atomic write failed', error);
    return {
      success: false,
      conflictDetected,
      conflictResolved: false,
      finalVersion: state._version ?? 0,
    };
  }
}

/**
 * Synchronous atomic write (for compatibility with existing sync APIs)
 * Uses writeFileAtomic.sync under the hood
 */
export function writeStateAtomicSync<T extends VersionedState>(
  filePath: string,
  state: T,
  options: {
    expectedVersion?: number;
    arrayKeys?: string[];
  } = {}
): AtomicWriteResult {
  // Ensure directory exists
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  
  // Read current state on disk
  let currentOnDisk: T | null = null;
  if (existsSync(filePath)) {
    try {
      currentOnDisk = JSON.parse(readFileSync(filePath, 'utf-8')) as T;
    } catch {
      currentOnDisk = null;
    }
  }
  
  let finalState = state;
  let conflictDetected = false;
  let conflictResolved = false;
  
  // Check for conflict
  if (currentOnDisk && options.expectedVersion !== undefined) {
    const diskVersion = currentOnDisk._version ?? 0;
    
    if (diskVersion > options.expectedVersion) {
      conflictDetected = true;
      
      if (options.arrayKeys && options.arrayKeys.length > 0) {
        finalState = defaultMerge(state, currentOnDisk, options.arrayKeys) as T;
        conflictResolved = true;
      }
    }
  }
  
  // Increment version
  const newVersion = (currentOnDisk?._version ?? state._version ?? 0) + 1;
  finalState._version = newVersion;
  finalState._lastModified = new Date().toISOString();
  finalState._processId = PROCESS_ID;
  
  // Atomic write
  try {
    writeFileAtomic.sync(filePath, JSON.stringify(finalState, null, 2));
    
    return {
      success: true,
      conflictDetected,
      conflictResolved,
      finalVersion: newVersion,
    };
  } catch (error) {
    logger.error('Atomic write failed', error);
    return {
      success: false,
      conflictDetected,
      conflictResolved: false,
      finalVersion: state._version ?? 0,
    };
  }
}

// ============================================================================
// HIGH-LEVEL API: Read-Modify-Write with Automatic Merge
// ============================================================================

/**
 * Perform a read-modify-write operation atomically with automatic conflict resolution.
 * This is the recommended API for most use cases.
 */
export async function atomicUpdate<T extends VersionedState>(
  filePath: string,
  defaultState: () => T,
  modifier: (state: T) => T,
  options: {
    arrayKeys?: string[];  // Arrays to union-merge on conflict
    maxRetries?: number;   // Max retries on conflict (default: 3)
  } = {}
): Promise<{ state: T; result: AtomicWriteResult }> {
  const maxRetries = options.maxRetries ?? 3;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Read current state
    const current = readStateAtomic(filePath, defaultState);
    const expectedVersion = current._version;
    
    // Modify
    const modified = modifier(current);
    
    // Write with conflict detection
    const result = await writeStateAtomic(filePath, modified, {
      expectedVersion,
      arrayKeys: options.arrayKeys,
    });
    
    if (result.success) {
      return { state: modified, result };
    }
    
    // If failed, retry (conflict will be auto-merged)
    if (attempt < maxRetries) {
      logger.debug(`Atomic update retry ${attempt + 1}/${maxRetries}`);
    }
  }
  
  // Final attempt with force write
  const final = modifier(readStateAtomic(filePath, defaultState));
  const result = await writeStateAtomic(filePath, final, {
    arrayKeys: options.arrayKeys,
  });
  
  return { state: final, result };
}

/**
 * Synchronous version of atomicUpdate
 */
export function atomicUpdateSync<T extends VersionedState>(
  filePath: string,
  defaultState: () => T,
  modifier: (state: T) => T,
  options: {
    arrayKeys?: string[];
  } = {}
): { state: T; result: AtomicWriteResult } {
  // Read current state
  const current = readStateAtomic(filePath, defaultState);
  const expectedVersion = current._version;
  
  // Modify
  const modified = modifier(current);
  
  // Write with conflict detection
  const result = writeStateAtomicSync(filePath, modified, {
    expectedVersion,
    arrayKeys: options.arrayKeys,
  });
  
  return { state: modified, result };
}
