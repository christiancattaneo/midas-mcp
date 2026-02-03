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

interface Project {
  id: string
  name: string
  current_phase: string
  current_step: string
  progress: number
}

interface GameplanTask {
  id: number
  task_id: string
  task_text: string
  phase: string | null
  completed: boolean
}

export default function PilotPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const sessionId = params.sessionId as string
  const token = searchParams.get('token')
  
  const [session, setSession] = useState<PilotSession | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<GameplanTask[]>([])
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [executing, setExecuting] = useState<string | null>(null)
  const [customPrompt, setCustomPrompt] = useState('')
  
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
  
  // Load projects when session is available
  useEffect(() => {
    if (!session || session.status === 'disconnected') return
    
    const loadProjects = async () => {
      // TODO: Load projects from user's DB
      // For now, we'll use a simple list
    }
    
    loadProjects()
  }, [session])
  
  const executeTask = async (taskText: string, projectId?: string) => {
    if (!session || !token) return
    
    setExecuting(taskText.slice(0, 50))
    
    try {
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId || selectedProject || 'default',
          command_type: 'task',
          prompt: taskText,
          priority: 1,
        }),
      })
      
      if (res.ok) {
        setCustomPrompt('')
      }
    } catch {
      // Error handling
    } finally {
      setExecuting(null)
    }
  }
  
  if (error) {
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
  
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/90 backdrop-blur border-b border-gray-800 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#d4af37]">MIDAS PILOT</h1>
            <p className="text-sm text-gray-400">Remote Control</p>
          </div>
          <div className={`flex items-center gap-2 ${statusColors[session.status]}`}>
            <span className="text-lg">{statusIcons[session.status]}</span>
            <span className="capitalize text-sm">{session.status}</span>
          </div>
        </div>
      </header>
      
      <main className="p-4 pb-32">
        {/* Current Task */}
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
        
        {/* Last Output */}
        {session.last_output && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-gray-400 mb-2">Last Output</h2>
            <pre className="p-3 rounded-lg bg-gray-900 text-xs text-green-400 overflow-x-auto max-h-48 overflow-y-auto font-mono">
              {session.last_output.slice(-2000)}
            </pre>
            <p className="text-xs text-gray-500 mt-1">{session.output_lines} lines</p>
          </section>
        )}
        
        {/* Quick Actions */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => executeTask('Run npm test and fix any failing tests')}
              disabled={session.status === 'running' || !!executing}
              className="p-4 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-left"
            >
              <span className="text-2xl mb-2 block">🧪</span>
              <span className="text-sm font-medium">Run Tests</span>
            </button>
            <button
              onClick={() => executeTask('Run linter and fix any issues')}
              disabled={session.status === 'running' || !!executing}
              className="p-4 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-left"
            >
              <span className="text-2xl mb-2 block">🔍</span>
              <span className="text-sm font-medium">Fix Lints</span>
            </button>
            <button
              onClick={() => executeTask('Build the project and fix any errors')}
              disabled={session.status === 'running' || !!executing}
              className="p-4 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-left"
            >
              <span className="text-2xl mb-2 block">🔨</span>
              <span className="text-sm font-medium">Build</span>
            </button>
            <button
              onClick={() => executeTask('Analyze the current state and suggest next steps')}
              disabled={session.status === 'running' || !!executing}
              className="p-4 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-left"
            >
              <span className="text-2xl mb-2 block">💡</span>
              <span className="text-sm font-medium">Analyze</span>
            </button>
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
        
        {/* Session Info */}
        <section className="text-xs text-gray-500">
          <p>Session: {session.id}</p>
          {session.expires_at && (
            <p>Expires: {new Date(session.expires_at).toLocaleTimeString()}</p>
          )}
          {session.last_heartbeat && (
            <p>Last active: {new Date(session.last_heartbeat).toLocaleTimeString()}</p>
          )}
        </section>
      </main>
      
      {/* Status Bar (Fixed at bottom) */}
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
