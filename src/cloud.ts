/**
 * Cloud Sync - Turso Database Integration
 * 
 * Syncs local Midas state to Turso for web dashboard access.
 * Uses libsql HTTP API for serverless-friendly connections.
 */

import { loadAuth, isAuthenticated, getAuthenticatedUser } from './auth.js';
import { loadState, type Phase } from './state/phase.js';
import { loadTracker, type TrackerState } from './tracker.js';
import { parseGameplanTasks, type GameplanTask } from './gameplan-tracker.js';
import { discoverDocsSync } from './docs-discovery.js';
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
  
  // Gameplan tasks table (for dashboard prompting)
  await executeSQL(`
    CREATE TABLE IF NOT EXISTS gameplan_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      task_text TEXT NOT NULL,
      phase TEXT,
      completed INTEGER DEFAULT 0,
      priority TEXT,
      task_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      UNIQUE(project_id, task_id)
    )
  `);
  
  // Pending commands table (for Pilot automation)
  await executeSQL(`
    CREATE TABLE IF NOT EXISTS pending_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      github_user_id INTEGER NOT NULL,
      command_type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      max_turns INTEGER DEFAULT 10,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      completed_at TEXT,
      output TEXT,
      error TEXT,
      exit_code INTEGER,
      duration_ms INTEGER,
      session_id TEXT,
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
    
    // Sync gameplan tasks
    try {
      const docs = discoverDocsSync(safePath);
      if (docs.gameplan?.content) {
        const tasks = parseGameplanTasks(docs.gameplan.content);
        
        // Clear existing tasks for this project first
        await executeSQL(`DELETE FROM gameplan_tasks WHERE project_id = ?`, [projectId]);
        
        // Insert current tasks
        for (let i = 0; i < tasks.length; i++) {
          const task = tasks[i];
          await executeSQL(`
            INSERT INTO gameplan_tasks (project_id, task_id, task_text, phase, completed, priority, task_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [
            projectId,
            task.id,
            task.text,
            task.phase || null,
            task.completed ? 1 : 0,
            task.priority || 'medium',
            i,
          ]);
        }
      }
    } catch (err) {
      // Non-fatal: gameplan sync failure shouldn't break overall sync
      console.error('  Warning: Could not sync gameplan tasks');
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

// ============================================================================
// PENDING COMMANDS (for Pilot automation)
// ============================================================================

export interface PendingCommand {
  id: number;
  project_id: string;
  github_user_id: number;
  command_type: 'prompt' | 'task' | 'gameplan';
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority: number;
  max_turns: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  output?: string;
  error?: string;
  exit_code?: number;
  duration_ms?: number;
  session_id?: string;
}

/**
 * Fetch pending commands for the authenticated user
 */
export async function fetchPendingCommands(): Promise<PendingCommand[]> {
  const user = getAuthenticatedUser();
  if (!user) return [];
  
  const result = await executeSQL(`
    SELECT * FROM pending_commands 
    WHERE github_user_id = ? AND status = 'pending'
    ORDER BY priority DESC, created_at ASC
    LIMIT 10
  `, [user.userId]);
  
  return result.rows.map(row => ({
    id: row[0] as number,
    project_id: row[1] as string,
    github_user_id: row[2] as number,
    command_type: row[3] as 'prompt' | 'task' | 'gameplan',
    prompt: row[4] as string,
    status: row[5] as 'pending' | 'running' | 'completed' | 'failed' | 'cancelled',
    priority: row[6] as number,
    max_turns: row[7] as number,
    created_at: row[8] as string,
    started_at: row[9] as string | undefined,
    completed_at: row[10] as string | undefined,
    output: row[11] as string | undefined,
    error: row[12] as string | undefined,
    exit_code: row[13] as number | undefined,
    duration_ms: row[14] as number | undefined,
    session_id: row[15] as string | undefined,
  }));
}

/**
 * Mark a command as running
 */
export async function markCommandRunning(commandId: number): Promise<void> {
  await executeSQL(`
    UPDATE pending_commands 
    SET status = 'running', started_at = ?
    WHERE id = ?
  `, [new Date().toISOString(), commandId]);
}

/**
 * Mark a command as completed
 */
export async function markCommandCompleted(
  commandId: number,
  result: {
    success: boolean;
    output: string;
    exitCode: number;
    durationMs: number;
    sessionId?: string;
  }
): Promise<void> {
  await executeSQL(`
    UPDATE pending_commands 
    SET status = ?, completed_at = ?, output = ?, error = ?, exit_code = ?, duration_ms = ?, session_id = ?
    WHERE id = ?
  `, [
    result.success ? 'completed' : 'failed',
    new Date().toISOString(),
    result.success ? result.output : null,
    result.success ? null : result.output,
    result.exitCode,
    result.durationMs,
    result.sessionId || null,
    commandId,
  ]);
}

/**
 * Get project details by ID (for Pilot to know the path)
 */
export async function getProjectById(projectId: string): Promise<CloudProject | null> {
  const result = await executeSQL(`
    SELECT * FROM projects WHERE id = ?
  `, [projectId]);
  
  if (result.rows.length === 0) return null;
  
  const row = result.rows[0];
  return {
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
  };
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
