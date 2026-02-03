import { auth, signOut } from "@/auth"
import { redirect } from "next/navigation"
import { getProjectsByUser } from "@/lib/db"
import Image from "next/image"
import Link from "next/link"

function PhaseProgressBar({ progress }: { progress: number }) {
  return (
    <div className="progress-bar mt-2">
      <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
    </div>
  )
}

function PhaseBadge({ phase }: { phase: string }) {
  const className = `phase-badge phase-${phase.toLowerCase()}`
  return <span className={className}>{phase}</span>
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export default async function Dashboard() {
  const session = await auth()
  
  if (!session?.user) {
    redirect("/")
  }
  
  const user = session.user
  const githubId = user.githubId
  
  let projects: Awaited<ReturnType<typeof getProjectsByUser>> = []
  let error: string | null = null
  
  try {
    if (githubId) {
      projects = await getProjectsByUser(githubId)
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load projects'
  }
  
  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold" style={{ color: 'var(--gold)' }}>
              MIDAS
            </h1>
            <span className="text-gray-500">Dashboard</span>
          </div>
          
          <div className="flex items-center gap-4">
            {user.image && (
              <Image
                src={user.image}
                alt={user.name || 'User'}
                width={32}
                height={32}
                className="rounded-full"
              />
            )}
            <span className="text-sm text-gray-400">@{user.githubUsername || user.name || 'user'}</span>
            <form
              action={async () => {
                "use server"
                await signOut()
              }}
            >
              <button
                type="submit"
                className="text-sm text-gray-500 hover:text-white"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
        
        {/* Error state */}
        {error && (
          <div className="card mb-8 border-red-500/50">
            <p className="text-red-400">{error}</p>
            <p className="text-sm text-gray-500 mt-2">
              Make sure Turso is configured and the database schema is initialized.
            </p>
          </div>
        )}
        
        {/* Empty state */}
        {!error && projects.length === 0 && (
          <div className="card text-center py-12">
            <h2 className="text-xl font-semibold mb-2">No projects synced yet</h2>
            <p className="text-gray-400 mb-6">
              Sync your first project from the command line
            </p>
            <div className="bg-black/50 rounded-lg p-4 inline-block">
              <code className="text-sm font-mono">
                cd your-project<br />
                npx midas-mcp sync
              </code>
            </div>
          </div>
        )}
        
        {/* Projects grid */}
        {projects.length > 0 && (
          <div className="grid gap-4">
            {projects.map(project => (
              <Link
                key={project.id}
                href={`/dashboard/${project.id}`}
                className="card block hover:border-gold-dark transition"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{project.name}</h2>
                    <p className="text-sm text-gray-500 font-mono">{project.local_path}</p>
                  </div>
                  <div className="text-right">
                    <PhaseBadge phase={project.current_phase} />
                    {project.current_step && (
                      <p className="text-xs text-gray-500 mt-1">{project.current_step}</p>
                    )}
                  </div>
                </div>
                
                <PhaseProgressBar progress={project.progress} />
                
                <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
                  <span>{project.progress}% complete</span>
                  <span>Synced {formatRelativeTime(project.last_synced)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
        
        {/* Footer */}
        <div className="mt-12 text-center text-sm text-gray-500">
          <p>Keep your dashboard in sync:</p>
          <code className="block mt-2 bg-black/50 px-4 py-2 rounded font-mono text-xs inline-block">
            npx midas-mcp sync
          </code>
        </div>
      </div>
    </main>
  )
}
