import { createClient, Client } from '@libsql/client'

// Master database client (for user management)
let _masterClient: Client | null = null

function getMasterClient(): Client {
  if (!_masterClient) {
    const url = process.env.TURSO_DATABASE_URL
    const authToken = process.env.TURSO_AUTH_TOKEN
    
    if (!url) {
      throw new Error('TURSO_DATABASE_URL is not configured')
    }
    
    _masterClient = createClient({
      url,
      authToken,
    })
  }
  return _masterClient
}

// User-specific database client cache
const userClients: Map<string, Client> = new Map()

function getUserClient(dbUrl: string, dbToken: string): Client {
  const key = dbUrl
  if (!userClients.has(key)) {
    userClients.set(key, createClient({
      url: dbUrl,
      authToken: dbToken,
    }))
  }
  return userClients.get(key)!
}

// Exported version for API routes to use
export function getUserClientForUser(dbUrl: string, dbToken: string): Client {
  return getUserClient(dbUrl, dbToken)
}

// For backward compatibility
function getClient(): Client {
  return getMasterClient()
}

// ============================================================================
// USER MANAGEMENT (Master DB)
// ============================================================================

export interface UserRecord {
  id: number
  github_user_id: number
  github_username: string
  db_name: string | null
  db_url: string | null
  db_token: string | null
  created_at: string
  provisioned_at: string | null
}

export async function getUserByGithubId(githubUserId: number): Promise<UserRecord | null> {
  try {
    const client = getMasterClient()
    const result = await client.execute({
      sql: 'SELECT * FROM users WHERE github_user_id = ?',
      args: [githubUserId],
    })
    
    if (result.rows.length === 0) return null
    
    const row = result.rows[0]
    return {
      id: row.id as number,
      github_user_id: row.github_user_id as number,
      github_username: row.github_username as string,
      db_name: row.db_name as string | null,
      db_url: row.db_url as string | null,
      db_token: row.db_token as string | null,
      created_at: row.created_at as string,
      provisioned_at: row.provisioned_at as string | null,
    }
  } catch (error) {
    console.error('Error fetching user by GitHub ID:', error)
    return null
  }
}

export async function createUser(githubUserId: number, githubUsername: string): Promise<UserRecord> {
  try {
    const client = getMasterClient()
    await client.execute({
      sql: 'INSERT INTO users (github_user_id, github_username) VALUES (?, ?)',
      args: [githubUserId, githubUsername],
    })
    
    const user = await getUserByGithubId(githubUserId)
    if (!user) {
      throw new Error('Failed to create user record')
    }
    return user
  } catch (error) {
    console.error('Error creating user:', error)
    throw error
  }
}

export async function updateUserDatabase(
  githubUserId: number,
  dbName: string,
  dbUrl: string,
  dbToken: string
): Promise<void> {
  try {
    const client = getMasterClient()
    await client.execute({
      sql: 'UPDATE users SET db_name = ?, db_url = ?, db_token = ?, provisioned_at = ? WHERE github_user_id = ?',
      args: [dbName, dbUrl, dbToken, new Date().toISOString(), githubUserId],
    })
  } catch (error) {
    console.error('Error updating user database:', error)
    throw error
  }
}

export async function getOrCreateUser(githubUserId: number, githubUsername: string): Promise<UserRecord> {
  try {
    let user = await getUserByGithubId(githubUserId)
    if (!user) {
      user = await createUser(githubUserId, githubUsername)
    }
    return user
  } catch (error) {
    console.error('Error in getOrCreateUser:', error)
    throw error
  }
}

export interface Project {
  id: string
  name: string
  local_path: string
  current_phase: string
  current_step: string
  progress: number
  last_synced: string
  created_at: string
}

export interface GatesStatus {
  compiles: boolean | null
  tests_pass: boolean | null
  lints_pass: boolean | null
  checked_at: string | null
}

export interface Event {
  id: number
  project_id: string
  event_type: string
  event_data: string
  created_at: string
}

