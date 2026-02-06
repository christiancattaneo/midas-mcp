import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUserByGithubId, getCommandHistory } from "@/lib/db"

/**
 * GET /api/command-history?projectId=xxx&limit=20&status=completed
 * 
 * Returns command history for a project.
 */
export async function GET(request: Request) {
  const session = await auth()
  
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const limit = parseInt(searchParams.get('limit') || '20', 10)
  const status = searchParams.get('status') as 'pending' | 'running' | 'completed' | 'failed' | null
  
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 })
  }
  
  try {
    const githubId = session.user.githubId as number
    
    // Get user's DB credentials
    const user = await getUserByGithubId(githubId)
    if (!user?.db_url || !user?.db_token) {
      return NextResponse.json({ commands: [] })
    }
    
    // Get command history
    const commands = await getCommandHistory(
      projectId, 
      user.db_url, 
      user.db_token,
      limit,
      status || undefined
    )
    
    return NextResponse.json({ commands })
  } catch (error) {
    console.error('Command history fetch error:', error)
    return NextResponse.json({ 
      error: "Failed to fetch command history",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
