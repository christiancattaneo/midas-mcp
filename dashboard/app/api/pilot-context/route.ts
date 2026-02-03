import { NextResponse } from "next/server"
import { getPilotSessionByToken, getUserClientForUser, getUserByGithubId, getSmartSuggestion } from "@/lib/db"

/**
 * GET /api/pilot-context?sessionId=X&token=Y
 * 
 * Get project context for mobile pilot.
 * Uses data synced via `midas sync` - including smart suggestions from getSmartPromptSuggestion()
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('sessionId')
  const sessionToken = searchParams.get('token')
  
  if (!sessionId || !sessionToken) {
    return NextResponse.json({ error: "Missing session credentials" }, { status: 400 })
  }
  
  try {
    // Verify session
    const session = await getPilotSessionByToken(sessionId, sessionToken)
    if (!session) {
      return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 })
    }
    
    const githubUserId = session.github_user_id
    
    // Get user's personal database
    const user = await getUserByGithubId(githubUserId)
    if (!user?.db_url || !user?.db_token) {
      return NextResponse.json({ 
        projects: [],
        activeProject: null,
        smartSuggestion: null,
        gameplanTasks: [],
        gates: null,
        quickActions: getQuickActions('IDLE', 'IDLE'),
      })
    }
    
    const userClient = getUserClientForUser(user.db_url, user.db_token)
    
    // Get projects
    const projectsResult = await userClient.execute({
      sql: 'SELECT id, name, current_phase, current_step, progress FROM projects ORDER BY last_synced DESC LIMIT 10',
      args: [],
    })
    
    const projects = projectsResult.rows.map(row => ({
      id: row.id as string,
      name: row.name as string,
      phase: row.current_phase as string,
      step: row.current_step as string,
      progress: row.progress as number,
    }))
    
    // Use first project as active
    const activeProject = projects[0] || null
    
    // Get smart suggestion (synced from CLI via midas sync)
    let smartSuggestion = null
    if (activeProject) {
      smartSuggestion = await getSmartSuggestion(activeProject.id, user.db_url, user.db_token)
    }
    
    // Get gameplan tasks for active project
    let gameplanTasks: { id: number; task: string; completed: boolean; phase: string | null }[] = []
    if (activeProject) {
      const tasksResult = await userClient.execute({
        sql: `SELECT id, task_id, task_text, phase, completed 
              FROM gameplan_tasks 
              WHERE project_id = ? 
              ORDER BY task_order ASC 
              LIMIT 20`,
        args: [activeProject.id],
      })
      
      gameplanTasks = tasksResult.rows.map(row => ({
        id: row.id as number,
        task: row.task_text as string,
        completed: Boolean(row.completed),
        phase: row.phase as string | null,
      }))
    }
    
    // Get gates status
    let gates: { compiles: boolean | null; tests: boolean | null; lints: boolean | null } | null = null
    if (activeProject) {
      const gatesResult = await userClient.execute({
        sql: `SELECT compiles, tests_pass, lints_pass 
              FROM gates 
              WHERE project_id = ? 
              ORDER BY checked_at DESC 
              LIMIT 1`,
        args: [activeProject.id],
      })
      
      if (gatesResult.rows.length > 0) {
        const row = gatesResult.rows[0]
        gates = {
          compiles: row.compiles === null ? null : Boolean(row.compiles),
          tests: row.tests_pass === null ? null : Boolean(row.tests_pass),
          lints: row.lints_pass === null ? null : Boolean(row.lints_pass),
        }
      }
    }
    
    // Find next incomplete task
    const nextTask = gameplanTasks.find(t => !t.completed)
    
    // Generate quick actions based on context
    const quickActions = getQuickActions(
      activeProject?.phase || 'IDLE',
      activeProject?.step || '',
      gates,
      nextTask
    )
    
    return NextResponse.json({
      projects,
      activeProject,
      smartSuggestion,  // From synced data (uses getSmartPromptSuggestion from CLI)
      gameplanTasks,
      gates,
      nextTask: nextTask || null,
      quickActions,
    })
  } catch (error) {
    console.error('Pilot context error:', error)
    return NextResponse.json({ 
      error: "Failed to fetch context",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}

interface QuickAction {
  id: string
  icon: string
  label: string
  prompt: string
}

function getQuickActions(
  phase: string,
  step: string,
  gates?: { compiles: boolean | null; tests: boolean | null; lints: boolean | null } | null,
  nextTask?: { task: string } | null
): QuickAction[] {
  const actions: QuickAction[] = []
  
  // If there's a synced smart suggestion, the UI will show that as primary
  // These are secondary quick actions
  
  // Failing gates get priority
  if (gates?.compiles === false) {
    actions.push({
      id: 'fix-build',
      icon: '🔨',
      label: 'Fix Build',
      prompt: 'Fix all compilation/build errors',
    })
  }
  
  if (gates?.tests === false) {
    actions.push({
      id: 'fix-tests',
      icon: '🧪',
      label: 'Fix Tests',
      prompt: 'Fix failing tests',
    })
  }
  
  if (gates?.lints === false) {
    actions.push({
      id: 'fix-lints',
      icon: '🔍',
      label: 'Fix Lints',
      prompt: 'Fix linter errors',
    })
  }
  
  // Phase-specific actions
  switch (phase) {
    case 'PLAN':
      actions.push({
        id: 'continue-planning',
        icon: '📋',
        label: 'Continue Planning',
        prompt: `Continue with ${step || 'planning'} phase`,
      })
      break
    case 'BUILD':
      actions.push({
        id: 'implement',
        icon: '⚡',
        label: 'Implement',
        prompt: 'Continue implementation',
      })
      if (step === 'DEBUG') {
        actions.push({
          id: 'tornado',
          icon: '🌪️',
          label: 'Tornado Debug',
          prompt: 'Use Tornado debugging: 1) Research error, 2) Add logs, 3) Write test',
        })
      }
      break
    case 'SHIP':
      actions.push({
        id: 'review',
        icon: '👁️',
        label: 'Review',
        prompt: 'Perform code review for security, performance, and quality',
      })
      break
    case 'GROW':
      actions.push({
        id: 'retrospective',
        icon: '📊',
        label: 'Retrospective',
        prompt: 'Generate retrospective summary',
      })
      break
  }
  
  // Always available
  actions.push({
    id: 'verify',
    icon: '✓',
    label: 'Verify All',
    prompt: 'Run all verification gates (build, test, lint)',
  })
  
  actions.push({
    id: 'analyze',
    icon: '💡',
    label: 'Analyze',
    prompt: 'Analyze current state and suggest next step',
  })
  
  return actions
}
