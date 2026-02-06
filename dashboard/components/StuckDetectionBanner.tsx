'use client'

import { useState, useEffect, useCallback } from 'react'

interface StuckStatus {
  lastProgressAt: string | null
  stuckSince: string | null
  stuckOnError: string | null
  timeInPhaseMs: number
  isStuck: boolean
  stuckDurationMs: number
}

interface StuckDetectionBannerProps {
  projectId: string
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

export function StuckDetectionBanner({ projectId }: StuckDetectionBannerProps) {
  const [stuckStatus, setStuckStatus] = useState<StuckStatus | null>(null)
  const [errorCount, setErrorCount] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/project-status?projectId=${projectId}`)
      if (res.ok) {
        const data = await res.json()
        setStuckStatus(data.stuckStatus)
        setErrorCount(data.unresolvedErrorCount || 0)
      }
    } catch {
      // Ignore fetch errors
    }
  }, [projectId])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 15000) // Poll every 15s
    return () => clearInterval(interval)
  }, [fetchStatus])

  // Reset dismissed when stuck status changes
  useEffect(() => {
    if (stuckStatus?.isStuck) {
      setDismissed(false)
    }
  }, [stuckStatus?.stuckSince])

  // Don't show anything if not stuck or dismissed
  if (!stuckStatus?.isStuck || dismissed) {
    return null
  }

  return (
    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg animate-pulse-slow">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center">
          <span className="text-2xl">⚠️</span>
        </div>
        
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-red-400 font-mono font-bold text-lg">STUCK DETECTED</h3>
            <span className="text-xs font-mono text-red-400/70 bg-red-500/20 px-2 py-0.5 rounded">
              {formatDuration(stuckStatus.stuckDurationMs)}
            </span>
          </div>
          
          <p className="text-sm text-dim mb-3">
            No progress detected since {stuckStatus.stuckSince ? new Date(stuckStatus.stuckSince).toLocaleString() : 'unknown'}.
            {errorCount > 0 && ` You have ${errorCount} unresolved error${errorCount !== 1 ? 's' : ''}.`}
          </p>
          
          {stuckStatus.stuckOnError && (
            <div className="p-3 bg-black/30 border border-red-500/20 rounded mb-3">
              <p className="text-xs font-mono text-red-400 mb-1">PROBLEMATIC ERROR:</p>
              <p className="text-sm font-mono text-white/80 truncate">
                {stuckStatus.stuckOnError}
              </p>
            </div>
          )}
          
          <div className="flex flex-wrap gap-3">
            <div className="text-xs font-mono">
              <span className="text-dim">💡 TRY: </span>
              <span className="text-gold">Tornado Debugging</span>
              <span className="text-dim"> - Research + Logs + Tests</span>
            </div>
          </div>
        </div>
        
        <button
          onClick={() => setDismissed(true)}
          className="flex-shrink-0 text-dim hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>
      
      {/* Time in phase indicator */}
      {stuckStatus.timeInPhaseMs > 0 && (
        <div className="mt-4 pt-4 border-t border-red-500/20">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-dim">Time in current phase:</span>
            <span className="text-red-400">{formatDuration(stuckStatus.timeInPhaseMs)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