export async function getProjectsByUserDb(dbUrl: string, dbToken: string): Promise<Project[]> {
  try {
    const client = getUserClient(dbUrl, dbToken)
    const result = await client.execute({
      sql: 'SELECT * FROM projects ORDER BY last_synced DESC',
      args: [],
    })
    
    return result.rows.map(row => ({
      id: row.id as string,
      name: row.name as string,
      local_path: row.local_path as string,
      current_phase: row.current_phase as string,
      current_step: row.current_step as string,
      progress: row.progress as number,
      last_synced: row.last_synced as string,
      created_at: row.created_at as string,
    }))
  } catch (error) {
    console.error('Error fetching projects:', error)
    return []
  }
}

// Legacy function for backward compatibility
export async function getProjectsByUser(githubUserId: number): Promise<Project[]> {
  // Try to get user's personal database
  const user = await getUserByGithubId(githubUserId)
  if (user?.db_url && user?.db_token) {
    return getProjectsByUserDb(user.db_url, user.db_token)
  }
  // Fallback to empty if no personal DB yet
  return []
}

export async function getProjectById(projectId: string, dbUrl?: string, dbToken?: string): Promise<(Project & { github_user_id?: number }) | null> {
  // If db credentials provided, use user's DB
  if (dbUrl && dbToken) {
    const client = getUserClient(dbUrl, dbToken)
    const result = await client.execute({
      sql: 'SELECT * FROM projects WHERE id = ?',
      args: [projectId],
    })
    
    if (result.rows.length === 0) return null
    
    const row = result.rows[0]
    return {
      id: row.id as string,
      name: row.name as string,
      local_path: row.local_path as string,
      current_phase: row.current_phase as string,
      current_step: row.current_step as string,
      progress: row.progress as number,
      last_synced: row.last_synced as string,
      created_at: row.created_at as string,
    }
  }
  
  // Legacy: try master DB
  const client = getMasterClient()
  try {
    const result = await client.execute({
      sql: 'SELECT * FROM projects WHERE id = ?',
      args: [projectId],
    })
    
    if (result.rows.length === 0) return null
    
    const row = result.rows[0]
    return {
      id: row.id as string,
      github_user_id: row.github_user_id as number,
      name: row.name as string,
      local_path: row.local_path as string,
      current_phase: row.current_phase as string,
      current_step: row.current_step as string,
      progress: row.progress as number,
      last_synced: row.last_synced as string,
      created_at: row.created_at as string,
    }
  } catch {
    return null
  }
}

export async function getLatestGates(
  projectId: string,
  dbUrl?: string,
  dbToken?: string
): Promise<GatesStatus | null> {
  try {
    const client = dbUrl && dbToken ? getUserClient(dbUrl, dbToken) : getClient()
    const result = await client.execute({
      sql: 'SELECT * FROM gates WHERE project_id = ? ORDER BY checked_at DESC LIMIT 1',
      args: [projectId],
    })
    
    if (result.rows.length === 0) return null
    
    const row = result.rows[0]
    return {
      compiles: row.compiles === null ? null : row.compiles === 1,
      tests_pass: row.tests_pass === null ? null : row.tests_pass === 1,
      lints_pass: row.lints_pass === null ? null : row.lints_pass === 1,
      checked_at: row.checked_at as string,
    }
  } catch (error) {
    console.error('Error fetching gates status:', error)
    return null
  }
}

export async function getRecentEvents(
  projectId: string,
  limit = 10,
  dbUrl?: string,
  dbToken?: string
): Promise<Event[]> {
  try {
    const client = dbUrl && dbToken ? getUserClient(dbUrl, dbToken) : getClient()
    const result = await client.execute({
      sql: 'SELECT * FROM events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?',
      args: [projectId, limit],
    })
    
    return result.rows.map(row => ({
      id: row.id as number,
      project_id: row.project_id as string,
      event_type: row.event_type as string,
      event_data: row.event_data as string,
      created_at: row.created_at as string,
    }))
  } catch (error) {
    console.error('Error fetching recent events:', error)
    return []
  }
}

// Gameplan tasks
export interface GameplanTask {
  id: number
  project_id: string
  task_id: string
  task_text: string
  phase: string | null
  completed: boolean
  priority: string
  task_order: number
  created_at: string
}

