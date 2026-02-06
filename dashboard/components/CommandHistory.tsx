'use client'

import { useState, useEffect, useCallback } from 'react'

interface Command {
  id: number
  project_id: string
  command_type: string
  prompt: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  priority: number
  created_at: string
  started_at: string | null
  completed_at: string | null
  output: string | null
  error: string | null
  exit_code: number | null
  duration_ms: number | null
}

interface CommandHistoryProps {
  projectId: string
}

type StatusFilter = 'all' | 'pending' | 'running' | 'completed' | 'failed'

function formatDuration(ms: number | null): string {
  if (!ms) return '--'
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

function StatusBadge({ status }: { status: Command['status'] }) {
  const config = {
    pending: { color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: '⏳' },
    running: { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: '⚡' },
    completed: { color: 'bg-matrix/20 text-matrix border-matrix/30', icon: '✓' },
    failed: { color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: '✕' },
  }[status]
  
  return (
    <span className={`px-2 py-0.5 text-xs font-mono border rounded ${config.color}`}>
      {config.icon} {status.toUpperCase()}
    </span>
  )
}

export function CommandHistory({ projectId }: CommandHistoryProps) {
  const [commands, setCommands] = useState<Command[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [limit, setLimit] = useState(20)
  const [expandedCommand, setExpandedCommand] = useState<number | null>(null)

  const fetchCommands = useCallback(async () => {
    try {
      let url = `/api/command-history?projectId=${projectId}&limit=${limit}`
      if (statusFilter !== 'all') {
        url += `&status=${statusFilter}`
      }
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setCommands(data.commands || [])
      }
    } catch {
      // Ignore fetch errors
    } finally {
      setLoading(false)
    }
  }, [projectId, statusFilter, limit])

  useEffect(() => {
    fetchCommands()
    // Refresh every 10 seconds to catch updates
    const interval = setInterval(fetchCommands, 10000)
    return () => clearInterval(interval)
  }, [fetchCommands])

  if (loading) {
    return (
      <div className="card">
        <h2 className="text-dim text-xs font-mono mb-4">{'>'} COMMAND HISTORY</h2>
        <div className="text-center py-8">
          <div className="w-6 h-6 border-2 border-gold/30 border-t-gold rounded-full animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-dim text-xs font-mono">{'>'} COMMAND HISTORY</h2>
        
        <div className="flex items-center gap-2">
          {/* Status Filter */}
          {(['all', 'pending', 'running', 'completed', 'failed'] as StatusFilter[]).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-2 py-1 text-xs font-mono rounded transition-colors ${
                statusFilter === status 
                  ? 'bg-gold text-black' 
                  : 'bg-white/10 text-dim hover:bg-white/20'
              }`}
            >
              {status.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {commands.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-dim font-mono text-sm">No commands found</p>
          <p className="text-xs text-dim mt-1">
            {statusFilter !== 'all' ? `Try clearing the ${statusFilter} filter` : 'Commands will appear here after execution'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {commands.map((cmd) => {
            const isExpanded = expandedCommand === cmd.id
            
            return (
              <div
                key={cmd.id}
                className={`border rounded-lg transition-all ${
                  cmd.status === 'running' 
                    ? 'border-blue-500/30 bg-blue-500/5' 
                    : cmd.status === 'failed'
                    ? 'border-red-500/20 bg-red-500/5'
                    : 'border-white/10 bg-white/5'
                }`}
              >
                {/* Command Header */}
                <div 
                  className="p-4 cursor-pointer"
                  onClick={() => setExpandedCommand(isExpanded ? null : cmd.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <StatusBadge status={cmd.status} />
                        <span className="text-xs text-dim font-mono">
                          {cmd.command_type.toUpperCase()}
                        </span>
                        {cmd.duration_ms && (
                          <span className="text-xs text-dim font-mono">
                            • {formatDuration(cmd.duration_ms)}
                          </span>
                        )}
                      </div>
                      <p className={`text-sm font-mono ${isExpanded ? '' : 'truncate'}`}>
                        {isExpanded ? cmd.prompt : cmd.prompt.slice(0, 100) + (cmd.prompt.length > 100 ? '...' : '')}
                      </p>
                      <p className="text-xs text-dim font-mono mt-2">
                        {new Date(cmd.created_at).toLocaleString()}
                        {cmd.exit_code !== null && (
                          <span className={cmd.exit_code === 0 ? 'text-matrix' : 'text-red-400'}>
                            {' '}• exit: {cmd.exit_code}
                          </span>
                        )}
                      </p>
                    </div>
                    <button className="flex-shrink-0 text-dim hover:text-white transition-colors">
                      {isExpanded ? '▲' : '▼'}
                    </button>
                  </div>
                </div>

                {/* Expanded Content - Full Output */}
                {isExpanded && (
                  <div className="border-t border-white/10 p-4 space-y-4">
                    {/* Full Prompt */}
                    <div>
                      <p className="text-xs font-mono text-dim mb-2">FULL PROMPT:</p>
                      <pre className="text-xs font-mono bg-black/30 p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                        {cmd.prompt}
                      </pre>
                    </div>

                    {/* Output */}
                    {cmd.output && (
                      <div>
                        <p className="text-xs font-mono text-matrix mb-2">OUTPUT:</p>
                        <pre className="text-xs font-mono bg-matrix/5 border border-matrix/20 p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-[400px] overflow-y-auto">
                          {cmd.output}
                        </pre>
                      </div>
                    )}

                    {/* Error */}
                    {cmd.error && (
                      <div>
                        <p className="text-xs font-mono text-red-400 mb-2">ERROR:</p>
                        <pre className="text-xs font-mono bg-red-500/5 border border-red-500/20 p-3 rounded overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                          {cmd.error}
                        </pre>
                      </div>
                    )}

                    {/* Timestamps */}
                    <div className="flex flex-wrap gap-4 text-xs font-mono text-dim">
                      <span>Created: {new Date(cmd.created_at).toLocaleString()}</span>
                      {cmd.started_at && (
                        <span>Started: {new Date(cmd.started_at).toLocaleString()}</span>
                      )}
                      {cmd.completed_at && (
                        <span>Completed: {new Date(cmd.completed_at).toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Load More */}
          {commands.length >= limit && (
            <button
              onClick={() => setLimit(limit + 20)}
              className="w-full py-3 text-center text-sm font-mono text-dim hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
            >
              Load More Commands
            </button>
          )}
        </div>
      )}
    </div>
  )
}
