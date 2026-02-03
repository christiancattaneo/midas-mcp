import { NextResponse } from "next/server"
import { getPilotSessionByToken, getUserClientForUser, getUserByGithubId } from "@/lib/db"

/**
 * POST /api/pilot-command
 * 
 * Send a command to the pilot using session token (no login required)
 * This is called from the mobile pilot page
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { sessionId, sessionToken, prompt, commandType, priority } = body
    
    if (!sessionId || !sessionToken || !prompt) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }
    
    // Verify session exists and token matches
    const session = await getPilotSessionByToken(sessionId, sessionToken)
    
    if (!session) {
      return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 })
    }
    
    const githubUserId = session.github_user_id as number
    
    // Get user's personal database
    const user = await getUserByGithubId(githubUserId)
    if (!user?.db_url || !user?.db_token) {
      return NextResponse.json({ error: "User database not provisioned" }, { status: 400 })
    }
    
    const userClient = getUserClientForUser(user.db_url, user.db_token)
    
    // Find a default project (first one, or use the one from session)
    let projectId = 'default'
    
    const projectResult = await userClient.execute({
      sql: 'SELECT id FROM projects LIMIT 1',
      args: [],
    })
    
    if (projectResult.rows.length > 0) {
      projectId = projectResult.rows[0].id as string
    }
    
    // Insert command into user's personal DB
    const result = await userClient.execute({
      sql: `INSERT INTO pending_commands 
            (project_id, command_type, prompt, max_turns, priority, status, created_at, session_id)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      args: [
        projectId,
        commandType || 'task',
        prompt,
        10,
        priority || 1,
        new Date().toISOString(),
        sessionId,
      ],
    })
    
    return NextResponse.json({ 
      success: true, 
      commandId: Number(result.lastInsertRowid),
      projectId,
    })
  } catch (error) {
    console.error('Pilot command error:', error)
    return NextResponse.json({ 
      error: "Failed to send command",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