export async function getGameplanTasks(
  projectId: string,
  dbUrl?: string,
  dbToken?: string
): Promise<GameplanTask[]> {
  const client = dbUrl && dbToken ? getUserClient(dbUrl, dbToken) : getClient()
  try {
    const result = await client.execute({
      sql: 'SELECT * FROM gameplan_tasks WHERE project_id = ? ORDER BY task_order ASC',
      args: [projectId],
    })
    
    return result.rows.map(row => ({
      id: row.id as number,
      project_id: row.project_id as string,
      task_id: row.task_id as string,
      task_text: row.task_text as string,
      phase: row.phase as string | null,
      completed: row.completed === 1,
      priority: row.priority as string,
      task_order: row.task_order as number,
      created_at: row.created_at as string,
    }))
  } catch {
    // Table might not exist yet
    return []
  }
}

// Pending commands
export interface PendingCommand {
  id: number
  project_id: string
  command_type: string
  prompt: string
  status: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  output: string | null
  error: string | null
  exit_code: number | null
  duration_ms: number | null
}

export async function getPendingCommands(
  projectId: string,
  dbUrl?: string,
  dbToken?: string
): Promise<PendingCommand[]> {
  const client = dbUrl && dbToken ? getUserClient(dbUrl, dbToken) : getClient()
  try {
    const result = await client.execute({
      sql: `SELECT * FROM pending_commands 
            WHERE project_id = ? AND status IN ('pending', 'running')
            ORDER BY created_at ASC`,
      args: [projectId],
    })
    
    return result.rows.map(row => ({
      id: row.id as number,
      project_id: row.project_id as string,
      command_type: row.command_type as string,
      prompt: row.prompt as string,
      status: row.status as string,
      created_at: row.created_at as string,
      started_at: row.started_at as string | null,
      completed_at: row.completed_at as string | null,
      output: row.output as string | null,
      error: row.error as string | null,
      exit_code: row.exit_code as number | null,
      duration_ms: row.duration_ms as number | null,
    }))
  } catch {
    return []
  }
}

export async function getRecentCommands(
  projectId: string,
  limit = 10,
  dbUrl?: string,
  dbToken?: string
): Promise<PendingCommand[]> {
  const client = dbUrl && dbToken ? getUserClient(dbUrl, dbToken) : getClient()
  try {
    const result = await client.execute({
      sql: `SELECT * FROM pending_commands 
            WHERE project_id = ? 
            ORDER BY created_at DESC 
            LIMIT ?`,
      args: [projectId, limit],
    })
    
    return result.rows.map(row => ({
      id: row.id as number,
      project_id: row.project_id as string,
      command_type: row.command_type as string,
      prompt: row.prompt as string,
      status: row.status as string,
      created_at: row.created_at as string,
      started_at: row.started_at as string | null,
      completed_at: row.completed_at as string | null,
      output: row.output as string | null,
      error: row.error as string | null,
      exit_code: row.exit_code as number | null,
      duration_ms: row.duration_ms as number | null,
    }))
  } catch {
    return []
  }
}

// ============================================================================
// PILOT SESSIONS (Master DB - for remote control)
// ============================================================================

export interface PilotSession {
  id: string
  github_user_id: number
  session_token: string
  status: 'waiting' | 'connected' | 'running' | 'idle' | 'disconnected'
  current_project: string | null
  current_task: string | null
  last_output: string | null
  output_lines: number
  created_at: string
  last_heartbeat: string | null
  expires_at: string | null
}

export async function getPilotSession(sessionId: string): Promise<PilotSession | null> {
  try {
    const client = getMasterClient()
    const result = await client.execute({
      sql: 'SELECT * FROM pilot_sessions WHERE id = ?',
      args: [sessionId],
    })
    
    if (result.rows.length === 0) return null
    
    const row = result.rows[0]
    return {
      id: row.id as string,
      github_user_id: row.github_user_id as number,
      session_token: row.session_token as string,
      status: row.status as PilotSession['status'],
      current_project: row.current_project as string | null,
      current_task: row.current_task as string | null,
      last_output: row.last_output as string | null,
      output_lines: row.output_lines as number,
      created_at: row.created_at as string,
      last_heartbeat: row.last_heartbeat as string | null,
      expires_at: row.expires_at as string | null,
    }
  } catch (error) {
    console.error('Error fetching pilot session:', error)
    return null
  }
}

