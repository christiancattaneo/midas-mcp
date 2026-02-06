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

interface ActiveCommand {
  id: number
  prompt: string
  status: string
  output: string | null
  error: string | null
  started_at: string | null
  duration_ms: number | null
}

interface PilotSession {
  last_output: string | null
  output_lines: number
  current_task: string | null
}

interface StatusResponse {
  smartSuggestion: SmartSuggestion | null
  watcherStatus: WatcherStatus
  activeCommand: ActiveCommand | null
  pilotSession: PilotSession | null
}

interface CommandCenterProps {
  projectId: string
  projectName: string
  phase: string
  step: string
}

const AUTO_DELAY_SECONDS = 5
const POLL_IDLE_MS = 5000
const POLL_RUNNING_MS = 1500  // Poll faster when executing

export function CommandCenter({ projectId }: CommandCenterProps) {
  const [suggestion, setSuggestion] = useState<SmartSuggestion | null>(null)
  const [watcherStatus, setWatcherStatus] = useState<WatcherStatus | null>(null)
  const [activeCommand, setActiveCommand] = useState<ActiveCommand | null>(null)
  const [pilotOutput, setPilotOutput] = useState<string | null>(null)
  const [autoMode, setAutoMode] = useState(false)
  const [autoCountdown, setAutoCountdown] = useState(0)
  const [executing, setExecuting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [rejected, setRejected] = useState(false)
  const outputRef = useRef<HTMLDivElement>(null)

  const isConnected = watcherStatus?.connected ?? false
  const isRunning = watcherStatus?.status === 'running'
  const hasActiveCommand = activeCommand && (activeCommand.status === 'running' || activeCommand.status === 'pending')

  // Fetch status - poll faster when running
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/project-status?projectId=${projectId}`)
      if (res.ok) {
        const data: StatusResponse = await res.json()
        setSuggestion(data.smartSuggestion)
        setWatcherStatus(data.watcherStatus)
        setActiveCommand(data.activeCommand)
        if (data.pilotSession?.last_output) {
          setPilotOutput(data.pilotSession.last_output)
        }
      }
    } catch {
      // Ignore
    }
  }, [projectId])

  useEffect(() => {
    fetchStatus()
    // Poll faster when running to get live output
    const ms = isRunning ? POLL_RUNNING_MS : POLL_IDLE_MS
    const interval = setInterval(fetchStatus, ms)
    return () => clearInterval(interval)
  }, [fetchStatus, isRunning])

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [pilotOutput, activeCommand?.output])

  // Auto-mode countdown
  useEffect(() => {
    if (!autoMode || !suggestion || executing || rejected || isRunning || hasActiveCommand) {
      setAutoCountdown(0)
      return
    }
    if (!isConnected) {
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
  }, [autoMode, suggestion?.prompt, isConnected, isRunning, executing, rejected, hasActiveCommand])

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
    setPilotOutput(null)

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
        setMessage({ type: 'success', text: 'Sent to Claude Code' })
        setTimeout(fetchStatus, 500)
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

  // Determine what to show
  const showExecution = isRunning || hasActiveCommand
  const showPrompt = suggestion && !rejected && !showExecution
  const showEmpty = !suggestion && !showExecution

  // Get live output text
  const liveOutput = activeCommand?.output || pilotOutput || null
  const currentPrompt = activeCommand?.prompt || watcherStatus?.currentTask || null

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${
            isConnected
              ? (isRunning ? 'bg-blue-400 animate-pulse' : 'bg-matrix')
              : 'bg-red-400'
          }`} />
          <span className={`font-mono text-sm font-bold ${
            isRunning ? 'text-blue-400' : isConnected ? 'text-matrix' : 'text-red-400'
          }`}>
            {isRunning ? 'EXECUTING' : isConnected ? 'READY' : 'OFFLINE'}
          </span>
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

      {/* Toast */}
      {message && (
        <div className={`px-4 py-2 rounded text-sm font-mono ${
          message.type === 'success' ? 'bg-matrix/20 text-matrix' : 'bg-red-500/20 text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      {/* ===== EXECUTION VIEW - Live streaming output ===== */}
      {showExecution && (
        <div className="border border-blue-400/40 rounded-lg overflow-hidden">
          {/* What's running */}
          <div className="px-4 py-3 bg-blue-400/10 border-b border-blue-400/20 flex items-center gap-3">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
            <span className="text-sm font-mono text-blue-400 font-bold">RUNNING</span>
            {activeCommand?.started_at && (
              <span className="text-xs text-dim font-mono ml-auto">
                {Math.round((Date.now() - new Date(activeCommand.started_at).getTime()) / 1000)}s
              </span>
            )}
          </div>

          {/* The prompt being executed */}
          {currentPrompt && (
            <div className="px-4 py-3 bg-black/30 border-b border-blue-400/10">
              <p className="text-xs font-mono text-dim mb-1">PROMPT</p>
              <pre className="text-sm font-mono whitespace-pre-wrap break-words text-white/80 max-h-[120px] overflow-y-auto">
                {currentPrompt}
              </pre>
            </div>
          )}

          {/* Live output stream */}
          <div
            ref={outputRef}
            className="px-4 py-3 bg-black/60 max-h-[400px] overflow-y-auto"
          >
            {liveOutput ? (
              <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words text-green-400/80">
                {liveOutput}
              </pre>
            ) : (
              <div className="flex items-center gap-2 py-4">
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                <span className="text-sm font-mono text-dim">Waiting for output...</span>
              </div>
            )}
          </div>

          {/* Completed command result */}
          {activeCommand?.status === 'completed' && (
            <div className={`px-4 py-2 border-t ${
              activeCommand.exit_code === 0
                ? 'bg-matrix/10 border-matrix/20 text-matrix'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}>
              <span className="text-sm font-mono font-bold">
                {activeCommand.exit_code === 0 ? '✓ DONE' : '✕ FAILED'}
                {activeCommand.duration_ms && ` (${(activeCommand.duration_ms / 1000).toFixed(1)}s)`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ===== PROMPT VIEW - Accept/Reject ===== */}
      {showPrompt && (
        <div className="border border-gold/40 rounded-lg overflow-hidden">
          {/* Why */}
          <div className="px-5 py-3 bg-gold/10 border-b border-gold/20">
            <p className="text-sm text-gold font-mono">{suggestion.reason}</p>
          </div>

          {/* Full prompt */}
          <div className="px-5 py-4 bg-black/40 max-h-[400px] overflow-y-auto">
            <pre className="text-sm font-mono leading-relaxed whitespace-pre-wrap break-words text-white/90">
              {suggestion.prompt}
            </pre>
          </div>

          {/* Accept / Skip */}
          <div className="flex border-t border-gold/20">
            <button
              onClick={() => executeCommand(suggestion.prompt)}
              disabled={!isConnected || executing}
              className="flex-1 py-4 bg-matrix/20 text-matrix font-mono font-bold text-lg hover:bg-matrix/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all border-r border-gold/20"
            >
              {executing ? 'SENDING...' : '✓ ACCEPT'}
            </button>
            <button
              onClick={() => { setRejected(true); setAutoCountdown(0) }}
              disabled={executing}
              className="px-8 py-4 bg-red-500/10 text-red-400 font-mono font-bold text-lg hover:bg-red-500/20 disabled:opacity-40 transition-all"
            >
              ✕ SKIP
            </button>
          </div>

          {/* Auto countdown */}
          {autoMode && autoCountdown > 0 && (
            <div className="px-5 py-2 bg-matrix/10 text-center">
              <span className="text-sm text-matrix font-mono">
                Auto-executing in {autoCountdown}s — click SKIP to cancel
              </span>
            </div>
          )}
        </div>
      )}

      {/* Rejected */}
      {suggestion && rejected && !showExecution && (
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

      {/* No suggestion, not running */}
      {showEmpty && (
        <div className="border border-white/10 rounded-lg p-8 text-center">
          <p className="text-dim font-mono text-sm">
            {isConnected
              ? 'Waiting for next suggestion...'
              : 'Run `midas watch` to connect'}
          </p>
        </div>
      )}
    </div>
  )
}
