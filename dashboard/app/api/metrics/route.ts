import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUserByGithubId, getSessionMetrics, getMetricsSummary } from "@/lib/db"

/**
 * GET /api/metrics?projectId=xxx&days=7
 * 
 * Returns session metrics for a project.
 */
export async function GET(request: Request) {
  const session = await auth()
  
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const days = parseInt(searchParams.get('days') || '7', 10)
  
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 })
  }
  
  try {
    const githubId = session.user.githubId as number
    
    // Get user's DB credentials
    const user = await getUserByGithubId(githubId)
    if (!user?.db_url || !user?.db_token) {
      return NextResponse.json({ 
        dailyMetrics: [],
        summary: null 
      })
    }
    
    // Get daily metrics and summary
    const [dailyMetrics, summary] = await Promise.all([
      getSessionMetrics(projectId, user.db_url, user.db_token, days),
      getMetricsSummary(projectId, user.db_url, user.db_token),
    ])
    
    return NextResponse.json({ dailyMetrics, summary })
  } catch (error) {
    console.error('Metrics fetch error:', error)
    return NextResponse.json({ 
      error: "Failed to fetch metrics",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