export async function getPilotSessionByToken(sessionId: string, token: string): Promise<PilotSession | null> {
  const session = await getPilotSession(sessionId)
  if (!session || session.session_token !== token) return null
  return session
}

export async function createPilotSession(
  sessionId: string,
  githubUserId: number,
  sessionToken: string,
  expiresAt: string
): Promise<void> {
  try {
    const client = getMasterClient()
    await client.execute({
      sql: `INSERT INTO pilot_sessions (id, github_user_id, session_token, expires_at) 
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET 
              session_token = excluded.session_token,
              status = 'waiting',
              expires_at = excluded.expires_at,
              last_heartbeat = CURRENT_TIMESTAMP`,
      args: [sessionId, githubUserId, sessionToken, expiresAt],
    })
  } catch (error) {
    console.error('Error creating pilot session:', error)
    throw error
  }
}

export async function updatePilotSession(
  sessionId: string,
  updates: Partial<Pick<PilotSession, 'status' | 'current_project' | 'current_task' | 'last_output' | 'output_lines'>>
): Promise<void> {
  try {
    const client = getMasterClient()
    const setClauses: string[] = ['last_heartbeat = CURRENT_TIMESTAMP']
    const args: (string | number | null)[] = []
    
    if (updates.status !== undefined) {
      setClauses.push('status = ?')
      args.push(updates.status)
    }
    if (updates.current_project !== undefined) {
      setClauses.push('current_project = ?')
      args.push(updates.current_project)
    }
    if (updates.current_task !== undefined) {
      setClauses.push('current_task = ?')
      args.push(updates.current_task)
    }
    if (updates.last_output !== undefined) {
      setClauses.push('last_output = ?')
      args.push(updates.last_output)
    }
    if (updates.output_lines !== undefined) {
      setClauses.push('output_lines = ?')
      args.push(updates.output_lines)
    }
    
    args.push(sessionId)
    
    await client.execute({
      sql: `UPDATE pilot_sessions SET ${setClauses.join(', ')} WHERE id = ?`,
      args,
    })
  } catch (error) {
    console.error('Error updating pilot session:', error)
    // Don't throw - session updates are non-critical
  }
}

export async function getActivePilotSession(githubUserId: number): Promise<PilotSession | null> {
  try {
    const client = getMasterClient()
    
    // First: mark any stale sessions as disconnected (no heartbeat in 90s)
    // This handles cases where the terminal was killed without clean shutdown
    await client.execute({
      sql: `UPDATE pilot_sessions 
            SET status = 'disconnected' 
            WHERE github_user_id = ? 
              AND status != 'disconnected'
              AND last_heartbeat IS NOT NULL
              AND last_heartbeat < datetime('now', '-90 seconds')`,
      args: [githubUserId],
    })
    
    // Also mark expired sessions as disconnected
    await client.execute({
      sql: `UPDATE pilot_sessions 
            SET status = 'disconnected' 
            WHERE github_user_id = ? 
              AND status != 'disconnected'
              AND expires_at IS NOT NULL 
              AND expires_at < datetime('now')`,
      args: [githubUserId],
    })
    
    // Now fetch only truly active sessions (heartbeat within last 90s)
    const result = await client.execute({
      sql: `SELECT * FROM pilot_sessions 
            WHERE github_user_id = ? 
              AND status != 'disconnected'
              AND (expires_at IS NULL OR expires_at > datetime('now'))
              AND last_heartbeat IS NOT NULL
              AND last_heartbeat > datetime('now', '-90 seconds')
            ORDER BY last_heartbeat DESC 
            LIMIT 1`,
      args: [githubUserId],
    })
    
    if (result.rows.length === 0) return null
    
    const row = result.rows[0]
    return {
      id: row.id as string,
      github_user_id: row.github_user_id as number,
      session_token: row.session_token as string,
      status: row.status as PilotSession['status'],
      current_project: row.current_project as string | null,
      current_task: row.current_task as string | null,
      last_output: row.last_output as string | null,
      output_lines: row.output_lines as number,
      created_at: row.created_at as string,
      last_heartbeat: row.last_heartbeat as string | null,
      expires_at: row.expires_at as string | null,
    }
  } catch (error) {
    console.error('Error fetching active pilot session:', error)
    return null
  }
}

