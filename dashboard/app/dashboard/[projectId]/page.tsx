import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getProjectById, getLatestGates, getRecentEvents } from "@/lib/db"
import Link from "next/link"

function GateIcon({ status }: { status: boolean | null }) {
  if (status === null) {
    return <span className="gate-icon gate-unknown">?</span>
  }
  if (status) {
    return <span className="gate-icon gate-pass">✓</span>
  }
  return <span className="gate-icon gate-fail">✗</span>
}

function PhaseStep({ 
  step, 
  isComplete, 
  isCurrent 
}: { 
  step: string
  isComplete: boolean
  isCurrent: boolean 
}) {
  return (
    <div className={`flex items-center gap-2 py-2 ${isCurrent ? 'text-gold' : isComplete ? 'text-gray-400' : 'text-gray-600'}`}>
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
        isCurrent ? 'bg-gold/20 text-gold' : 
        isComplete ? 'bg-green-900/30 text-green-400' : 
        'bg-gray-800 text-gray-600'
      }`}>
        {isComplete ? '✓' : isCurrent ? '→' : '○'}
      </span>
      <span className="text-sm">{step}</span>
    </div>
  )
}

const PHASE_STEPS: Record<string, string[]> = {
  PLAN: ['IDEA', 'RESEARCH', 'BRAINLIFT', 'PRD', 'GAMEPLAN'],
  BUILD: ['RULES', 'INDEX', 'READ', 'RESEARCH', 'IMPLEMENT', 'TEST', 'DEBUG'],
  SHIP: ['REVIEW', 'DEPLOY', 'MONITOR'],
  GROW: ['FEEDBACK', 'ANALYZE', 'ITERATE'],
}

export default async function ProjectDetail({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const session = await auth()
  
  if (!session?.user) {
    redirect("/")
  }
  
  const { projectId } = await params
  const project = await getProjectById(projectId)
  
  if (!project) {
    redirect("/dashboard")
  }
  
  // Check ownership
  const user = session.user
  if (project.github_user_id !== user.githubId) {
    redirect("/dashboard")
  }
  
  const gates = await getLatestGates(projectId)
  const events = await getRecentEvents(projectId)
  
  const currentSteps = PHASE_STEPS[project.current_phase] || []
  const currentStepIndex = currentSteps.indexOf(project.current_step)
  
  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard" className="text-gray-500 hover:text-white">
            ← Back
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--gold)' }}>
            {project.name}
          </h1>
        </div>
        
        {/* Phase Progress */}
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Progress</h2>
            <span className={`phase-badge phase-${project.current_phase.toLowerCase()}`}>
              {project.current_phase}
            </span>
          </div>
          
          <div className="progress-bar mb-4">
            <div className="progress-bar-fill" style={{ width: `${project.progress}%` }} />
          </div>
          
          <div className="text-sm text-gray-400">
            {project.progress}% complete • {project.current_phase}:{project.current_step}
          </div>
        </div>
        
        <div className="grid md:grid-cols-2 gap-6">
          {/* Current Phase Steps */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-4">{project.current_phase} Phase</h2>
            <div className="space-y-1">
              {currentSteps.map((step, idx) => (
                <PhaseStep
                  key={step}
                  step={step}
                  isComplete={idx < currentStepIndex}
                  isCurrent={idx === currentStepIndex}
                />
              ))}
            </div>
          </div>
          
          {/* Gates Status */}
          <div className="card">
            <h2 className="text-lg font-semibold mb-4">Verification Gates</h2>
            {gates ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Build</span>
                  <GateIcon status={gates.compiles} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Tests</span>
                  <GateIcon status={gates.tests_pass} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Lint</span>
                  <GateIcon status={gates.lints_pass} />
                </div>
                {gates.checked_at && (
                  <p className="text-xs text-gray-600 mt-4">
                    Last checked: {new Date(gates.checked_at).toLocaleString()}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">
                No gate data synced yet. Run <code className="bg-black/50 px-1 rounded">midas_verify</code> then sync.
              </p>
            )}
          </div>
        </div>
        
        {/* Recent Events */}
        {events.length > 0 && (
          <div className="card mt-6">
            <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
            <div className="space-y-2">
              {events.map(event => {
                let data: { tool?: string } = {}
                try {
                  data = JSON.parse(event.event_data)
                } catch {}
                
                return (
                  <div key={event.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-800 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">{event.event_type}</span>
                      {data.tool && (
                        <code className="bg-black/50 px-1 rounded text-xs">{data.tool}</code>
                      )}
                    </div>
                    <span className="text-gray-600 text-xs">
                      {new Date(event.created_at).toLocaleString()}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        
        {/* Project Info */}
        <div className="card mt-6">
          <h2 className="text-lg font-semibold mb-4">Project Info</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Local Path</dt>
              <dd className="font-mono text-gray-400">{project.local_path}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Created</dt>
              <dd className="text-gray-400">{new Date(project.created_at).toLocaleDateString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Last Synced</dt>
              <dd className="text-gray-400">{new Date(project.last_synced).toLocaleString()}</dd>
            </div>
          </dl>
        </div>
        
        {/* Sync reminder */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>Update this dashboard by running:</p>
          <code className="block mt-2 bg-black/50 px-4 py-2 rounded font-mono text-xs inline-block">
            cd {project.local_path} && npx midas-mcp sync
          </code>
        </div>
      </div>
    </main>
  )
}
