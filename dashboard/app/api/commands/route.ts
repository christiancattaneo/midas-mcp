import { auth } from "@/auth"
import { getUserByGithubId, getUserClientForUser } from "@/lib/db"
import { NextResponse } from "next/server"

// POST /api/commands - Create a new pending command
export async function POST(request: Request) {
  const session = await auth()
  
  if (!session?.user?.githubId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  
  try {
    const body = await request.json()
    const { projectId, commandType, prompt, maxTurns, priority } = body
    
    if (!projectId || !prompt) {
      return NextResponse.json({ error: "Missing projectId or prompt" }, { status: 400 })
    }
    
    // Get user's personal database client
    const user = await getUserByGithubId(session.user.githubId as number)
    if (!user?.db_url || !user?.db_token) {
      return NextResponse.json({ error: "User database not provisioned. Run 'midas login' first." }, { status: 400 })
    }
    
    const client = getUserClientForUser(user.db_url, user.db_token)
    
    // Verify user owns the project (in their personal DB)
    const projectResult = await client.execute({
      sql: 'SELECT id FROM projects WHERE id = ?',
      args: [projectId],
    })
    
    if (projectResult.rows.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }
    
    // Create the pending command in user's personal DB
    const result = await client.execute({
      sql: `INSERT INTO pending_commands 
            (project_id, command_type, prompt, max_turns, priority, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      args: [
        projectId,
        commandType || 'task',
        prompt,
        maxTurns || 10,
        priority || 0,
        new Date().toISOString(),
      ],
    })
    
    return NextResponse.json({ 
      success: true, 
      commandId: Number(result.lastInsertRowid),
      message: "Command queued. Run 'midas pilot --watch' to execute."
    })
  } catch (error) {
    console.error('Failed to create command:', error)
    return NextResponse.json({ 
      error: "Failed to create command",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}

// GET /api/commands - Get pending/recent commands for a project
export async function GET(request: Request) {
  const session = await auth()
  
  if (!session?.user?.githubId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 })
  }
  
  try {
    // Get user's personal database client
    const user = await getUserByGithubId(session.user.githubId as number)
    if (!user?.db_url || !user?.db_token) {
      return NextResponse.json({ error: "User database not provisioned" }, { status: 400 })
    }
    
    const client = getUserClientForUser(user.db_url, user.db_token)
    
    // Fetch recent commands from user's personal DB
    const result = await client.execute({
      sql: `SELECT * FROM pending_commands 
            WHERE project_id = ? 
            ORDER BY created_at DESC 
            LIMIT 20`,
      args: [projectId],
    })
    
    const commands = result.rows.map(row => ({
      id: row.id,
      command_type: row.command_type,
      prompt: row.prompt,
      status: row.status,
      created_at: row.created_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      output: row.output,
      error: row.error,
      exit_code: row.exit_code,
      duration_ms: row.duration_ms,
    }))
    
    return NextResponse.json({ commands })
  } catch (error) {
    console.error('Failed to fetch commands:', error)
    return NextResponse.json({ 
      error: "Failed to fetch commands" 
    }, { status: 500 })
  }
}
