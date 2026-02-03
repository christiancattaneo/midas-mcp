/**
 * Turso Database Provisioning
 * 
 * Creates per-user databases via the Turso Platform API.
 * Each user gets their own isolated database for security.
 */

const TURSO_ORG = 'christiancattaneo'
const TURSO_GROUP = 'default'
const TURSO_API_BASE = 'https://api.turso.tech/v1'

interface CreateDatabaseResponse {
  database: {
    DbId: string
    Hostname: string
    Name: string
  }
}

interface CreateTokenResponse {
  jwt: string
}

/**
 * Create a new Turso database for a user
 */
export async function createUserDatabase(githubUserId: number): Promise<{
  dbName: string
  dbUrl: string
  dbToken: string
} | null> {
  const platformToken = process.env.TURSO_PLATFORM_TOKEN
  
  if (!platformToken) {
    console.error('TURSO_PLATFORM_TOKEN not configured')
    return null
  }
  
  const dbName = `midas-user-${githubUserId}`
  
  try {
    // 1. Create the database
    const createResponse = await fetch(
      `${TURSO_API_BASE}/organizations/${TURSO_ORG}/databases`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${platformToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: dbName,
          group: TURSO_GROUP,
        }),
      }
    )
    
    if (!createResponse.ok) {
      // Database might already exist (409 Conflict)
      if (createResponse.status === 409) {
        console.log(`Database ${dbName} already exists, generating new token`)
      } else {
        const errorText = await createResponse.text()
        console.error(`Failed to create database: ${createResponse.status} ${errorText}`)
        return null
      }
    }
    
    // 2. Generate auth token for the database
    const tokenResponse = await fetch(
      `${TURSO_API_BASE}/organizations/${TURSO_ORG}/databases/${dbName}/auth/tokens?authorization=full-access`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${platformToken}`,
        },
      }
    )
    
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error(`Failed to create token: ${tokenResponse.status} ${errorText}`)
      return null
    }
    
    const tokenData = await tokenResponse.json() as CreateTokenResponse
    
    // Construct the database URL
    const dbUrl = `libsql://${dbName}-${TURSO_ORG}.turso.io`
    
    return {
      dbName,
      dbUrl,
      dbToken: tokenData.jwt,
    }
  } catch (error) {
    console.error('Error provisioning database:', error)
    return null
  }
}

/**
 * Initialize schema in user's database
 */
export async function initializeUserSchema(dbUrl: string, dbToken: string): Promise<boolean> {
  // Convert libsql:// to https:// for HTTP API
  const httpUrl = dbUrl.replace('libsql://', 'https://')
  
  const schemas = [
    `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      local_path TEXT NOT NULL,
      current_phase TEXT DEFAULT 'IDLE',
      current_step TEXT DEFAULT '',
      progress INTEGER DEFAULT 0,
      last_synced TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS gameplan_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      task_text TEXT NOT NULL,
      phase TEXT,
      completed INTEGER DEFAULT 0,
      priority TEXT,
      task_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, task_id)
    )`,
    `CREATE TABLE IF NOT EXISTS pending_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
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
      session_id TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS gates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      compiles INTEGER,
      tests_pass INTEGER,
      lints_pass INTEGER,
      checked_at TEXT
    )`,
  ]
  
  try {
    for (const sql of schemas) {
      const response = await fetch(`${httpUrl}/v2/pipeline`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${dbToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            { type: 'execute', stmt: { sql } },
            { type: 'close' }
          ]
        }),
      })
      
      if (!response.ok) {
        console.error(`Failed to execute schema: ${await response.text()}`)
        return false
      }
    }
    
    return true
  } catch (error) {
    console.error('Error initializing schema:', error)
    return false
  }
}
