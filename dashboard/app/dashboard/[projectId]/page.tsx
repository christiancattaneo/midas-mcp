import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getProjectById, getLatestGates, getRecentEvents, getGameplanTasks, getRecentCommands } from "@/lib/db"
import Link from "next/link"
import { ThemeToggle } from "@/components/ThemeToggle"
import { CopyPromptButton } from "@/components/CopyButton"
import { ExecuteButton } from "@/components/ExecuteButton"

// Phase configuration
const PHASE_STEPS: Record<string, string[]> = {
  IDLE: [],
  PLAN: ['IDEA', 'RESEARCH', 'BRAINLIFT', 'PRD', 'GAMEPLAN'],
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

function StepIndicator({ step, status, index }: { step: string; status: 'complete' | 'current' | 'pending'; index: number }) {
  const icons: Record<string, string> = {
    complete: '✓',
    current: '▸',
    pending: String(index + 1).padStart(2, '0'),
  }
  
  return (
    <div className={`step-indicator ${status}`}>
      <div className={`step-icon ${status}`}>
        {icons[status]}
      </div>
      <span className={status === 'current' ? 'text-gold' : status === 'complete' ? 'text-matrix' : 'text-dim'}>
        {step}
      </span>
    </div>
  )
}

function GateStatus({ name, passed }: { name: string; passed: boolean | null }) {
  const statusClass = passed === true ? 'gate-pass' : passed === false ? 'gate-fail' : 'gate-unknown'
  const icon = passed === true ? '✓' : passed === false ? '✕' : '?'
  
  return (
    <div className="flex items-center gap-3 py-2">
      <div className={`gate-icon ${statusClass}`}>
        {icon}
      </div>
      <div className="flex-1">
        <span className={passed === true ? 'text-matrix' : passed === false ? 'text-red-400' : 'text-dim'}>
          {name}
        </span>
      </div>
      <span className="text-xs font-mono text-dim">
        {passed === true ? 'PASS' : passed === false ? 'FAIL' : 'PENDING'}
      </span>
    </div>
  )
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
  const gameplanTasks = await getGameplanTasks(projectId)
  const recentCommands = await getRecentCommands(projectId, 5)
  
  // Find the next incomplete task
  const nextTask = gameplanTasks.find(t => !t.completed)
  
  // Check if there are pending/running commands
  const activeCommands = recentCommands.filter(c => c.status === 'pending' || c.status === 'running')
  
  const currentSteps = PHASE_STEPS[project.current_phase] || []
  const currentStepIndex = currentSteps.indexOf(project.current_step)
  const phaseColor = PHASE_COLORS[project.current_phase] || ''
  const progress = currentSteps.length > 0 
    ? Math.round(((currentStepIndex + 1) / currentSteps.length) * 100)
    : 0
  
  return (
    <main className="min-h-screen p-6 md:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link 
              href="/dashboard" 
              className="btn-secondary py-2 px-4 text-sm font-mono"
            >
              ← BACK
            </Link>
            <div className={`w-12 h-12 flex items-center justify-center bg-gradient-to-br ${phaseColor} border text-2xl font-mono`}>
              {getPhaseIcon(project.current_phase)}
            </div>
            <div>
              <h1 className="text-xl font-bold font-mono">{project.name}</h1>
              <p className="text-dim text-xs font-mono">{project.local_path}</p>
            </div>
          </div>
          <ThemeToggle />
        </header>
        
        {/* Progress Hero */}
        <div className="card mb-8 relative">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-dim text-xs font-mono mb-1">// CURRENT MISSION</p>
              <div className="flex items-center gap-3">
                <PhaseBadge phase={project.current_phase} />
                <span className="text-gold font-mono">→</span>
                <span className="font-mono text-lg">{project.current_step || 'STANDBY'}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="stat-value text-4xl">{progress}%</div>
              <div className="stat-label">PHASE COMPLETE</div>
            </div>
          </div>
          
          <div className="progress-bar h-3">
            <div 
              className="progress-bar-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        
        <div className="grid md:grid-cols-2 gap-6">
          {/* Phase Steps */}
          <div className="card">
            <h2 className="text-dim text-xs font-mono mb-4">{'>'} PHASE OBJECTIVES</h2>
            <div className="space-y-1">
              {currentSteps.map((step, idx) => {
                let status: 'complete' | 'current' | 'pending' = 'pending'
                if (idx < currentStepIndex) status = 'complete'
                else if (idx === currentStepIndex) status = 'current'
                
                return (
                  <StepIndicator 
                    key={step} 
                    step={step} 
                    status={status}
                    index={idx}
                  />
                )
              })}
              {currentSteps.length === 0 && (
                <p className="text-dim font-mono text-sm py-4 text-center">
                  NO ACTIVE OBJECTIVES
                </p>
              )}
            </div>
          </div>
          
          {/* Verification Gates */}
          <div className="card">
            <h2 className="text-dim text-xs font-mono mb-4">{'>'} VERIFICATION GATES</h2>
            {gates ? (
              <div className="space-y-1">
                <GateStatus name="COMPILES" passed={gates.compiles} />
                <GateStatus name="TESTS PASS" passed={gates.tests_pass} />
                <GateStatus name="LINTS PASS" passed={gates.lints_pass} />
              </div>
            ) : (
              <p className="text-dim font-mono text-sm py-4 text-center">
                NO GATES CONFIGURED
              </p>
            )}
          </div>
          
          {/* Recent Activity */}
          <div className="card">
            <h2 className="text-dim text-xs font-mono mb-4">{'>'} SYSTEM LOG</h2>
            {events.length > 0 ? (
              <div className="space-y-0">
                {events.slice(0, 8).map((event, idx) => (
                  <div key={idx} className="activity-item">
                    <div className="activity-dot" />
                    <div className="flex-1 min-w-0">
                      <span className="truncate block">{event.event_type}</span>
                    </div>
                    <span className="activity-time">
                      {new Date(event.created_at).toLocaleTimeString('en-US', { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-dim font-mono text-sm py-4 text-center">
                NO EVENTS LOGGED
              </p>
            )}
          </div>
          
          {/* Project Info */}
          <div className="card">
            <h2 className="text-dim text-xs font-mono mb-4">{'>'} PROJECT DATA</h2>
            <div className="space-y-3 font-mono text-sm">
              <div className="flex justify-between">
                <span className="text-dim">ID</span>
                <span className="text-gold truncate max-w-[200px]">{project.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dim">PHASE</span>
                <span>{project.current_phase}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dim">STEP</span>
                <span>{project.current_step || 'NULL'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dim">CREATED</span>
                <span>{new Date(project.created_at).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dim">LAST SYNC</span>
                <span className="text-matrix">{new Date(project.last_synced).toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Active Commands Section */}
        {activeCommands.length > 0 && (
          <div className="card mt-6 border-matrix/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-3 h-3 bg-matrix rounded-full animate-pulse" />
              <h2 className="text-matrix text-xs font-mono">{'>'} ACTIVE COMMANDS</h2>
            </div>
            <div className="space-y-3">
              {activeCommands.map((cmd) => (
                <div key={cmd.id} className="flex items-center gap-4 p-3 bg-matrix/5 border border-matrix/20">
                  <div className="flex-shrink-0">
                    {cmd.status === 'running' ? (
                      <svg className="w-5 h-5 text-matrix animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <div className="w-5 h-5 border-2 border-gold/50 flex items-center justify-center text-xs text-gold">⏳</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{cmd.prompt.slice(0, 80)}...</p>
                    <p className="text-xs text-dim font-mono">
                      {cmd.status === 'running' ? 'EXECUTING...' : 'QUEUED'}
                      {' • '}
                      {new Date(cmd.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-dim font-mono">
              Run <code>midas pilot --watch</code> locally to execute queued commands
            </p>
          </div>
        )}
        
        {/* Command History Section */}
        {recentCommands.length > 0 && (
          <div className="card mt-6">
            <h2 className="text-dim text-xs font-mono mb-4">{'>'} RECENT EXECUTIONS</h2>
            <div className="space-y-2">
              {recentCommands.filter(c => c.status === 'completed' || c.status === 'failed').slice(0, 5).map((cmd) => (
                <div key={cmd.id} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                  <div className={`gate-icon ${cmd.status === 'completed' ? 'gate-pass' : 'gate-fail'}`}>
                    {cmd.status === 'completed' ? '✓' : '✕'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{cmd.prompt.slice(0, 60)}...</p>
                    <p className="text-xs text-dim font-mono">
                      {cmd.duration_ms ? `${(cmd.duration_ms / 1000).toFixed(1)}s` : '--'}
                      {' • '}
                      {new Date(cmd.completed_at || cmd.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Gameplan Section */}
        <div className="card mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-dim text-xs font-mono">{'>'} GAMEPLAN TASKS</h2>
            <span className="text-xs font-mono text-dim">
              {gameplanTasks.filter(t => t.completed).length}/{gameplanTasks.length} COMPLETE
            </span>
          </div>
          
          {gameplanTasks.length > 0 ? (
            <div className="space-y-0">
              {gameplanTasks.map((task, idx) => {
                const isNext = nextTask?.id === task.id
                return (
                  <div 
                    key={task.id} 
                    className={`gameplan-task ${task.completed ? 'completed' : ''} ${isNext ? 'next' : ''}`}
                  >
                    <div className={`task-checkbox ${task.completed ? 'checked' : ''}`}>
                      {task.completed ? '✓' : String(idx + 1).padStart(2, '0')}
                    </div>
                    <div className="flex-1">
                      <p className="task-text">{task.task_text}</p>
                      {task.phase && (
                        <p className="task-phase mt-1">{task.phase}</p>
                      )}
                    </div>
                    {!task.completed && (
                      <div className="flex gap-2">
                        <CopyPromptButton
                          task={task.task_text}
                          projectName={project.name}
                          phase={project.current_phase}
                          step={project.current_step}
                        />
                        <ExecuteButton
                          projectId={project.id}
                          task={task.task_text}
                          projectName={project.name}
                          phase={project.current_phase}
                          step={project.current_step}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-dim font-mono text-sm mb-4">NO GAMEPLAN TASKS SYNCED</p>
              <p className="text-xs text-dim">
                Create a <code>docs/gameplan.md</code> with checkbox tasks:
              </p>
              <pre className="mt-3 text-left inline-block text-xs font-mono p-4 bg-black/30 border border-white/10">
{`# Gameplan

## Phase 1: Setup
- [ ] Initialize project structure
- [ ] Configure dependencies
- [ ] Set up CI/CD

## Phase 2: Core
- [ ] Implement main feature
- [ ] Add tests`}
              </pre>
            </div>
          )}
        </div>
        
        {/* Quick Actions for Next Task */}
        {nextTask && (
          <div className="card mt-6 border-gold/30">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 flex items-center justify-center bg-gold/20 border border-gold/50 text-gold font-mono text-sm">
                ▸
              </div>
              <div>
                <p className="text-dim text-xs font-mono">// NEXT ACTION</p>
                <p className="font-semibold">{nextTask.task_text}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <CopyPromptButton
                task={nextTask.task_text}
                projectName={project.name}
                phase={project.current_phase}
                step={project.current_step}
              />
              <ExecuteButton
                projectId={project.id}
                task={nextTask.task_text}
                projectName={project.name}
                phase={project.current_phase}
                step={project.current_step}
              />
            </div>
          </div>
        )}
        
        {/* Sync reminder */}
        <div className="mt-8 text-center">
          <p className="text-dim text-xs font-mono mb-2">// SYNC COMMAND</p>
          <code className="text-sm">
            <span className="text-gold">$</span> npx midas-mcp sync
          </code>
        </div>
      </div>
    </main>
  )
}
