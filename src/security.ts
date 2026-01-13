import { resolve, normalize, relative, isAbsolute } from 'path';
import { existsSync } from 'fs';

/**
 * Sanitize and validate a project path to prevent path traversal attacks.
 * Returns a safe, absolute path within allowed boundaries.
 */
export function sanitizePath(inputPath: string | undefined, basePath?: string): string {
  const base = basePath || process.cwd();
  
  if (!inputPath) {
    return base;
  }
  
  // Normalize to remove .. and . segments
  const normalized = normalize(inputPath);
  
  // If absolute, verify it doesn't escape intended directories
  if (isAbsolute(normalized)) {
    // For absolute paths, ensure they exist and are directories
    if (!existsSync(normalized)) {
      return base;
    }
    return normalized;
  }
  
  // For relative paths, resolve against base
  const resolved = resolve(base, normalized);
  
  // Ensure the resolved path is still within the base
  const rel = relative(base, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    // Path escapes base - return base instead
    return base;
  }
  
  return resolved;
}

/**
 * Validate a path is safe for shell commands (no metacharacters)
 */
export function isShellSafe(path: string): boolean {
  // Reject paths with shell metacharacters
  const dangerousChars = /[;&|`$(){}[\]<>\\!#*?'"]/;
  return !dangerousChars.test(path);
}

/**
 * Sanitize a string for use in git commands
 */
export function sanitizeForGit(path: string): string {
  if (!isShellSafe(path)) {
    throw new Error('Path contains unsafe characters for shell commands');
  }
  return path;
}

/**
 * Limit string length for storage/processing
 */
export function limitLength(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return input.slice(0, maxLength) + '... [truncated]';
}

/**
 * Validate that a value is one of the allowed values
 */
export function validateEnum<T extends string>(value: string, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

// Max sizes for various inputs
export const LIMITS = {
  CONVERSATION_MAX_LENGTH: 500000, // ~500KB
  TITLE_MAX_LENGTH: 200,
  TAG_MAX_LENGTH: 50,
  MAX_TAGS: 20,
  PATH_MAX_LENGTH: 1000,
} as const;
