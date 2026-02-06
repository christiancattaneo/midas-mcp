import { NextResponse } from "next/server"
import { createPilotSession, getActivePilotSession, getUserByGithubId } from "@/lib/db"

const GITHUB_API_TIMEOUT_MS = 10000 // 10 second timeout for GitHub API

/**
 * POST /api/pilot-session
 * 
 * Create or update a pilot session (called by CLI)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { 
      session_id, 
      session_token, 
      github_user_id, 
      github_access_token,
      expires_at 
    } = body
    
    if (!session_id || !session_token || !github_user_id || !github_access_token) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }
    
    // Verify GitHub token
    const githubResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${github_access_token}`,
        'Accept': 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    })
    
    if (!githubResponse.ok) {
      return NextResponse.json({ error: "Invalid GitHub token" }, { status: 401 })
    }
    
    const githubUser = await githubResponse.json()
    if (githubUser.id !== github_user_id) {
      return NextResponse.json({ error: "User ID mismatch" }, { status: 403 })
    }
    
    // Create session
    await createPilotSession(session_id, github_user_id, session_token, expires_at)
    
    return NextResponse.json({ success: true, session_id })
  } catch (error) {
    console.error('Error creating pilot session:', error)
    return NextResponse.json({ 
      error: "Internal server error",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}

/**
 * GET /api/pilot-session?github_user_id=123
 * 
 * Get active pilot session for a user
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const githubUserId = searchParams.get('github_user_id')
  
  if (!githubUserId) {
    return NextResponse.json({ error: "Missing github_user_id" }, { status: 400 })
  }
  
  try {
    const session = await getActivePilotSession(Number(githubUserId))
    
    if (!session) {
      return NextResponse.json({ active: false })
    }
    
    // Don't expose the session token
    return NextResponse.json({
      active: true,
      session: {
        id: session.id,
        status: session.status,
        current_project: session.current_project,
        current_task: session.current_task,
        output_lines: session.output_lines,
        last_heartbeat: session.last_heartbeat,
        created_at: session.created_at,
      }
    })
  } catch (error) {
    console.error('Error getting pilot session:', error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
