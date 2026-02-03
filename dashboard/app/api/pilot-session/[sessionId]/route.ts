import { NextResponse } from "next/server"
import { getPilotSession, getPilotSessionByToken, updatePilotSession } from "@/lib/db"

/**
 * GET /api/pilot-session/[sessionId]?token=xxx
 * 
 * Get pilot session details (for phone dashboard)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')
  
  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 400 })
  }
  
  try {
    const session = await getPilotSessionByToken(sessionId, token)
    
    if (!session) {
      return NextResponse.json({ error: "Session not found or invalid token" }, { status: 404 })
    }
    
    // Check if expired
    if (session.expires_at && new Date(session.expires_at) < new Date()) {
      return NextResponse.json({ error: "Session expired" }, { status: 410 })
    }
    
    return NextResponse.json({
      session: {
        id: session.id,
        status: session.status,
        current_project: session.current_project,
        current_task: session.current_task,
        last_output: session.last_output,
        output_lines: session.output_lines,
        last_heartbeat: session.last_heartbeat,
        created_at: session.created_at,
        expires_at: session.expires_at,
      }
    })
  } catch (error) {
    console.error('Error getting pilot session:', error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * PATCH /api/pilot-session/[sessionId]
 * 
 * Update pilot session status (called by CLI)
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params
  
  // Verify request is from the CLI with valid auth
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: "Authorization required" }, { status: 401 })
  }
  
  const token = authHeader.slice(7)
  
  // Verify GitHub token
  const githubResponse = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
    },
  })
  
  if (!githubResponse.ok) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }
  
  const githubUser = await githubResponse.json()
  
  // Verify session ownership
  const session = await getPilotSession(sessionId)
  if (!session || session.github_user_id !== githubUser.id) {
    return NextResponse.json({ error: "Session not found or not owned" }, { status: 404 })
  }
  
  try {
    const body = await request.json()
    const { status, current_project, current_task, last_output, output_lines } = body
    
    await updatePilotSession(sessionId, {
      status,
      current_project,
      current_task,
      last_output,
      output_lines,
    })
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating pilot session:', error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
