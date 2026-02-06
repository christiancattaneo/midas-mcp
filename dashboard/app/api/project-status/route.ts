import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUserByGithubId, getSmartSuggestion, getLatestSmartSuggestion, getActivePilotSession, getRecentCommands, getStuckStatus, getUnresolvedErrors } from "@/lib/db"

/**
 * GET /api/project-status?projectId=xxx
 * 
 * Returns smart suggestion, watcher status, active command, and live output.
 * Polled by the dashboard - faster when executing (1.5s) vs idle (5s).
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
        pilotSession: null,
      })
    }
    
    // Get smart suggestion - try exact project ID first, fall back to latest
    let smartSuggestion = await getSmartSuggestion(projectId, user.db_url, user.db_token)
    if (!smartSuggestion) {
      smartSuggestion = await getLatestSmartSuggestion(user.db_url, user.db_token)
    }
    
    // Get watcher/pilot session status
    const activePilot = await getActivePilotSession(githubId)
    
    // Check for active/recent commands (get more to show completed ones too)
    const recentCommands = await getRecentCommands(projectId, 5, user.db_url, user.db_token)
    const activeCommand = recentCommands.find(c => c.status === 'pending' || c.status === 'running')
    // Also get the most recently completed command (to show results)
    const lastCompleted = recentCommands.find(c => c.status === 'completed' || c.status === 'failed')
    
    // Determine watcher status
    let watcherStatus: { connected: boolean; lastHeartbeat: string | null; currentTask: string | null; status: 'idle' | 'running' | 'disconnected' }
    
    if (activePilot) {
      watcherStatus = {
        connected: true,
        lastHeartbeat: activePilot.last_heartbeat,
        currentTask: activePilot.current_task,
        status: activePilot.status === 'running' ? 'running' : 'idle',
      }
    } else {
      watcherStatus = {
        connected: false,
        lastHeartbeat: null,
        currentTask: null,
        status: 'disconnected',
      }
    }
    
    // Pilot session live output (streamed from Claude Code)
    const pilotSessionData = activePilot ? {
      last_output: activePilot.last_output,
      output_lines: activePilot.output_lines,
      current_task: activePilot.current_task,
    } : null
    
    return NextResponse.json({
      smartSuggestion,
      watcherStatus,
      activeCommand: activeCommand || lastCompleted || null,
      pilotSession: pilotSessionData,
    })
  } catch (error) {
    console.error('Project status error:', error)
    return NextResponse.json({ 
      error: "Failed to fetch status",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
