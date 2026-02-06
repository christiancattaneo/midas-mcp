'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface SmartSuggestion {
  prompt: string
  reason: string
  priority: string
  context: string | null
  phase: string
  step: string
  synced_at: string
}

interface WatcherStatus {
  connected: boolean
  lastHeartbeat: string | null
  currentTask: string | null
  status: 'idle' | 'running' | 'disconnected'
}

interface CommandCenterProps {
  projectId: string
  projectName: string
  phase: string
  step: string
}

const AUTO_DELAY_SECONDS = 5

export function CommandCenter({ projectId, projectName, phase, step }: CommandCenterProps) {
  const [suggestion, setSuggestion] = useState<SmartSuggestion | null>(null)
  const [watcherStatus, setWatcherStatus] = useState<WatcherStatus | null>(null)
  const [autoMode, setAutoMode] = useState(false)
  const [autoCountdown, setAutoCountdown] = useState(0)
  const [executing, setExecuting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [rejected, setRejected] = useState(false)
  const [history, setHistory] = useState<Array<{ prompt: string; status: string; time: string }>>([])
  const promptRef = useRef<HTMLDivElement>(null)

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/project-status?projectId=${projectId}`)
      if (res.ok) {
        const data = await res.json()
        setSuggestion(data.smartSuggestion)
        setWatcherStatus(data.watcherStatus)
      }
    } catch {
      // Ignore
    }
  }, [projectId])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  // Auto-mode countdown
  useEffect(() => {
    if (!autoMode || !suggestion || executing || rejected) {
      setAutoCountdown(0)
      return
    }
    if (watcherStatus?.status === 'running' || !watcherStatus?.connected) {
      setAutoCountdown(0)
      return
    }

    setAutoCountdown(AUTO_DELAY_SECONDS)
    const timer = setInterval(() => {
      setAutoCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          executeCommand(suggestion.prompt)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => { clearInterval(timer); setAutoCountdown(0) }
  }, [autoMode, suggestion?.prompt, watcherStatus?.status, executing, rejected])

  // Reset rejected when suggestion changes
  useEffect(() => { setRejected(false) }, [suggestion?.prompt])

  // Clear message after 3s
  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(null), 3000)
      return () => clearTimeout(t)
    }
  }, [message])

  const executeCommand = async (prompt: string) => {
    setExecuting(true)
    setMessage(null)

    try {
      const response = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          commandType: 'task',
          prompt,
          maxTurns: 10,
          priority: 0,
        }),
      })

      if (response.ok) {
        setHistory(prev => [{ prompt: prompt.slice(0, 120), status: 'sent', time: new Date().toLocaleTimeString() }, ...prev.slice(0, 4)])
        setMessage({ type: 'success', text: 'Sent to Claude Code' })
        setTimeout(fetchStatus, 1000)
      } else {
        const data = await response.json()
        setMessage({ type: 'error', text: data.error || 'Failed' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' })
    } finally {
      setExecuting(false)
    }
  }

  const handleAccept = () => {
    if (suggestion) executeCommand(suggestion.prompt)
  }

  const handleReject = () => {
    setRejected(true)
    setAutoCountdown(0)
  }

  const isConnected = watcherStatus?.connected ?? false
  const isRunning = watcherStatus?.status === 'running'

  return (
    <div className="space-y-4">
      {/* Status bar - minimal */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${
            isConnected
              ? (isRunning ? 'bg-blue-400 animate-pulse' : 'bg-matrix')
              : 'bg-red-400'
          }`} />
          <span className={`font-mono text-sm ${isConnected ? 'text-matrix' : 'text-red-400'}`}>
            {isConnected
              ? (isRunning ? 'EXECUTING' : 'ONLINE')
              : 'OFFLINE'}
          </span>
          {isRunning && watcherStatus?.currentTask && (
            <span className="text-xs text-dim truncate max-w-[300px]">
              — {watcherStatus.currentTask}
            </span>
          )}
        </div>

        <button
          onClick={() => {
            setAutoMode(!autoMode)
            if (!autoMode) setRejected(false)
          }}
          disabled={!isConnected}
          className={`px-4 py-2 rounded font-mono text-sm font-bold transition-all ${
            autoMode
              ? 'bg-matrix text-black'
              : 'bg-white/10 text-dim hover:bg-white/20'
          } ${!isConnected ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          AUTO {autoMode ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Toast message */}
      {message && (
        <div className={`px-4 py-2 rounded text-sm font-mono ${
          message.type === 'success'
            ? 'bg-matrix/20 text-matrix'
            : 'bg-red-500/20 text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      {/* THE PROMPT - this is the main event */}
      {suggestion && !rejected && (
        <div className="border border-gold/40 rounded-lg overflow-hidden">
          {/* Why header */}
          <div className="px-5 py-3 bg-gold/10 border-b border-gold/20">
            <p className="text-sm text-gold font-mono">{suggestion.reason}</p>
          </div>

          {/* Full prompt - always visible, scrollable */}
          <div
            ref={promptRef}
            className="px-5 py-4 bg-black/40 max-h-[400px] overflow-y-auto"
          >
            <pre className="text-sm font-mono leading-relaxed whitespace-pre-wrap break-words text-white/90">
              {suggestion.prompt}
            </pre>
          </div>

          {/* Accept / Reject */}
          <div className="flex border-t border-gold/20">
            <button
              onClick={handleAccept}
              disabled={!isConnected || executing || isRunning}
              className="flex-1 py-4 bg-matrix/20 text-matrix font-mono font-bold text-lg hover:bg-matrix/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all border-r border-gold/20"
            >
              {executing ? 'SENDING...' : isRunning ? 'WAITING...' : '✓ ACCEPT'}
            </button>
            <button
              onClick={handleReject}
              disabled={executing || isRunning}
              className="px-8 py-4 bg-red-500/10 text-red-400 font-mono font-bold text-lg hover:bg-red-500/20 disabled:opacity-40 transition-all"
            >
              ✕ SKIP
            </button>
          </div>

          {/* Auto countdown */}
          {autoMode && isConnected && !isRunning && autoCountdown > 0 && (
            <div className="px-5 py-2 bg-matrix/10 text-center">
              <span className="text-sm text-matrix font-mono">
                Auto-executing in {autoCountdown}s — click SKIP to cancel
              </span>
            </div>
          )}
        </div>
      )}

      {/* Rejected state */}
      {suggestion && rejected && (
        <div className="border border-white/10 rounded-lg p-6 text-center">
          <p className="text-dim font-mono text-sm mb-3">Prompt skipped</p>
          <button
            onClick={() => { setRejected(false); fetchStatus() }}
            className="px-6 py-2 rounded bg-white/10 text-sm font-mono hover:bg-white/20 transition-all"
          >
            Show Again
          </button>
        </div>
      )}

      {/* No suggestion */}
      {!suggestion && (
        <div className="border border-white/10 rounded-lg p-8 text-center">
          <p className="text-dim font-mono text-sm">
            {isConnected
              ? 'Analyzing project for next prompt...'
              : 'Run `midas watch` to connect'}
          </p>
        </div>
      )}

      {/* Recent prompts sent - compact log */}
      {history.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-mono text-dim">RECENT</p>
          {history.map((h, i) => (
            <div key={i} className="flex items-center gap-2 text-xs font-mono text-dim">
              <span className="text-matrix">✓</span>
              <span className="truncate flex-1">{h.prompt}</span>
              <span>{h.time}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
