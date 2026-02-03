import { NextResponse } from "next/server"
import { getOrCreateUser, updateUserDatabase, getUserByGithubId } from "@/lib/db"
import { createUserDatabase, initializeUserSchema } from "@/lib/turso-provisioning"

/**
 * GET /api/credentials?github_user_id=123&github_access_token=xxx
 * 
 * Returns the user's personal database credentials.
 * If the user doesn't have a database yet, provisions one.
 * 
 * This endpoint is called by the CLI after GitHub OAuth.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const githubUserId = searchParams.get('github_user_id')
  const githubAccessToken = searchParams.get('github_access_token')
  
  if (!githubUserId || !githubAccessToken) {
    return NextResponse.json({ error: "Missing github_user_id or github_access_token" }, { status: 400 })
  }
  
  // Verify the GitHub access token
  const githubResponse = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${githubAccessToken}`,
      'Accept': 'application/vnd.github+json',
    },
  })
  
  if (!githubResponse.ok) {
    return NextResponse.json({ error: "Invalid GitHub access token" }, { status: 401 })
  }
  
  const githubUser = await githubResponse.json()
  
  // Verify the user ID matches
  if (String(githubUser.id) !== githubUserId) {
    return NextResponse.json({ error: "GitHub user ID mismatch" }, { status: 403 })
  }
  
  try {
    // Get or create user record
    let user = await getOrCreateUser(Number(githubUserId), githubUser.login)
    
    // Check if user has a database
    if (!user.db_url || !user.db_token) {
      // Provision a new database
      console.log(`Provisioning database for user ${githubUser.login} (${githubUserId})`)
      
      const dbInfo = await createUserDatabase(Number(githubUserId))
      
      if (!dbInfo) {
        return NextResponse.json({ 
          error: "Failed to provision database. Please try again." 
        }, { status: 500 })
      }
      
      // Initialize schema
      const schemaOk = await initializeUserSchema(dbInfo.dbUrl, dbInfo.dbToken)
      
      if (!schemaOk) {
        return NextResponse.json({ 
          error: "Failed to initialize database schema. Please try again." 
        }, { status: 500 })
      }
      
      // Save credentials
      await updateUserDatabase(
        Number(githubUserId),
        dbInfo.dbName,
        dbInfo.dbUrl,
        dbInfo.dbToken
      )
      
      // Refresh user record
      user = (await getUserByGithubId(Number(githubUserId)))!
      
      console.log(`Database provisioned: ${dbInfo.dbName}`)
    }
    
    // Return credentials
    return NextResponse.json({
      success: true,
      db_url: user.db_url,
      db_token: user.db_token,
      db_name: user.db_name,
      provisioned: !!user.provisioned_at,
    })
  } catch (error) {
    console.error('Error in credentials endpoint:', error)
    return NextResponse.json({ 
      error: "Internal server error",
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
