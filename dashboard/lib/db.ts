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
}

export async function createUser(githubUserId: number, githubUsername: string): Promise<UserRecord> {
  const client = getMasterClient()
  await client.execute({
    sql: 'INSERT INTO users (github_user_id, github_username) VALUES (?, ?)',
    args: [githubUserId, githubUsername],
  })
  
  return (await getUserByGithubId(githubUserId))!
}

export async function updateUserDatabase(
  githubUserId: number,
  dbName: string,
  dbUrl: string,
  dbToken: string
): Promise<void> {
  const client = getMasterClient()
  await client.execute({
    sql: 'UPDATE users SET db_name = ?, db_url = ?, db_token = ?, provisioned_at = ? WHERE github_user_id = ?',
    args: [dbName, dbUrl, dbToken, new Date().toISOString(), githubUserId],
  })
}

export async function getOrCreateUser(githubUserId: number, githubUsername: string): Promise<UserRecord> {
  let user = await getUserByGithubId(githubUserId)
  if (!user) {
    user = await createUser(githubUserId, githubUsername)
  }
  return user
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
}

export async function getRecentEvents(
  projectId: string,
  limit = 10,
  dbUrl?: string,
  dbToken?: string
): Promise<Event[]> {
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
}

export async function updatePilotSession(
  sessionId: string,
  updates: Partial<Pick<PilotSession, 'status' | 'current_project' | 'current_task' | 'last_output' | 'output_lines'>>
): Promise<void> {
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
}

export async function getActivePilotSession(githubUserId: number): Promise<PilotSession | null> {
  const client = getMasterClient()
  const result = await client.execute({
    sql: `SELECT * FROM pilot_sessions 
          WHERE github_user_id = ? 
            AND status != 'disconnected'
            AND (expires_at IS NULL OR expires_at > datetime('now'))
          ORDER BY created_at DESC 
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
}

export async function addCommandToQueue(
  githubUserId: number,
  projectId: string,
  commandType: string,
  prompt: string,
  priority = 0,
  maxTurns = 10
): Promise<number> {
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
}

export { getClient }
