/**
 * Cloud Sync - Turso Database Integration
 * 
 * Syncs local Midas state to Turso for web dashboard access.
 * Uses libsql HTTP API for serverless-friendly connections.
 */

import { loadAuth, isAuthenticated, getAuthenticatedUser } from './auth.js';
import { loadState, type Phase } from './state/phase.js';
import { loadTracker, type TrackerState } from './tracker.js';
import { sanitizePath } from './security.js';
import { basename } from 'path';

// Turso configuration - shared database for all Midas users
// Users can override with env vars for self-hosted setups
const DEFAULT_TURSO_URL = 'libsql://midas-christiancattaneo.aws-us-east-1.turso.io';
const DEFAULT_TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzAwNzY5OTAsImlkIjoiMzdiMTQ4NjEtNzFhZi00ZDgyLTg1ZDItYmY5OThhM2VmZjUxIiwicmlkIjoiNDQyMDJmMzItNWQ5YS00MTgyLTllM2ItNjE3MWUyNDk4ODY2In0.pm1VW_o8ARe25fwx8HrXyOAKAUnMxZrWrD_kIc0zk2wfC2qLjf6nxUSptSpV6jbDkIMQXK2TsV1o5HgAjpdBAw';

const TURSO_URL_RAW = process.env.TURSO_DATABASE_URL || DEFAULT_TURSO_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || DEFAULT_TURSO_TOKEN;

// Convert libsql:// URL to https:// for HTTP API
function getTursoHttpUrl(): string {
  if (!TURSO_URL_RAW) return '';
  // libsql://db-name.turso.io -> https://db-name.turso.io
  return TURSO_URL_RAW.replace('libsql://', 'https://');
}

export interface SyncResult {
  success: boolean;
  projectId?: string;
  syncedAt?: string;
  error?: string;
}

export interface CloudProject {
  id: string;
  github_user_id: number;
  github_username: string;
  name: string;
  local_path: string;
  current_phase: string;
  current_step: string;
  progress: number;
  last_synced: string;
  created_at: string;
}

/**
 * Execute SQL against Turso using HTTP API (v2/pipeline)
 */
