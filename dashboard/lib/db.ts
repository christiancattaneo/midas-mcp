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

export async function getLatestGates(projectId: string): Promise<GatesStatus | null> {
  const client = getClient()
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

export async function getRecentEvents(projectId: string, limit = 10): Promise<Event[]> {
  const client = getClient()
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

export async function getGameplanTasks(projectId: string): Promise<GameplanTask[]> {
  const client = getClient()
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

export async function getPendingCommands(projectId: string): Promise<PendingCommand[]> {
  const client = getClient()
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

export async function getRecentCommands(projectId: string, limit = 10): Promise<PendingCommand[]> {
  const client = getClient()
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

export { getClient }