export async function addCommandToQueue(
  githubUserId: number,
  projectId: string,
  commandType: string,
  prompt: string,
  priority = 0,
  maxTurns = 10
): Promise<number> {
  try {
    // Get user's personal DB to add command
    const user = await getUserByGithubId(githubUserId)
    if (!user?.db_url || !user?.db_token) {
      throw new Error('User database not provisioned')
    }
    
    const client = getUserClient(user.db_url, user.db_token)
    const result = await client.execute({
      sql: `INSERT INTO pending_commands (project_id, command_type, prompt, priority, max_turns)
            VALUES (?, ?, ?, ?, ?)`,
      args: [projectId, commandType, prompt, priority, maxTurns],
    })
    
    return Number(result.lastInsertRowid)
  } catch (error) {
    console.error('Error adding command to queue:', error)
    throw error
  }
}

// ============================================================================
// SMART SUGGESTIONS
// ============================================================================

export interface SmartSuggestion {
  project_id: string
  prompt: string
  reason: string
  priority: 'critical' | 'high' | 'normal' | 'low'
  context: string | null
  phase: string
  step: string
  synced_at: string
}

export async function getSmartSuggestion(
  projectId: string,
  dbUrl?: string,
  dbToken?: string
): Promise<SmartSuggestion | null> {
  try {
    const client = dbUrl && dbToken 
      ? getUserClient(dbUrl, dbToken)
      : getMasterClient()
    
    const result = await client.execute({
      sql: `SELECT * FROM smart_suggestions WHERE project_id = ?`,
      args: [projectId],
    })
    
    if (result.rows.length === 0) {
      return null
    }
    
    const row = result.rows[0]
    return {
      project_id: row.project_id as string,
      prompt: row.prompt as string,
      reason: row.reason as string,
      priority: row.priority as 'critical' | 'high' | 'normal' | 'low',
      context: row.context as string | null,
      phase: row.phase as string,
      step: row.step as string,
      synced_at: row.synced_at as string,
    }
  } catch (error) {
    console.error('Error fetching smart suggestion:', error)
    return null
  }
}

/**
 * Get the most recently synced smart suggestion (any project).
 * Used as fallback when the exact project ID doesn't match.
 */
export async function getLatestSmartSuggestion(
  dbUrl?: string,
  dbToken?: string
): Promise<SmartSuggestion | null> {
  try {
    const client = dbUrl && dbToken 
      ? getUserClient(dbUrl, dbToken)
      : getMasterClient()
    
    const result = await client.execute({
      sql: `SELECT * FROM smart_suggestions ORDER BY synced_at DESC LIMIT 1`,
      args: [],
    })
    
    if (result.rows.length === 0) {
      return null
    }
    
    const row = result.rows[0]
    return {
      project_id: row.project_id as string,
      prompt: row.prompt as string,
      reason: row.reason as string,
      priority: row.priority as 'critical' | 'high' | 'normal' | 'low',
      context: row.context as string | null,
      phase: row.phase as string,
      step: row.step as string,
      synced_at: row.synced_at as string,
    }
  } catch (error) {
    console.error('Error fetching latest smart suggestion:', error)
    return null
  }
}

// ============================================================================
// ERROR MEMORY
// ============================================================================

export interface ErrorMemory {
  id: number
  project_id: string
  error_id: string
  error_text: string
  file_path: string | null
  line_number: number | null
  first_seen: string
  last_seen: string
  fix_attempts: number
  fix_history: string | null
  resolved: boolean
  resolved_at: string | null
}

