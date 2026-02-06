'use client'

import { useState, useEffect, useCallback } from 'react'

interface ErrorItem {
  id: number
  error_id: string
  error_text: string
  file_path: string | null
  line_number: number | null
  first_seen: string
  last_seen: string
  fix_attempts: number
  fix_history: string | null
  resolved: boolean
  resolved_at: string | null
}

interface ErrorMemoryProps {
  projectId: string
}

export function ErrorMemory({ projectId }: ErrorMemoryProps) {
  const [errors, setErrors] = useState<ErrorItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showResolved, setShowResolved] = useState(false)
  const [expandedError, setExpandedError] = useState<string | null>(null)

  const fetchErrors = useCallback(async () => {
    try {
      const url = showResolved 
        ? `/api/error-memory?projectId=${projectId}`
        : `/api/error-memory?projectId=${projectId}&resolved=false`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setErrors(data.errors || [])
      }
    } catch {
      // Ignore fetch errors
    } finally {
      setLoading(false)
    }
  }, [projectId, showResolved])

  useEffect(() => {
    fetchErrors()
    const interval = setInterval(fetchErrors, 10000) // Refresh every 10s
    return () => clearInterval(interval)
  }, [fetchErrors])

  const parseFixHistory = (historyStr: string | null): string[] => {
    if (!historyStr) return []
    try {
      return JSON.parse(historyStr)
    } catch {
      return []
    }
  }

  if (loading) {
    return (
      <div className="card">
        <h2 className="text-dim text-xs font-mono mb-4">{'>'} ERROR MEMORY</h2>
        <div className="text-center py-6">
          <div className="w-6 h-6 border-2 border-gold/30 border-t-gold rounded-full animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-dim text-xs font-mono">{'>'} ERROR MEMORY</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowResolved(!showResolved)}
            className={`text-xs font-mono px-2 py-1 rounded ${
              showResolved ? 'bg-white/10 text-white' : 'text-dim hover:text-white'
            }`}
          >
            {showResolved ? 'ALL' : 'ACTIVE'}
          </button>
          <span className="text-xs font-mono text-dim">
            {errors.length} error{errors.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {errors.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-2">✨</div>
          <p className="text-matrix font-mono text-sm">No unresolved errors!</p>
          <p className="text-dim text-xs mt-1">Keep up the great work</p>
        </div>
      ) : (
        <div className="space-y-2">
          {errors.map((error) => {
            const isExpanded = expandedError === error.error_id
            const fixHistory = parseFixHistory(error.fix_history)
            const isProblematic = error.fix_attempts >= 3
            
            return (
              <div
                key={error.error_id}
                className={`p-3 border rounded-lg cursor-pointer transition-all ${
                  error.resolved
                    ? 'bg-matrix/5 border-matrix/20'
                    : isProblematic
                    ? 'bg-red-500/10 border-red-500/30'
                    : 'bg-gold/5 border-gold/20'
                }`}
                onClick={() => setExpandedError(isExpanded ? null : error.error_id)}
              >
                <div className="flex items-start gap-3">
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    error.resolved
                      ? 'bg-matrix/20 text-matrix'
                      : isProblematic
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-gold/20 text-gold'
                  }`}>
                    {error.resolved ? '✓' : error.fix_attempts}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-mono truncate ${error.resolved ? 'text-matrix' : ''}`}>
                      {error.error_text.slice(0, 80)}{error.error_text.length > 80 ? '...' : ''}
                    </p>
                    {error.file_path && (
                      <p className="text-xs text-dim font-mono mt-1">
                        {error.file_path}{error.line_number ? `:${error.line_number}` : ''}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-dim">
                      <span>First: {new Date(error.first_seen).toLocaleDateString()}</span>
                      <span>•</span>
                      <span>Last: {new Date(error.last_seen).toLocaleDateString()}</span>
                      {isProblematic && !error.resolved && (
                        <>
                          <span>•</span>
                          <span className="text-red-400">⚠ {error.fix_attempts} fix attempts</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <p className="text-xs font-mono text-dim mb-2">FULL ERROR:</p>
                    <pre className="text-xs font-mono bg-black/30 p-3 rounded overflow-x-auto whitespace-pre-wrap">
                      {error.error_text}
                    </pre>
                    
                    {fixHistory.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs font-mono text-dim mb-2">FIX HISTORY:</p>
                        <div className="space-y-2">
                          {fixHistory.map((fix, idx) => (
                            <div key={idx} className="text-xs font-mono bg-black/20 p-2 rounded">
                              {idx + 1}. {fix}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {error.resolved && error.resolved_at && (
                      <p className="mt-4 text-xs text-matrix font-mono">
                        ✓ Resolved on {new Date(error.resolved_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
