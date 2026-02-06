/**
 * Cloud Sync - Turso Database Integration
 * 
 * Syncs local Midas state to Turso for web dashboard access.
 * Uses libsql HTTP API for serverless-friendly connections.
 */

import { loadAuth, isAuthenticated, getAuthenticatedUser, getDatabaseCredentials } from './auth.js';
import { loadState, type Phase } from './state/phase.js';
import { loadTracker, getSmartPromptSuggestion, type TrackerState } from './tracker.js';
import { parseGameplanTasks, type GameplanTask } from './gameplan-tracker.js';
import { discoverDocsSync } from './docs-discovery.js';
import { sanitizePath } from './security.js';
import { basename, resolve } from 'path';

// Type for AI analysis result (passed from pilot/TUI)
export interface AnalysisData {
  summary?: string;
  suggestedPrompt?: string;
  whatsNext?: string;
  whatsDone?: string[];
  confidence?: number;
  techStack?: string[];
}

// Get user's personal database credentials
// Falls back to env vars for self-hosted setups
function getUserDatabaseConfig(): { url: string; token: string } | null {
  // First try personal credentials from auth
  const creds = getDatabaseCredentials();
  if (creds) {
    return { url: creds.dbUrl, token: creds.dbToken };
  }
  
  // Fallback to env vars (for self-hosted)
  const envUrl = process.env.TURSO_DATABASE_URL;
  const envToken = process.env.TURSO_AUTH_TOKEN;
  if (envUrl && envToken) {
    return { url: envUrl, token: envToken };
  }
  
  return null;
}

