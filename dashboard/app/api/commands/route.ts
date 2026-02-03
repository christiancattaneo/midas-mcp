import { auth } from "@/auth"
import { getClient } from "@/lib/db"
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
    
    const client = getClient()
    
    // Verify user owns the project
    const projectResult = await client.execute({
      sql: 'SELECT github_user_id FROM projects WHERE id = ?',
      args: [projectId],
    })
    
    if (projectResult.rows.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }
    
    const projectUserId = projectResult.rows[0].github_user_id
    if (projectUserId !== session.user.githubId) {
      return NextResponse.json({ error: "Not authorized for this project" }, { status: 403 })
    }
    
    // Create the pending command
    const result = await client.execute({
      sql: `INSERT INTO pending_commands 
            (project_id, github_user_id, command_type, prompt, max_turns, priority, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        projectId,
        session.user.githubId,
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
    const client = getClient()
    
    // Verify user owns the project
    const projectResult = await client.execute({
      sql: 'SELECT github_user_id FROM projects WHERE id = ?',
      args: [projectId],
    })
    
    if (projectResult.rows.length === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }
    
    const projectUserId = projectResult.rows[0].github_user_id
    if (projectUserId !== session.user.githubId) {
      return NextResponse.json({ error: "Not authorized for this project" }, { status: 403 })
    }
    
    // Fetch recent commands
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
