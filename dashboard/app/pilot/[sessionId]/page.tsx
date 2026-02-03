'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

interface PilotSession {
  id: string
  status: 'waiting' | 'connected' | 'running' | 'idle' | 'disconnected'
  current_project: string | null
  current_task: string | null
  last_output: string | null
  output_lines: number
  last_heartbeat: string | null
  created_at: string
  expires_at: string | null
}

interface SmartSuggestion {
  prompt: string
  reason: string
  priority: 'critical' | 'high' | 'normal' | 'low'
  context: string | null
  phase: string
  step: string
  synced_at: string
}

interface PilotContext {
  projects: { id: string; name: string; phase: string; step: string; progress: number }[]
  activeProject: { id: string; name: string; phase: string; step: string; progress: number } | null
  smartSuggestion: SmartSuggestion | null
  gameplanTasks: { id: number; task: string; completed: boolean; phase: string | null }[]
  gates: { compiles: boolean | null; tests: boolean | null; lints: boolean | null } | null
  nextTask: { id: number; task: string; completed: boolean; phase: string | null } | null
  quickActions: { id: string; icon: string; label: string; prompt: string }[]
}

export default function PilotPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const sessionId = params.sessionId as string
  const token = searchParams.get('token')
  
  const [session, setSession] = useState<PilotSession | null>(null)
  const [context, setContext] = useState<PilotContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [executing, setExecuting] = useState<string | null>(null)
  const [customPrompt, setCustomPrompt] = useState('')
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  
  // Poll for session status
  useEffect(() => {
    if (!token) {
      setError('Missing session token')
      return
    }
    
    const poll = async () => {
      try {
        const res = await fetch(`/api/pilot-session/${sessionId}?token=${token}`)
        if (!res.ok) {
          const data = await res.json()
          setError(data.error || 'Session error')
          return
        }
        const data = await res.json()
        setSession(data.session)
      } catch {
        setError('Connection error')
      }
    }
    
    poll()
    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [sessionId, token])
  
  // Fetch context (projects, suggestions, tasks) when session is available
  useEffect(() => {
    if (!session || !token || session.status === 'disconnected') return
    
    const fetchContext = async () => {
      try {
        const res = await fetch(`/api/pilot-context?sessionId=${sessionId}&token=${token}`)
        if (res.ok) {
          const data = await res.json()
          setContext(data)
        }
      } catch {
        // Non-fatal, context is optional
      }
    }
    
    fetchContext()
    // Refresh context every 30 seconds
    const interval = setInterval(fetchContext, 30000)
    return () => clearInterval(interval)
  }, [session, sessionId, token])
  
  const executeTask = async (taskText: string) => {
    if (!session || !token) return
    
    setExecuting(taskText.slice(0, 50))
    setError(null)
    
    try {
      const res = await fetch('/api/pilot-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          sessionToken: token,
          prompt: taskText,
          commandType: 'task',
          priority: 1,
        }),
      })
      
      const data = await res.json()
      if (!res.ok) {
        console.error('Command error:', data.error)
        setError(data.error || 'Failed to send command')
        return
      }
      
      setCustomPrompt('')
      setSuccessMessage('Command sent!')
      setTimeout(() => setSuccessMessage(null), 2000)
    } catch (err) {
      setError('Connection error')
    } finally {
      setExecuting(null)
    }
  }
  
  if (error && !session) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold text-red-400 mb-2">{error}</h1>
          <p className="text-gray-400">
            {error === 'Session expired' 
              ? 'Run midas pilot --remote to start a new session'
              : 'Check the terminal for details'}
          </p>
        </div>
      </div>
    )
  }
  
  if (!session) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="animate-pulse text-center">
          <div className="text-4xl mb-4">⚡</div>
          <p className="text-gray-400">Connecting to Pilot...</p>
        </div>
      </div>
    )
  }
  
  const statusColors: Record<string, string> = {
    waiting: 'text-yellow-400',
    connected: 'text-green-400',
    running: 'text-blue-400',
    idle: 'text-green-400',
    disconnected: 'text-red-400',
  }
  
  const statusIcons: Record<string, string> = {
    waiting: '⏳',
    connected: '✓',
    running: '⚡',
    idle: '💤',
    disconnected: '✗',
  }
  
  const priorityColors: Record<string, string> = {
    critical: 'bg-red-900/50 border-red-500/50',
    high: 'bg-orange-900/50 border-orange-500/50',
    normal: 'bg-blue-900/50 border-blue-500/50',
    low: 'bg-gray-800 border-gray-600',
  }
  
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/90 backdrop-blur border-b border-gray-800 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#d4af37]">MIDAS PILOT</h1>
            {context?.activeProject && (
              <p className="text-sm text-gray-400">
                {context.activeProject.name} • {context.activeProject.phase}/{context.activeProject.step}
              </p>
            )}
          </div>
          <div className={`flex items-center gap-2 ${statusColors[session.status]}`}>
            <span className="text-lg">{statusIcons[session.status]}</span>
            <span className="capitalize text-sm">{session.status}</span>
          </div>
        </div>
      </header>
      
      <main className="p-4 pb-32">
        {/* Error/Success Messages */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/50 border border-red-500/50 text-red-400">
            {error}
            <button onClick={() => setError(null)} className="float-right">✕</button>
          </div>
        )}
        {successMessage && (
          <div className="mb-4 p-3 rounded-lg bg-green-900/50 border border-green-500/50 text-green-400 text-center">
            ✓ {successMessage}
          </div>
        )}
        
        {/* Currently Running */}
        {session.current_task && (
          <section className="mb-6 p-4 rounded-lg bg-blue-900/30 border border-blue-500/50">
            <h2 className="text-sm font-semibold text-blue-400 mb-2">Currently Running</h2>
            <p className="text-white">{session.current_task}</p>
            <div className="mt-2 flex items-center gap-2">
              <div className="animate-pulse w-2 h-2 rounded-full bg-blue-400"></div>
              <span className="text-xs text-gray-400">Executing...</span>
            </div>
          </section>
        )}
        
        {/* Smart Suggestion (Primary Action) */}
        {context?.smartSuggestion && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Suggested Next Step</h2>
            <div className={`p-4 rounded-lg border ${priorityColors[context.smartSuggestion.priority]}`}>
              <div className="flex items-start justify-between mb-2">
                <span className={`text-xs font-bold uppercase ${
                  context.smartSuggestion.priority === 'critical' ? 'text-red-400' :
                  context.smartSuggestion.priority === 'high' ? 'text-orange-400' :
                  'text-blue-400'
                }`}>
                  {context.smartSuggestion.priority} priority
                </span>
                <span className="text-xs text-gray-500">
                  {context.smartSuggestion.phase}/{context.smartSuggestion.step}
                </span>
              </div>
              <p className="text-sm text-gray-300 mb-2">{context.smartSuggestion.reason}</p>
              <p className="text-white mb-3">{context.smartSuggestion.prompt.slice(0, 200)}</p>
              <button
                onClick={() => executeTask(context.smartSuggestion!.prompt)}
                disabled={session.status === 'running' || !!executing}
                className="w-full py-3 rounded-lg bg-[#d4af37] text-black font-semibold hover:bg-[#e5c048] disabled:opacity-50"
              >
                {executing ? 'Sending...' : 'Execute This'}
              </button>
            </div>
          </section>
        )}
        
        {/* Next Gameplan Task */}
        {context?.nextTask && !context.smartSuggestion && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Next Task</h2>
            <div className="p-4 rounded-lg bg-gray-800 border border-gray-600">
              <p className="text-white mb-3">{context.nextTask.task}</p>
              <button
                onClick={() => executeTask(context.nextTask!.task)}
                disabled={session.status === 'running' || !!executing}
                className="w-full py-3 rounded-lg bg-[#d4af37] text-black font-semibold hover:bg-[#e5c048] disabled:opacity-50"
              >
                {executing ? 'Sending...' : 'Execute This'}
              </button>
            </div>
          </section>
        )}
        
        {/* Gates Status */}
        {context?.gates && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-gray-400 mb-3">Gates</h2>
            <div className="flex gap-4">
              <div className={`flex items-center gap-2 ${context.gates.compiles === false ? 'text-red-400' : context.gates.compiles === true ? 'text-green-400' : 'text-gray-500'}`}>
                {context.gates.compiles === false ? '✕' : context.gates.compiles === true ? '✓' : '○'} Build
              </div>
              <div className={`flex items-center gap-2 ${context.gates.tests === false ? 'text-red-400' : context.gates.tests === true ? 'text-green-400' : 'text-gray-500'}`}>
                {context.gates.tests === false ? '✕' : context.gates.tests === true ? '✓' : '○'} Tests
              </div>
              <div className={`flex items-center gap-2 ${context.gates.lints === false ? 'text-red-400' : context.gates.lints === true ? 'text-green-400' : 'text-gray-500'}`}>
                {context.gates.lints === false ? '✕' : context.gates.lints === true ? '✓' : '○'} Lint
              </div>
            </div>
          </section>
        )}
        
        {/* Quick Actions */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            {(context?.quickActions || [
              { id: 'test', icon: '🧪', label: 'Run Tests', prompt: 'Run tests and fix failures' },
              { id: 'lint', icon: '🔍', label: 'Fix Lints', prompt: 'Fix linter errors' },
              { id: 'build', icon: '🔨', label: 'Build', prompt: 'Build and fix errors' },
              { id: 'analyze', icon: '💡', label: 'Analyze', prompt: 'Analyze state and suggest next step' },
            ]).slice(0, 4).map((action) => (
              <button
                key={action.id}
                onClick={() => executeTask(action.prompt)}
                disabled={session.status === 'running' || !!executing}
                className="p-4 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-left"
              >
                <span className="text-2xl mb-2 block">{action.icon}</span>
                <span className="text-sm font-medium">{action.label}</span>
              </button>
            ))}
          </div>
        </section>
        
        {/* Custom Prompt */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Custom Command</h2>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="Enter any command for Claude..."
            className="w-full p-3 rounded-lg bg-gray-900 border border-gray-700 text-white placeholder-gray-500 resize-none focus:outline-none focus:border-[#d4af37]"
            rows={3}
          />
          <button
            onClick={() => executeTask(customPrompt)}
            disabled={!customPrompt.trim() || session.status === 'running' || !!executing}
            className="mt-2 w-full py-3 rounded-lg bg-[#d4af37] text-black font-semibold hover:bg-[#e5c048] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {executing ? 'Sending...' : 'Execute Command'}
          </button>
        </section>
        
        {/* Sync Reminder */}
        {!context?.smartSuggestion && !context?.nextTask && (
          <section className="mb-6 p-4 rounded-lg bg-gray-900 border border-gray-700">
            <p className="text-sm text-gray-400 mb-2">No synced data. Run this in your project:</p>
            <code className="text-[#d4af37]">midas sync</code>
          </section>
        )}
        
        {/* Session Info */}
        <section className="text-xs text-gray-500">
          <p>Session: {session.id.slice(0, 8)}...</p>
          {session.expires_at && (
            <p>Expires: {new Date(session.expires_at).toLocaleTimeString()}</p>
          )}
        </section>
      </main>
      
      {/* Status Bar */}
      <footer className="fixed bottom-0 left-0 right-0 bg-black/95 border-t border-gray-800 p-4">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${session.status === 'running' ? 'bg-blue-400 animate-pulse' : session.status === 'disconnected' ? 'bg-red-400' : 'bg-green-400'}`}></div>
            <span className="text-gray-400">
              {session.status === 'running' ? 'Executing...' : 
               session.status === 'disconnected' ? 'Disconnected' : 
               'Ready'}
            </span>
          </div>
          <span className="text-[#d4af37]">MIDAS</span>
        </div>
      </footer>
    </div>
  )
}
