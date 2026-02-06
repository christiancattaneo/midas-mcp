import { auth, signOut } from "@/auth"
import { redirect } from "next/navigation"
import { getProjectsByUser, getActivePilotSession } from "@/lib/db"
import Image from "next/image"
import Link from "next/link"
import { ThemeToggle } from "@/components/ThemeToggle"

// Never cache this page - always show fresh data
export const dynamic = 'force-dynamic'
export const revalidate = 0

// Phase configuration
const PHASE_STEPS: Record<string, string[]> = {
  IDLE: [],
  PLAN: ['IDEA', 'RESEARCH', 'PRD', 'GAMEPLAN'],
  BUILD: ['RULES', 'INDEX', 'READ', 'RESEARCH', 'IMPLEMENT', 'TEST', 'DEBUG'],
  SHIP: ['REVIEW', 'DEPLOY', 'MONITOR'],
  GROW: ['DONE'],
}

const PHASE_COLORS: Record<string, string> = {
  IDLE: 'from-gray-600/20 to-gray-700/20 border-gray-600/50',
  PLAN: 'from-amber-500/20 to-yellow-600/20 border-amber-500/50',
  BUILD: 'from-blue-500/20 to-cyan-600/20 border-blue-500/50',
  SHIP: 'from-green-500/20 to-emerald-600/20 border-green-500/50',
  GROW: 'from-purple-500/20 to-violet-600/20 border-purple-500/50',
}

function getPhaseIcon(phase: string): string {
  switch (phase) {
    case 'PLAN': return '◈'
    case 'BUILD': return '⬡'
    case 'SHIP': return '▲'
    case 'GROW': return '◉'
    default: return '○'
  }
}

function PhaseBadge({ phase }: { phase: string }) {
  const badgeClass = `phase-${phase.toLowerCase()}`
  return (
    <span className={`phase-badge ${badgeClass}`}>
      {phase}
    </span>
  )
}

function PhaseProgressBar({ phase, step, storedProgress }: { phase: string; step: string; storedProgress: number }) {
  // GROW = 100%, otherwise use synced progress
  const progress = phase === 'GROW' ? 100 : (storedProgress || 0)

  return (
    <div className="w-full">
      <div className="progress-bar">
        <div 
          className="progress-bar-fill"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex justify-between mt-2 text-xs font-mono">
        <span className="text-dim">{step || 'IDLE'}</span>
        <span className="text-gold">{progress}%</span>
      </div>
    </div>
  )
}

export default async function Dashboard() {
  const session = await auth()
  
  if (!session?.user) {
    redirect("/")
  }
  
  const user = session.user
  const githubId = user.githubId as unknown as number
  const projects = await getProjectsByUser(githubId)
  const activePilot = await getActivePilotSession(githubId)
  
  // Calculate stats
  const totalProjects = projects.length
  const activeProjects = projects.filter(p => p.current_phase !== 'IDLE').length
  const buildPhaseProjects = projects.filter(p => p.current_phase === 'BUILD').length
  
  return (
    <main className="min-h-screen p-6 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-4">
            <h1 
              className="text-2xl font-bold font-mono tracking-wider glitch neon-gold"
              data-text="MIDAS"
            >
              MIDAS
            </h1>
            <span className="text-dim font-mono text-sm hidden sm:inline">// DASHBOARD</span>
          </div>
          
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <div className="flex items-center gap-3">
              {user.image && (
                <Image 
                  src={user.image} 
                  alt="" 
                  width={36} 
                  height={36} 
                  className="rounded border border-gold/30"
                />
              )}
              <div className="hidden sm:block text-right">
                <p className="font-mono text-sm text-gold">@{user.githubUsername || user.name}</p>
                <p className="text-xs text-dim">LEVEL 1 OPERATOR</p>
              </div>
            </div>
            <form
              action={async () => {
                "use server"
                await signOut()
              }}
            >
              <button type="submit" className="btn-secondary py-2 px-4 text-sm font-mono">
                LOGOUT
              </button>
            </form>
          </div>
        </header>
        
        {/* Watcher Status - only show when connected */}
        {activePilot && (
          <div className="card mb-10 border-matrix/30">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${activePilot.status === 'running' ? 'bg-blue-400 animate-pulse' : 'bg-matrix'}`} />
              <h2 className="font-mono font-bold text-matrix">
                {activePilot.status === 'running' ? 'EXECUTING' : 'WATCHER READY'}
              </h2>
              {activePilot.current_task && (
                <span className="text-xs text-dim font-mono truncate max-w-[300px]">
                  — {activePilot.current_task}
                </span>
              )}
            </div>
          </div>
        )}
        
        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-4 mb-10">
          <div className="card text-center py-6">
            <div className="stat-value">{totalProjects}</div>
            <div className="stat-label">PROJECTS</div>
          </div>
          <div className="card text-center py-6">
            <div className="stat-value">{activeProjects}</div>
            <div className="stat-label">ACTIVE</div>
          </div>
          <Link href="/dashboard/metrics" className="card text-center py-6 group hover:border-gold/50 transition-colors">
            <div className="stat-value group-hover:text-gold transition-colors">{buildPhaseProjects}</div>
            <div className="stat-label">BUILDING</div>
            <div className="text-xs text-dim mt-2 group-hover:text-gold transition-colors">
              📊 View Metrics →
            </div>
          </Link>
        </div>
        
        {/* Projects Section */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-mono text-dim text-sm">{'>'} SYNCED PROJECTS</h2>
          <span className="text-xs text-dim font-mono">{projects.length} TOTAL</span>
        </div>
        
        {projects.length === 0 ? (
          <div className="card text-center py-16">
            <div className="text-4xl mb-4">◇</div>
            <p className="text-dim font-mono mb-6">NO PROJECTS SYNCED</p>
            <div className="text-left max-w-xs mx-auto">
              <p className="text-dim text-xs font-mono mb-3">// RUN IN YOUR PROJECT</p>
              <code className="block p-3 text-sm">
                <span className="text-gold">$</span> npx midas-mcp sync
              </code>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {projects.map((project) => {
              const phaseColor = PHASE_COLORS[project.current_phase] || ''
              return (
                <Link 
                  key={project.id} 
                  href={`/dashboard/${project.id}`}
                  className="card group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 flex items-center justify-center bg-gradient-to-br ${phaseColor} border text-xl font-mono`}>
                        {getPhaseIcon(project.current_phase)}
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg group-hover:text-gold transition-colors">
                          {project.name}
                        </h3>
                        <p className="text-xs text-dim font-mono truncate max-w-[200px]">
                          {project.local_path}
                        </p>
                      </div>
                    </div>
                    <PhaseBadge phase={project.current_phase} />
                  </div>
                  
                  <PhaseProgressBar 
                    phase={project.current_phase} 
                    step={project.current_step}
                    storedProgress={project.progress} 
                  />
                  
                  <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between text-xs font-mono">
                    <span className="text-dim">
                      SYNCED {new Date(project.last_synced).toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      }).toUpperCase()}
                    </span>
                    <span className="text-gold group-hover:translate-x-1 transition-transform">→</span>
                  </div>
                </Link>
              )
            })}
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