// Convert libsql:// URL to https:// for HTTP API
function getTursoHttpUrl(libsqlUrl: string): string {
  if (!libsqlUrl) return '';
  return libsqlUrl.replace('libsql://', 'https://');
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
  const dbConfig = getUserDatabaseConfig();
  if (!dbConfig) {
    throw new Error('Database not configured. Run: midas login');
  }
  
  const tursoUrl = getTursoHttpUrl(dbConfig.url);
  const authToken = dbConfig.token;
  
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
      'Authorization': `Bearer ${authToken}`,
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
  try {
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
  
  // Smart suggestion table (for mobile pilot)
  await executeSQL(`
    CREATE TABLE IF NOT EXISTS smart_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL UNIQUE,
      prompt TEXT NOT NULL,
      reason TEXT NOT NULL,
      priority TEXT NOT NULL,
      context TEXT,
      phase TEXT,
      step TEXT,
      synced_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id)
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
  
  // Error memory table (for tracking repeated errors)
  await executeSQL(`
    CREATE TABLE IF NOT EXISTS error_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      error_id TEXT NOT NULL,
      error_text TEXT NOT NULL,
      file_path TEXT,
      line_number INTEGER,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      fix_attempts INTEGER DEFAULT 0,
      fix_history TEXT,
      resolved INTEGER DEFAULT 0,
      resolved_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      UNIQUE(project_id, error_id)
    )
  `);
  
  // Session metrics table (for analytics)
  await executeSQL(`
    CREATE TABLE IF NOT EXISTS session_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      session_date TEXT NOT NULL,
      total_prompts INTEGER DEFAULT 0,
      accepted_prompts INTEGER DEFAULT 0,
      rejected_prompts INTEGER DEFAULT 0,
      commands_executed INTEGER DEFAULT 0,
      commands_succeeded INTEGER DEFAULT 0,
      commands_failed INTEGER DEFAULT 0,
      tornado_cycles INTEGER DEFAULT 0,
      time_in_build_ms INTEGER DEFAULT 0,
      time_stuck_ms INTEGER DEFAULT 0,
      errors_encountered INTEGER DEFAULT 0,
      errors_resolved INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      UNIQUE(project_id, session_date)
    )
  `);
  
  // Add stuck detection columns to projects (using ALTER TABLE with IF NOT EXISTS pattern)
  try {
    await executeSQL(`ALTER TABLE projects ADD COLUMN last_progress_at TEXT`);
  } catch { /* Column may already exist */ }
  
  try {
    await executeSQL(`ALTER TABLE projects ADD COLUMN stuck_since TEXT`);
  } catch { /* Column may already exist */ }
  
  try {
    await executeSQL(`ALTER TABLE projects ADD COLUMN stuck_on_error TEXT`);
  } catch { /* Column may already exist */ }
  
  try {
    await executeSQL(`ALTER TABLE projects ADD COLUMN time_in_phase_ms INTEGER DEFAULT 0`);
  } catch { /* Column may already exist */ }
  
  } catch (error) {
    console.error('Error initializing database schema:', error);
    throw error;
  }
}

/**
 * Normalize path for consistent projectId generation
 * - Remove trailing slashes
 * - Lowercase on macOS (case-insensitive filesystem)
 * - Resolve to absolute path
 */
function normalizePathForId(projectPath: string): string {
  let normalized = resolve(projectPath);
  
  // Remove trailing slash
  normalized = normalized.replace(/\/+$/, '');
  
  // Lowercase on macOS/Windows (case-insensitive filesystems)
  if (process.platform === 'darwin' || process.platform === 'win32') {
    normalized = normalized.toLowerCase();
  }
  
  return normalized;
}

/**
 * Generate a unique project ID
 * Uses normalized path to ensure consistency across different invocations
 */
function generateProjectId(userId: number, projectPath: string): string {
  const normalizedPath = normalizePathForId(projectPath);
  const pathHash = Buffer.from(normalizedPath).toString('base64url').slice(0, 12);
  return `${userId}-${pathHash}`;
}

/**
 * Calculate progress percentage from phase/step
 */
function calculateProgress(phase: Phase): number {
  const phaseOrder = ['IDLE', 'PLAN', 'BUILD', 'SHIP', 'GROW'];
  const stepCounts: Record<string, number> = {
    IDLE: 1,
    PLAN: 4,  // IDEA, RESEARCH, PRD, GAMEPLAN
    BUILD: 7, // RULES, INDEX, READ, RESEARCH, IMPLEMENT, TEST, DEBUG
    SHIP: 3,  // REVIEW, DEPLOY, MONITOR
    GROW: 3,  // FEEDBACK, ANALYZE, ITERATE
  };
  
  const phaseSteps: Record<string, string[]> = {
    PLAN: ['IDEA', 'RESEARCH', 'PRD', 'GAMEPLAN'],
    BUILD: ['RULES', 'INDEX', 'READ', 'RESEARCH', 'IMPLEMENT', 'TEST', 'DEBUG'],
    SHIP: ['REVIEW', 'DEPLOY', 'MONITOR'],
    GROW: ['FEEDBACK', 'ANALYZE', 'ITERATE'],
  };
  
  if (phase.phase === 'IDLE') return 0;
  if (phase.phase === 'GROW') return 100;
  
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
  
  const totalSteps = 4 + 7 + 3 + 3; // PLAN + BUILD + SHIP + GROW
  return Math.round((completedSteps / totalSteps) * 100);
}

/**
 * Sync project state to cloud
 */
export async function syncProject(projectPath: string, analysisData?: AnalysisData): Promise<SyncResult> {
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
    
    // Upsert project by local_path (ensures no duplicates for same project)
    // First, delete any existing project with same path but different ID (cleanup old duplicates)
    await executeSQL(`
      DELETE FROM projects WHERE local_path = ? AND id != ?
    `, [safePath, projectId]);
    
    // Now upsert the project (use INSERT OR REPLACE to handle both id and local_path conflicts)
    await executeSQL(`
      INSERT OR REPLACE INTO projects (id, name, local_path, current_phase, current_step, progress, last_synced, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM projects WHERE id = ?), ?))
    `, [
      projectId,
      projectName,
      safePath,
      state.current.phase,
      'step' in state.current ? state.current.step : '',
      progress,
      now,
      projectId, // for subquery
      now, // fallback for new projects
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
    
    // Sync smart suggestion (for mobile pilot)
    // Use AI analysis if provided, otherwise fall back to local suggestion
    try {
      const localSuggestion = getSmartPromptSuggestion(safePath);
      
      // Prefer AI-generated prompt if available
      const prompt = analysisData?.suggestedPrompt || localSuggestion.prompt;
      const reason = analysisData?.whatsNext || localSuggestion.reason;
      const summary = analysisData?.summary || '';
      const techStack = analysisData?.techStack?.join(', ') || '';
      const confidence = analysisData?.confidence || 0;
      
      await executeSQL(`
        INSERT INTO smart_suggestions (project_id, prompt, reason, priority, context, phase, step, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          prompt = excluded.prompt,
          reason = excluded.reason,
          priority = excluded.priority,
          context = excluded.context,
          phase = excluded.phase,
          step = excluded.step,
          synced_at = excluded.synced_at
      `, [
        projectId,
        prompt,
        reason,
        analysisData ? 'ai_analyzed' : localSuggestion.priority,
        JSON.stringify({ summary, techStack, confidence, whatsDone: analysisData?.whatsDone || [] }),
        state.current.phase,
        'step' in state.current ? state.current.step : '',
        now,
      ]);
    } catch (err) {
      // Non-fatal: suggestion sync failure shouldn't break overall sync
      console.error('  Warning: Could not sync smart suggestion');
    }
    
    // Sync error memory (for dashboard stuck detection)
    try {
      const unresolvedErrors = tracker.errorMemory.filter(e => !e.resolved);
      
      for (const error of unresolvedErrors.slice(0, 10)) { // Limit to 10 most recent
        await executeSQL(`
          INSERT INTO error_memory (project_id, error_id, error_text, file_path, line_number, first_seen, last_seen, fix_attempts, fix_history, resolved)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(project_id, error_id) DO UPDATE SET
            error_text = excluded.error_text,
            last_seen = excluded.last_seen,
            fix_attempts = excluded.fix_attempts,
            fix_history = excluded.fix_history,
            resolved = excluded.resolved
        `, [
          projectId,
          error.id,
          error.error.slice(0, 1000), // Limit error text length
          error.file || null,
          error.line || null,
          new Date(error.firstSeen).toISOString(),
          new Date(error.lastSeen).toISOString(),
          error.fixAttempts.length,
          JSON.stringify(error.fixAttempts.slice(-5)), // Last 5 fix attempts
          error.resolved ? 1 : 0,
        ]);
      }
      
      // Mark resolved errors
      const resolvedErrorIds = tracker.errorMemory
        .filter(e => e.resolved)
        .map(e => e.id);
      
      if (resolvedErrorIds.length > 0) {
        for (const errorId of resolvedErrorIds) {
          await executeSQL(`
            UPDATE error_memory SET resolved = 1, resolved_at = ? WHERE project_id = ? AND error_id = ?
          `, [now, projectId, errorId]);
        }
      }
    } catch (err) {
      // Non-fatal
      console.error('  Warning: Could not sync error memory');
    }
    
    // Sync stuck detection (update projects table)
    try {
      const lastProgressAt = tracker.lastProgressAt 
        ? new Date(tracker.lastProgressAt).toISOString() 
        : null;
      
      const phaseEnteredAt = tracker.phaseEnteredAt
        ? new Date(tracker.phaseEnteredAt).toISOString()
        : null;
      
      // Calculate time in phase
      const timeInPhaseMs = tracker.phaseEnteredAt
        ? Date.now() - tracker.phaseEnteredAt
        : 0;
      
      // Determine if stuck (no progress for 2+ hours)
      const twoHoursMs = 2 * 60 * 60 * 1000;
      const stuckSince = tracker.lastProgressAt && (Date.now() - tracker.lastProgressAt) > twoHoursMs
        ? new Date(tracker.lastProgressAt + twoHoursMs).toISOString()
        : null;
      
      // Get the most problematic error (most fix attempts)
      const stuckOnError = tracker.errorMemory
        .filter(e => !e.resolved)
        .sort((a, b) => b.fixAttempts.length - a.fixAttempts.length)[0]?.error?.slice(0, 200) || null;
      
      await executeSQL(`
        UPDATE projects SET 
          last_progress_at = ?,
          stuck_since = ?,
          stuck_on_error = ?,
          time_in_phase_ms = ?
        WHERE id = ?
      `, [lastProgressAt, stuckSince, stuckOnError, timeInPhaseMs, projectId]);
    } catch (err) {
      // Non-fatal
      console.error('  Warning: Could not sync stuck detection');
    }
    
    // Sync daily metrics
    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      
      // Count today's activity from tracker
      const todayStart = new Date(today).getTime();
      const todayToolCalls = tracker.recentToolCalls.filter(t => t.timestamp >= todayStart).length;
      const todaySuggestions = tracker.suggestionHistory.filter(s => s.timestamp >= todayStart);
      const acceptedToday = todaySuggestions.filter(s => s.accepted).length;
      const rejectedToday = todaySuggestions.filter(s => !s.accepted).length;
      const errorsToday = tracker.errorMemory.filter(e => e.firstSeen >= todayStart).length;
      const resolvedToday = tracker.errorMemory.filter(e => e.resolved && e.lastSeen >= todayStart).length;
      
      await executeSQL(`
        INSERT INTO session_metrics (project_id, session_date, total_prompts, accepted_prompts, rejected_prompts, errors_encountered, errors_resolved)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, session_date) DO UPDATE SET
          total_prompts = excluded.total_prompts,
          accepted_prompts = excluded.accepted_prompts,
          rejected_prompts = excluded.rejected_prompts,
          errors_encountered = excluded.errors_encountered,
          errors_resolved = excluded.errors_resolved
      `, [
        projectId,
        today,
        todaySuggestions.length,
        acceptedToday,
        rejectedToday,
        errorsToday,
        resolvedToday,
      ]);
    } catch (err) {
      // Non-fatal
      console.error('  Warning: Could not sync metrics');
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
  if (!isAuthenticated()) return [];
  
  try {
    const result = await executeSQL(`
      SELECT * FROM projects ORDER BY last_synced DESC
    `);
    
    // User's personal DB - columns: id, name, local_path, current_phase, current_step, progress, last_synced, created_at
    return result.rows.map(row => ({
      id: row[0] as string,
      github_user_id: 0, // Not stored in personal DB
      github_username: '', // Not stored in personal DB
      name: row[1] as string,
      local_path: row[2] as string,
      current_phase: row[3] as string,
      current_step: row[4] as string,
      progress: row[5] as number,
      last_synced: row[6] as string,
      created_at: row[7] as string,
    }));
  } catch (error) {
    console.error('Error fetching projects:', error);
    return [];
  }
}

/**
 * Check if cloud sync is configured
 */
export function isCloudConfigured(): boolean {
  return getUserDatabaseConfig() !== null;
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
  if (!isAuthenticated()) {
    console.log('  [debug] Not authenticated, skipping command fetch');
    return [];
  }
  
  try {
    // User's personal DB - no github_user_id column
    const result = await executeSQL(`
      SELECT * FROM pending_commands 
      WHERE status = 'pending'
      ORDER BY priority DESC, created_at ASC
      LIMIT 10
    `);
    
    if (result.rows.length > 0) {
      console.log(`  [debug] Found ${result.rows.length} pending command(s)`);
    }
    
    // Columns: id, project_id, command_type, prompt, status, priority, max_turns, created_at, started_at, completed_at, output, error, exit_code, duration_ms, session_id
    return result.rows.map(row => ({
      id: row[0] as number,
      project_id: row[1] as string,
      github_user_id: 0, // Not in personal DB
      command_type: row[2] as 'prompt' | 'task' | 'gameplan',
      prompt: row[3] as string,
      status: row[4] as 'pending' | 'running' | 'completed' | 'failed' | 'cancelled',
      priority: row[5] as number,
      max_turns: row[6] as number,
      created_at: row[7] as string,
      started_at: row[8] as string | undefined,
      completed_at: row[9] as string | undefined,
      output: row[10] as string | undefined,
      error: row[11] as string | undefined,
      exit_code: row[12] as number | undefined,
      duration_ms: row[13] as number | undefined,
      session_id: row[14] as string | undefined,
    }));
  } catch (error) {
    console.error('Error fetching pending commands:', error);
    return [];
  }
}

/**
 * Mark a command as running
 */
export async function markCommandRunning(commandId: number): Promise<void> {
  try {
    await executeSQL(`
      UPDATE pending_commands 
      SET status = 'running', started_at = ?
      WHERE id = ?
    `, [new Date().toISOString(), commandId]);
  } catch (error) {
    console.error('Error marking command as running:', error);
    throw error;
  }
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
  try {
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
  } catch (error) {
    console.error('Error marking command as completed:', error);
    throw error;
  }
}

/**
 * Get project details by ID (for Pilot to know the path)
 */
export async function getProjectById(projectId: string): Promise<CloudProject | null> {
  try {
    const result = await executeSQL(`
      SELECT * FROM projects WHERE id = ?
    `, [projectId]);
    
    if (result.rows.length === 0) return null;
    
    // User's personal DB columns: id, name, local_path, current_phase, current_step, progress, last_synced, created_at
    const row = result.rows[0];
    return {
      id: row[0] as string,
      github_user_id: 0,
      github_username: '',
      name: row[1] as string,
      local_path: row[2] as string,
      current_phase: row[3] as string,
      current_step: row[4] as string,
      progress: row[5] as number,
      last_synced: row[6] as string,
      created_at: row[7] as string,
    };
  } catch (error) {
    console.error('Error fetching project by ID:', error);
    return null;
  }
}

/**
 * CLI command to sync
 */
export async function runSync(projectPath: string): Promise<void> {
  console.log('\n  Syncing to cloud...\n');
  
  try {
    const result = await syncProject(projectPath);
    
    if (result.success) {
      console.log(`  ✓ Synced successfully`);
      console.log(`    Project ID: ${result.projectId}`);
      console.log(`    Synced at: ${result.syncedAt}\n`);
      console.log(`  View at: https://dashboard.midasmcp.com\n`);
    } else {
      console.log(`  ✗ Sync failed: ${result.error}\n`);
    }
  } catch (error) {
    console.error('  ✗ Sync error:', error instanceof Error ? error.message : String(error));
  }
}
