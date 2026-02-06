import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getProjectById, getLatestGates, getUserByGithubId } from "@/lib/db"
import Link from "next/link"
import { CommandCenter } from "@/components/CommandCenter"

const PHASE_STEPS: Record<string, string[]> = {
  IDLE: [],
  PLAN: ['IDEA', 'RESEARCH', 'PRD', 'GAMEPLAN'],
  BUILD: ['RULES', 'INDEX', 'READ', 'RESEARCH', 'IMPLEMENT', 'TEST', 'DEBUG'],
  SHIP: ['REVIEW', 'DEPLOY', 'MONITOR'],
  GROW: ['DONE'],
}

export default async function ProjectDetail({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect("/")

  const { projectId } = await params
  const user = session.user
  const userRecord = await getUserByGithubId(user.githubId as number)
  const dbUrl = userRecord?.db_url ?? undefined
  const dbToken = userRecord?.db_token ?? undefined

  const project = await getProjectById(projectId, dbUrl, dbToken)
  if (!project) redirect("/dashboard")

  const gates = await getLatestGates(projectId, dbUrl, dbToken)

  const currentSteps = PHASE_STEPS[project.current_phase] || []
  const currentStepIndex = currentSteps.indexOf(project.current_step)
  const progress = currentSteps.length > 0
    ? Math.round(((currentStepIndex + 1) / currentSteps.length) * 100)
    : 0

  return (
    <main className="min-h-screen p-4 md:p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="text-dim hover:text-white font-mono text-sm transition-colors"
            >
              ← back
            </Link>
            <span className="text-dim">/</span>
            <h1 className="font-mono font-bold">{project.name}</h1>
          </div>
        </header>

        {/* Phase + Progress */}
        <div className="flex items-center gap-4 mb-6 font-mono text-sm">
          <span className={`px-2 py-1 rounded text-xs font-bold ${
            project.current_phase === 'BUILD' ? 'bg-blue-500/20 text-blue-400' :
            project.current_phase === 'PLAN' ? 'bg-amber-500/20 text-amber-400' :
            project.current_phase === 'SHIP' ? 'bg-green-500/20 text-green-400' :
            project.current_phase === 'GROW' ? 'bg-purple-500/20 text-purple-400' :
            'bg-white/10 text-dim'
          }`}>
            {project.current_phase}
          </span>
          <span className="text-gold">{project.current_step || '—'}</span>
          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-matrix rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-dim">{progress}%</span>

          {gates && (
            <div className="flex items-center gap-2">
              <span className={gates.compiles ? 'text-matrix' : 'text-red-400'} title="Compiles">
                {gates.compiles ? '●' : '○'}
              </span>
              <span className={gates.tests_pass ? 'text-matrix' : 'text-red-400'} title="Tests">
                {gates.tests_pass ? '●' : '○'}
              </span>
              <span className={gates.lints_pass ? 'text-matrix' : 'text-red-400'} title="Lints">
                {gates.lints_pass ? '●' : '○'}
              </span>
            </div>
          )}
        </div>

        {/* COMMAND CENTER */}
        <CommandCenter
          projectId={project.id}
          projectName={project.name}
          phase={project.current_phase}
          step={project.current_step}
        />

        {/* Footer hint */}
        <p className="mt-6 text-center text-xs font-mono text-dim">
          <code>midas sync</code> · <code>midas watch</code>
        </p>
      </div>
    </main>
  )
}
