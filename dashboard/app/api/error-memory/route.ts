import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUserByGithubId, getErrorMemory, getUnresolvedErrors } from "@/lib/db"

/**
 * GET /api/error-memory?projectId=xxx&resolved=false
 * 
 * Returns error memory for a project.
 */
export async function GET(request: Request) {
  const session = await auth()
  
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const resolvedParam = searchParams.get('resolved')
  
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 })
  }
  
  try {
    const githubId = session.user.githubId as number
    
    // Get user's DB credentials
    const user = await getUserByGithubId(githubId)
    if (!user?.db_url || !user?.db_token) {
      return NextResponse.json({ errors: [] })
    }
    
    // Get errors based on filter
    const errors = resolvedParam === 'false'
      ? await getUnresolvedErrors(projectId, user.db_url, user.db_token)
      : await getErrorMemory(projectId, user.db_url, user.db_token)
    
    return NextResponse.json({ errors })
  } catch (error) {
    console.error('Error memory fetch error:', error)
    return NextResponse.json({ 
      error: "Failed to fetch error memory",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
