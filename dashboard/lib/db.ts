import { createClient, Client } from '@libsql/client'

let _client: Client | null = null

function getClient(): Client {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL
    const authToken = process.env.TURSO_AUTH_TOKEN
    
    if (!url) {
      throw new Error('TURSO_DATABASE_URL is not configured')
    }
    
    _client = createClient({
      url,
      authToken,
    })
  }
  return _client
}

export interface Project {
  id: string
  github_user_id: number
  github_username: string
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

export async function getProjectsByUser(githubUserId: number): Promise<Project[]> {
  const client = getClient()
  const result = await client.execute({
    sql: 'SELECT * FROM projects WHERE github_user_id = ? ORDER BY last_synced DESC',
    args: [githubUserId],
  })
  
  return result.rows.map(row => ({
    id: row.id as string,
    github_user_id: row.github_user_id as number,
    github_username: row.github_username as string,
    name: row.name as string,
    local_path: row.local_path as string,
    current_phase: row.current_phase as string,
    current_step: row.current_step as string,
    progress: row.progress as number,
    last_synced: row.last_synced as string,
    created_at: row.created_at as string,
  }))
}

export async function getProjectById(projectId: string): Promise<Project | null> {
  const client = getClient()
  const result = await client.execute({
    sql: 'SELECT * FROM projects WHERE id = ?',
    args: [projectId],
  })
  
  if (result.rows.length === 0) return null
  
  const row = result.rows[0]
  return {
    id: row.id as string,
    github_user_id: row.github_user_id as number,
    github_username: row.github_username as string,
    name: row.name as string,
    local_path: row.local_path as string,
    current_phase: row.current_phase as string,
    current_step: row.current_step as string,
    progress: row.progress as number,
    last_synced: row.last_synced as string,
    created_at: row.created_at as string,
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

export { getClient }
