import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getProjectsByUser, getUserByGithubId } from "@/lib/db"
import Link from "next/link"
import { ThemeToggle } from "@/components/ThemeToggle"
import { MetricsDisplay } from "@/components/MetricsDisplay"

export default async function MetricsPage() {
  const session = await auth()
  
  if (!session?.user) {
    redirect("/")
  }
  
  const user = session.user
  const githubId = user.githubId as unknown as number
  const projects = await getProjectsByUser(githubId)
  
  // Get user's DB credentials
  const userRecord = await getUserByGithubId(githubId)
  const hasCredentials = Boolean(userRecord?.db_url && userRecord?.db_token)
  
  return (
    <main className="min-h-screen p-6 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link 
              href="/dashboard" 
              className="btn-secondary py-2 px-4 text-sm font-mono"
            >
              ← BACK
            </Link>
            <div>
              <h1 className="text-xl font-bold font-mono">ANALYTICS</h1>
              <p className="text-dim text-xs font-mono">// PERFORMANCE METRICS</p>
            </div>
          </div>
          <ThemeToggle />
        </header>
        
        {!hasCredentials ? (
          <div className="card text-center py-16">
            <div className="text-4xl mb-4">📊</div>
            <p className="text-dim font-mono mb-6">NO DATABASE CONNECTED</p>
            <p className="text-sm text-dim">
              Connect your Turso database to view analytics.
            </p>
          </div>
        ) : projects.length === 0 ? (
          <div className="card text-center py-16">
            <div className="text-4xl mb-4">📊</div>
            <p className="text-dim font-mono mb-6">NO PROJECTS SYNCED</p>
            <p className="text-sm text-dim">
              Sync a project to view its metrics.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Project Selector */}
            <div className="card">
              <h2 className="text-dim text-xs font-mono mb-4">{'>'} SELECT PROJECT</h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {projects.map((project) => (
                  <a
                    key={project.id}
                    href={`#${project.id}`}
                    className="p-3 border border-white/10 rounded-lg hover:border-gold/50 hover:bg-gold/5 transition-all"
                  >
                    <p className="font-mono font-semibold truncate">{project.name}</p>
                    <p className="text-xs text-dim font-mono">{project.current_phase} → {project.current_step}</p>
                  </a>
                ))}
              </div>
            </div>
            
            {/* Metrics for each project */}
            {projects.map((project) => (
              <div key={project.id} id={project.id}>
                <MetricsDisplay projectId={project.id} projectName={project.name} />
              </div>
            ))}
          </div>
        )}
        
        {/* Footer */}
        <footer className="mt-16 text-center">
          <p className="text-dim text-xs font-mono">
            MIDAS v1.0.0 // <a href="https://midasmcp.com" className="text-gold hover:underline">DOCUMENTATION</a>
          </p>
        </footer>
      </div>
    </main>
  )
}