export async function getErrorMemory(
  projectId: string,
  dbUrl: string,
  dbToken: string,
  limit = 10
): Promise<ErrorMemory[]> {
  try {
    const client = getUserClient(dbUrl, dbToken)
    
    const result = await client.execute({
      sql: `SELECT * FROM error_memory WHERE project_id = ? ORDER BY last_seen DESC LIMIT ?`,
      args: [projectId, limit],
    })
    
    return result.rows.map(row => ({
      id: row.id as number,
      project_id: row.project_id as string,
      error_id: row.error_id as string,
      error_text: row.error_text as string,
      file_path: row.file_path as string | null,
      line_number: row.line_number as number | null,
      first_seen: row.first_seen as string,
      last_seen: row.last_seen as string,
      fix_attempts: row.fix_attempts as number,
      fix_history: row.fix_history as string | null,
      resolved: Boolean(row.resolved),
      resolved_at: row.resolved_at as string | null,
    }))
  } catch (error) {
    console.error('Error fetching error memory:', error)
    return []
  }
}

export async function getUnresolvedErrors(
  projectId: string,
  dbUrl: string,
  dbToken: string
): Promise<ErrorMemory[]> {
  try {
    const client = getUserClient(dbUrl, dbToken)
    
    const result = await client.execute({
      sql: `SELECT * FROM error_memory WHERE project_id = ? AND resolved = 0 ORDER BY fix_attempts DESC, last_seen DESC`,
      args: [projectId],
    })
    
    return result.rows.map(row => ({
      id: row.id as number,
      project_id: row.project_id as string,
      error_id: row.error_id as string,
      error_text: row.error_text as string,
      file_path: row.file_path as string | null,
      line_number: row.line_number as number | null,
      first_seen: row.first_seen as string,
      last_seen: row.last_seen as string,
      fix_attempts: row.fix_attempts as number,
      fix_history: row.fix_history as string | null,
      resolved: false,
      resolved_at: null,
    }))
  } catch (error) {
    console.error('Error fetching unresolved errors:', error)
    return []
  }
}

// ============================================================================
// STUCK DETECTION
// ============================================================================

export interface StuckStatus {
  lastProgressAt: string | null
  stuckSince: string | null
  stuckOnError: string | null
  timeInPhaseMs: number
  isStuck: boolean
  stuckDurationMs: number
}

export async function getStuckStatus(
  projectId: string,
  dbUrl: string,
  dbToken: string
): Promise<StuckStatus | null> {
  try {
    const client = getUserClient(dbUrl, dbToken)
    
    const result = await client.execute({
      sql: `SELECT last_progress_at, stuck_since, stuck_on_error, time_in_phase_ms FROM projects WHERE id = ?`,
      args: [projectId],
    })
    
    if (result.rows.length === 0) {
      return null
    }
    
    const row = result.rows[0]
    const stuckSince = row.stuck_since as string | null
    const stuckDurationMs = stuckSince 
      ? Date.now() - new Date(stuckSince).getTime()
      : 0
    
    return {
      lastProgressAt: row.last_progress_at as string | null,
      stuckSince,
      stuckOnError: row.stuck_on_error as string | null,
      timeInPhaseMs: (row.time_in_phase_ms as number) || 0,
      isStuck: Boolean(stuckSince),
      stuckDurationMs,
    }
  } catch (error) {
    console.error('Error fetching stuck status:', error)
    return null
  }
}

// ============================================================================
// SESSION METRICS
// ============================================================================

export interface SessionMetrics {
  id: number
  project_id: string
  session_date: string
  total_prompts: number
  accepted_prompts: number
  rejected_prompts: number
  commands_executed: number
  commands_succeeded: number
  commands_failed: number
  tornado_cycles: number
  time_in_build_ms: number
  time_stuck_ms: number
  errors_encountered: number
  errors_resolved: number
}

