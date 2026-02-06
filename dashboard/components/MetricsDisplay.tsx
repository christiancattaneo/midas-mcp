'use client'

import { useState, useEffect, useCallback } from 'react'

interface DailyMetric {
  id: number
  session_date: string
  total_prompts: number
  accepted_prompts: number
  rejected_prompts: number
  commands_executed: number
  commands_succeeded: number
  commands_failed: number
  tornado_cycles: number
  time_in_build_ms: number
  time_stuck_ms: number
  errors_encountered: number
  errors_resolved: number
}

interface MetricsSummary {
  total_prompts: number
  accepted_prompts: number
  rejected_prompts: number
  commands_executed: number
  commands_succeeded: number
  commands_failed: number
  tornado_cycles: number
  total_time_in_build_ms: number
  total_time_stuck_ms: number
  total_errors_encountered: number
  total_errors_resolved: number
  days_tracked: number
}

interface MetricsDisplayProps {
  projectId: string
  projectName: string
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

function StatCard({ label, value, subtext, color = 'gold' }: { 
  label: string
  value: string | number
  subtext?: string
  color?: 'gold' | 'matrix' | 'red' | 'blue'
}) {
  const colorClass = {
    gold: 'text-gold',
    matrix: 'text-matrix',
    red: 'text-red-400',
    blue: 'text-blue-400',
  }[color]
  
  return (
    <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
      <p className="text-xs font-mono text-dim mb-1">{label}</p>
      <p className={`text-2xl font-bold font-mono ${colorClass}`}>{value}</p>
      {subtext && <p className="text-xs text-dim mt-1">{subtext}</p>}
    </div>
  )
}

export function MetricsDisplay({ projectId, projectName }: MetricsDisplayProps) {
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([])
  const [summary, setSummary] = useState<MetricsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(7)

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch(`/api/metrics?projectId=${projectId}&days=${days}`)
      if (res.ok) {
        const data = await res.json()
        setDailyMetrics(data.dailyMetrics || [])
        setSummary(data.summary)
      }
    } catch {
      // Ignore fetch errors
    } finally {
      setLoading(false)
    }
  }, [projectId, days])

  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics])

  if (loading) {
    return (
      <div className="card">
        <h2 className="text-lg font-mono font-bold mb-4">{projectName}</h2>
        <div className="text-center py-12">
          <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin mx-auto" />
          <p className="text-dim text-sm mt-4">Loading metrics...</p>
        </div>
      </div>
    )
  }

  const acceptRate = summary && summary.total_prompts > 0 
    ? Math.round((summary.accepted_prompts / summary.total_prompts) * 100)
    : 0
    
  const commandSuccessRate = summary && summary.commands_executed > 0
    ? Math.round((summary.commands_succeeded / summary.commands_executed) * 100)
    : 0
    
  const errorResolutionRate = summary && summary.total_errors_encountered > 0
    ? Math.round((summary.total_errors_resolved / summary.total_errors_encountered) * 100)
    : 0

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-mono font-bold">{projectName}</h2>
        <div className="flex gap-2">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 text-xs font-mono rounded ${
                days === d 
                  ? 'bg-gold text-black' 
                  : 'bg-white/10 text-dim hover:bg-white/20'
              }`}
            >
              {d}D
            </button>
          ))}
        </div>
      </div>

      {!summary ? (
        <div className="text-center py-8">
          <p className="text-dim font-mono text-sm">No metrics recorded yet</p>
          <p className="text-xs text-dim mt-2">Start using Midas to see your stats</p>
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard
              label="PROMPTS"
              value={summary.total_prompts}
              subtext={`${acceptRate}% accepted`}
              color="gold"
            />
            <StatCard
              label="COMMANDS"
              value={summary.commands_executed}
              subtext={`${commandSuccessRate}% success`}
              color="blue"
            />
            <StatCard
              label="ERRORS"
              value={summary.total_errors_encountered}
              subtext={`${errorResolutionRate}% resolved`}
              color="red"
            />
            <StatCard
              label="TORNADO CYCLES"
              value={summary.tornado_cycles}
              subtext="Debug iterations"
              color="matrix"
            />
          </div>

          {/* Time Stats */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-xs font-mono text-blue-400 mb-1">TIME IN BUILD</p>
              <p className="text-xl font-bold font-mono text-blue-400">
                {formatDuration(summary.total_time_in_build_ms)}
              </p>
            </div>
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-xs font-mono text-red-400 mb-1">TIME STUCK</p>
              <p className="text-xl font-bold font-mono text-red-400">
                {formatDuration(summary.total_time_stuck_ms)}
              </p>
              {summary.total_time_in_build_ms > 0 && (
                <p className="text-xs text-dim mt-1">
                  {Math.round((summary.total_time_stuck_ms / summary.total_time_in_build_ms) * 100)}% of build time
                </p>
              )}
            </div>
          </div>

          {/* Daily Breakdown */}
          {dailyMetrics.length > 0 && (
            <div>
              <h3 className="text-dim text-xs font-mono mb-4">{'>'} DAILY BREAKDOWN</h3>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {dailyMetrics.map((day) => {
                  const dayAcceptRate = day.total_prompts > 0 
                    ? Math.round((day.accepted_prompts / day.total_prompts) * 100)
                    : 0
                  
                  return (
                    <div 
                      key={day.session_date}
                      className="flex items-center gap-4 p-3 bg-white/5 border border-white/10 rounded-lg"
                    >
                      <div className="flex-shrink-0 w-24">
                        <p className="text-sm font-mono font-bold">
                          {new Date(day.session_date).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric'
                          })}
                        </p>
                      </div>
                      <div className="flex-1 grid grid-cols-4 gap-4 text-xs font-mono">
                        <div>
                          <span className="text-dim">Prompts:</span>{' '}
                          <span className="text-gold">{day.total_prompts}</span>
                          <span className="text-dim ml-1">({dayAcceptRate}%)</span>
                        </div>
                        <div>
                          <span className="text-dim">Cmds:</span>{' '}
                          <span className="text-blue-400">{day.commands_executed}</span>
                        </div>
                        <div>
                          <span className="text-dim">Errors:</span>{' '}
                          <span className="text-red-400">{day.errors_encountered}</span>
                        </div>
                        <div>
                          <span className="text-dim">Tornado:</span>{' '}
                          <span className="text-matrix">{day.tornado_cycles}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Insights */}
          {summary.days_tracked > 3 && (
            <div className="mt-6 p-4 bg-gold/5 border border-gold/20 rounded-lg">
              <p className="text-xs font-mono text-gold mb-2">💡 INSIGHTS</p>
              <ul className="text-sm text-dim space-y-1">
                {acceptRate < 50 && (
                  <li>• Low prompt acceptance rate ({acceptRate}%). Consider more specific prompts.</li>
                )}
                {summary.tornado_cycles > summary.total_prompts * 0.3 && (
                  <li>• High tornado cycle usage. May indicate complex debugging scenarios.</li>
                )}
                {summary.total_time_stuck_ms > summary.total_time_in_build_ms * 0.3 && (
                  <li>• Significant time spent stuck ({Math.round((summary.total_time_stuck_ms / summary.total_time_in_build_ms) * 100)}%). Consider breaking tasks smaller.</li>
                )}
                {errorResolutionRate < 70 && summary.total_errors_encountered > 5 && (
                  <li>• Low error resolution rate ({errorResolutionRate}%). Check error memory for patterns.</li>
                )}
                {commandSuccessRate > 90 && summary.commands_executed > 10 && (
                  <li className="text-matrix">• Excellent command success rate! Keep it up.</li>
                )}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
