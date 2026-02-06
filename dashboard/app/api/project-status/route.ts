import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUserByGithubId, getSmartSuggestion, getActivePilotSession, getRecentCommands, getStuckStatus, getUnresolvedErrors } from "@/lib/db"

/**
 * GET /api/project-status?projectId=xxx
 * 
 * Returns smart suggestion and watcher status for a project.
 * Used for real-time polling in the Dashboard.
 */
export async function GET(request: Request) {
  const session = await auth()
  
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 })
  }
  
  try {
    const githubId = session.user.githubId as number
    
    // Get user's DB credentials
    const user = await getUserByGithubId(githubId)
    if (!user?.db_url || !user?.db_token) {
      return NextResponse.json({
        smartSuggestion: null,
        watcherStatus: { connected: false, lastHeartbeat: null, currentTask: null, status: 'disconnected' },
        activeCommand: null,
        stuckStatus: null,
        unresolvedErrorCount: 0,
      })
    }
    
    // Get smart suggestion
    const smartSuggestion = await getSmartSuggestion(projectId, user.db_url, user.db_token)
    
    // Get watcher/pilot session status
    const pilotSession = await getActivePilotSession(githubId)
    
    // Check for active commands
    const recentCommands = await getRecentCommands(projectId, 1, user.db_url, user.db_token)
    const activeCommand = recentCommands.find(c => c.status === 'pending' || c.status === 'running')
    
    // Get stuck status and unresolved errors for dashboard alerts
    const [stuckStatus, unresolvedErrors] = await Promise.all([
      getStuckStatus(projectId, user.db_url, user.db_token),
      getUnresolvedErrors(projectId, user.db_url, user.db_token),
    ])
    
    // Determine watcher status
    // getActivePilotSession already filters out stale sessions (no heartbeat in 90s)
    // so if we get a session back, it's genuinely alive
    let watcherStatus: { connected: boolean; lastHeartbeat: string | null; currentTask: string | null; status: 'idle' | 'running' | 'disconnected' }
    
    if (pilotSession) {
      watcherStatus = {
        connected: true,
        lastHeartbeat: pilotSession.last_heartbeat,
        currentTask: pilotSession.current_task,
        status: pilotSession.status === 'running' ? 'running' : 'idle',
      }
    } else {
      watcherStatus = {
        connected: false,
        lastHeartbeat: null,
        currentTask: null,
        status: 'disconnected',
      }
    }
    
    return NextResponse.json({
      smartSuggestion,
      watcherStatus,
      activeCommand: activeCommand || null,
      stuckStatus,
      unresolvedErrorCount: unresolvedErrors.length,
    })
  } catch (error) {
    console.error('Project status error:', error)
    return NextResponse.json({ 
      error: "Failed to fetch status",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