export async function getSessionMetrics(
  projectId: string,
  dbUrl: string,
  dbToken: string,
  days = 7
): Promise<SessionMetrics[]> {
  try {
    const client = getUserClient(dbUrl, dbToken)
    
    const result = await client.execute({
      sql: `SELECT * FROM session_metrics WHERE project_id = ? ORDER BY session_date DESC LIMIT ?`,
      args: [projectId, days],
    })
    
    return result.rows.map(row => ({
      id: row.id as number,
      project_id: row.project_id as string,
      session_date: row.session_date as string,
      total_prompts: (row.total_prompts as number) || 0,
      accepted_prompts: (row.accepted_prompts as number) || 0,
      rejected_prompts: (row.rejected_prompts as number) || 0,
      commands_executed: (row.commands_executed as number) || 0,
      commands_succeeded: (row.commands_succeeded as number) || 0,
      commands_failed: (row.commands_failed as number) || 0,
      tornado_cycles: (row.tornado_cycles as number) || 0,
      time_in_build_ms: (row.time_in_build_ms as number) || 0,
      time_stuck_ms: (row.time_stuck_ms as number) || 0,
      errors_encountered: (row.errors_encountered as number) || 0,
      errors_resolved: (row.errors_resolved as number) || 0,
    }))
  } catch (error) {
    console.error('Error fetching session metrics:', error)
    return []
  }
}

export async function getMetricsSummary(
  projectId: string,
  dbUrl: string,
  dbToken: string
): Promise<{
  totalPrompts: number
  acceptRate: number
  totalCommands: number
  successRate: number
  totalErrors: number
  resolveRate: number
} | null> {
  try {
    const client = getUserClient(dbUrl, dbToken)
    
    const result = await client.execute({
      sql: `SELECT 
        SUM(total_prompts) as total_prompts,
        SUM(accepted_prompts) as accepted_prompts,
        SUM(commands_executed) as commands_executed,
        SUM(commands_succeeded) as commands_succeeded,
        SUM(errors_encountered) as errors_encountered,
        SUM(errors_resolved) as errors_resolved
      FROM session_metrics WHERE project_id = ?`,
      args: [projectId],
    })
    
    if (result.rows.length === 0) {
      return null
    }
    
    const row = result.rows[0]
    const totalPrompts = (row.total_prompts as number) || 0
    const acceptedPrompts = (row.accepted_prompts as number) || 0
    const totalCommands = (row.commands_executed as number) || 0
    const commandsSucceeded = (row.commands_succeeded as number) || 0
    const totalErrors = (row.errors_encountered as number) || 0
    const errorsResolved = (row.errors_resolved as number) || 0
    
    return {
      totalPrompts,
      acceptRate: totalPrompts > 0 ? Math.round((acceptedPrompts / totalPrompts) * 100) : 0,
      totalCommands,
      successRate: totalCommands > 0 ? Math.round((commandsSucceeded / totalCommands) * 100) : 0,
      totalErrors,
      resolveRate: totalErrors > 0 ? Math.round((errorsResolved / totalErrors) * 100) : 0,
    }
  } catch (error) {
    console.error('Error fetching metrics summary:', error)
    return null
  }
}

// ============================================================================
// COMMAND HISTORY
// ============================================================================

export interface Command {
  id: number
  project_id: string
  command_type: string
  prompt: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  priority: number
  created_at: string
  started_at: string | null
  completed_at: string | null
  output: string | null
  error: string | null
  exit_code: number | null
  duration_ms: number | null
}

export async function getCommandHistory(
  projectId: string,
  dbUrl: string,
  dbToken: string,
  limit = 20,
  status?: 'pending' | 'running' | 'completed' | 'failed'
): Promise<Command[]> {
  try {
    const client = getUserClient(dbUrl, dbToken)
    
    let sql = `SELECT * FROM pending_commands WHERE project_id = ?`
    const args: (string | number)[] = [projectId]
    
    if (status) {
      sql += ` AND status = ?`
      args.push(status)
    }
    
    sql += ` ORDER BY created_at DESC LIMIT ?`
    args.push(limit)
    
    const result = await client.execute({ sql, args })
    
    return result.rows.map(row => ({
      id: row.id as number,
      project_id: row.project_id as string,
      command_type: row.command_type as string,
      prompt: row.prompt as string,
      status: row.status as 'pending' | 'running' | 'completed' | 'failed',
      priority: row.priority as number,
      created_at: row.created_at as string,
      started_at: row.started_at as string | null,
      completed_at: row.completed_at as string | null,
      output: row.output as string | null,
      error: row.error as string | null,
      exit_code: row.exit_code as number | null,
      duration_ms: row.duration_ms as number | null,
    }))
  } catch (error) {
    console.error('Error fetching command history:', error)
    return []
  }
}

export { getClient }