async function executeSQL(
  sql: string,
  args: (string | number | boolean | null)[] = []
): Promise<{ columns: string[]; rows: (string | number | boolean | null)[][] }> {
  const tursoUrl = getTursoHttpUrl();
  if (!tursoUrl || !TURSO_AUTH_TOKEN) {
    throw new Error('Turso not configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.');
  }
  
  // Convert args to Turso format
  const tursoArgs = args.map(arg => {
    if (arg === null) return { type: 'null', value: null };
    if (typeof arg === 'number') return { type: 'integer', value: String(arg) };
    if (typeof arg === 'boolean') return { type: 'integer', value: arg ? '1' : '0' };
    return { type: 'text', value: String(arg) };
  });
  
  const response = await fetch(`${tursoUrl}/v2/pipeline`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TURSO_AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        { type: 'execute', stmt: { sql, args: tursoArgs } },
        { type: 'close' }
      ]
    }),
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Turso error: ${response.status} - ${text}`);
  }
  
  const data = await response.json() as {
    results: Array<{
      type: string;
      response?: {
        type: string;
        result?: {
          cols: Array<{ name: string }>;
          rows: Array<Array<{ type: string; value: string | null }>>;
        };
      };
    }>;
  };
  
  // Extract columns and rows from the response
  const result = data.results[0]?.response?.result;
  if (!result) {
    return { columns: [], rows: [] };
  }
  
  const columns = result.cols.map(c => c.name);
  const rows = result.rows.map(row => 
    row.map(cell => cell.value)
  );
  
  return { columns, rows };
}

/**
 * Initialize database schema
 */
export async function initSchema(): Promise<void> {
  // Projects table
  await executeSQL(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      github_user_id INTEGER NOT NULL,
      github_username TEXT NOT NULL,
      name TEXT NOT NULL,
      local_path TEXT NOT NULL,
      current_phase TEXT DEFAULT 'IDLE',
      current_step TEXT DEFAULT '',
      progress INTEGER DEFAULT 0,
      last_synced TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(github_user_id, local_path)
    )
  `);
  
  // Phase history table
  await executeSQL(`
    CREATE TABLE IF NOT EXISTS phase_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      step TEXT,
      entered_at TEXT NOT NULL,
      exited_at TEXT,
      duration_minutes INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);
  
  // Events table (for activity feed)
  await executeSQL(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);
  
  // Gates status table
  await executeSQL(`
    CREATE TABLE IF NOT EXISTS gates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      compiles INTEGER,
      tests_pass INTEGER,
      lints_pass INTEGER,
      checked_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);
  
  // Suggestions table (for learning patterns)
  await executeSQL(`
    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      suggestion TEXT NOT NULL,
      accepted INTEGER DEFAULT 0,
      user_prompt TEXT,
      rejection_reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);
}

/**
 * Generate a unique project ID
 */
function generateProjectId(userId: number, projectPath: string): string {
  const pathHash = Buffer.from(projectPath).toString('base64url').slice(0, 12);
  return `${userId}-${pathHash}`;
}

/**
 * Calculate progress percentage from phase/step
 */
function calculateProgress(phase: Phase): number {
  const phaseOrder = ['IDLE', 'PLAN', 'BUILD', 'SHIP', 'GROW'];
  const stepCounts: Record<string, number> = {
    IDLE: 1,
    PLAN: 5,  // IDEA, RESEARCH, BRAINLIFT, PRD, GAMEPLAN
    BUILD: 7, // RULES, INDEX, READ, RESEARCH, IMPLEMENT, TEST, DEBUG
    SHIP: 3,  // REVIEW, DEPLOY, MONITOR
    GROW: 3,  // FEEDBACK, ANALYZE, ITERATE
  };
  
  const phaseSteps: Record<string, string[]> = {
    PLAN: ['IDEA', 'RESEARCH', 'BRAINLIFT', 'PRD', 'GAMEPLAN'],
    BUILD: ['RULES', 'INDEX', 'READ', 'RESEARCH', 'IMPLEMENT', 'TEST', 'DEBUG'],
    SHIP: ['REVIEW', 'DEPLOY', 'MONITOR'],
    GROW: ['FEEDBACK', 'ANALYZE', 'ITERATE'],
  };
  
  if (phase.phase === 'IDLE') return 0;
  
  const phaseIdx = phaseOrder.indexOf(phase.phase);
  let completedSteps = 0;
  
  // Count completed phases
  for (let i = 1; i < phaseIdx; i++) {
    completedSteps += stepCounts[phaseOrder[i]];
  }
  
  // Add current phase progress
  if ('step' in phase && phaseSteps[phase.phase]) {
    const stepIdx = phaseSteps[phase.phase].indexOf(phase.step);
    completedSteps += stepIdx;
  }
  
  const totalSteps = 5 + 7 + 3 + 3; // PLAN + BUILD + SHIP + GROW
  return Math.round((completedSteps / totalSteps) * 100);
}

/**
 * Sync project state to cloud
 */
export async function syncProject(projectPath: string): Promise<SyncResult> {
  const safePath = sanitizePath(projectPath);
  
  // Check authentication
  if (!isAuthenticated()) {
    return { success: false, error: 'Not authenticated. Run: midas login' };
  }
  
  const user = getAuthenticatedUser();
  if (!user) {
    return { success: false, error: 'User info not available' };
  }
  
  try {
    // Load local state
    const state = loadState(safePath);
    const tracker = loadTracker(safePath);
    const projectName = basename(safePath);
    const projectId = generateProjectId(user.userId, safePath);
    const progress = calculateProgress(state.current);
    const now = new Date().toISOString();
    
    // Upsert project
    await executeSQL(`
      INSERT INTO projects (id, github_user_id, github_username, name, local_path, current_phase, current_step, progress, last_synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(github_user_id, local_path) DO UPDATE SET
        current_phase = excluded.current_phase,
        current_step = excluded.current_step,
        progress = excluded.progress,
        last_synced = excluded.last_synced
    `, [
      projectId,
      user.userId,
      user.username,
      projectName,
      safePath,
      state.current.phase,
      'step' in state.current ? state.current.step : '',
      progress,
      now,
    ]);
    
    // Sync recent events
    if (tracker.recentToolCalls.length > 0) {
      const recentCall = tracker.recentToolCalls[0];
      await executeSQL(`
        INSERT INTO events (project_id, event_type, event_data, created_at)
        VALUES (?, 'tool_call', ?, ?)
      `, [
        projectId,
        JSON.stringify({ tool: recentCall.tool, args: recentCall.args }),
        new Date(recentCall.timestamp).toISOString(),
      ]);
    }
    
    // Sync gates status
    if (tracker.gates.compiledAt || tracker.gates.testedAt || tracker.gates.lintedAt) {
      await executeSQL(`
        INSERT INTO gates (project_id, compiles, tests_pass, lints_pass, checked_at)
        VALUES (?, ?, ?, ?, ?)
      `, [
        projectId,
        tracker.gates.compiles === null ? null : tracker.gates.compiles ? 1 : 0,
        tracker.gates.testsPass === null ? null : tracker.gates.testsPass ? 1 : 0,
        tracker.gates.lintsPass === null ? null : tracker.gates.lintsPass ? 1 : 0,
        now,
      ]);
    }
    
    // Sync recent suggestions
    for (const suggestion of tracker.suggestionHistory.slice(0, 5)) {
      await executeSQL(`
        INSERT INTO suggestions (project_id, suggestion, accepted, user_prompt, rejection_reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        projectId,
        suggestion.suggestion,
        suggestion.accepted ? 1 : 0,
        suggestion.userPrompt || null,
        suggestion.rejectionReason || null,
        new Date(suggestion.timestamp).toISOString(),
      ]);
    }
    
    return {
      success: true,
      projectId,
      syncedAt: now,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get all projects for authenticated user
 */
export async function getProjects(): Promise<CloudProject[]> {
  const user = getAuthenticatedUser();
  if (!user) return [];
  
  const result = await executeSQL(`
    SELECT * FROM projects WHERE github_user_id = ? ORDER BY last_synced DESC
  `, [user.userId]);
  
  return result.rows.map(row => ({
    id: row[0] as string,
    github_user_id: row[1] as number,
    github_username: row[2] as string,
    name: row[3] as string,
    local_path: row[4] as string,
    current_phase: row[5] as string,
    current_step: row[6] as string,
    progress: row[7] as number,
    last_synced: row[8] as string,
    created_at: row[9] as string,
  }));
}

/**
 * Check if cloud sync is configured
 */
export function isCloudConfigured(): boolean {
  return !!TURSO_URL_RAW && !!TURSO_AUTH_TOKEN;
}

/**
 * CLI command to sync
 */
export async function runSync(projectPath: string): Promise<void> {
  console.log('\n  Syncing to cloud...\n');
  
  const result = await syncProject(projectPath);
  
  if (result.success) {
    console.log(`  ✓ Synced successfully`);
    console.log(`    Project ID: ${result.projectId}`);
    console.log(`    Synced at: ${result.syncedAt}\n`);
    console.log(`  View at: https://dashboard.midasmcp.com\n`);
  } else {
    console.log(`  ✗ Sync failed: ${result.error}\n`);
  }
}
