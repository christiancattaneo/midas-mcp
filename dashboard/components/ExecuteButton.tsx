'use client'

import { useState } from 'react'

interface ExecuteButtonProps {
  projectId: string
  task: string
  projectName: string
  phase: string
  step: string
}

export function ExecuteButton({ projectId, task, projectName, phase, step }: ExecuteButtonProps) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'queued' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const handleExecute = async () => {
    setStatus('sending')
    setMessage('')

    const prompt = `I'm working on ${projectName}, currently in ${phase} phase (${step} step).

My next task from the gameplan is:
${task}

Please implement this task. Start by analyzing what's needed, then proceed with the implementation.
When complete, summarize what was done.`

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

      const data = await response.json()

      if (response.ok) {
        setStatus('queued')
        setMessage(data.message || 'Command queued!')
      } else {
        setStatus('error')
        setMessage(data.error || 'Failed to queue command')
      }
    } catch (err) {
      setStatus('error')
      setMessage('Network error')
    }
  }

  if (status === 'queued') {
    return (
      <div className="execute-btn queued">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span>Queued</span>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <button onClick={handleExecute} className="execute-btn error" title={message}>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
        <span>Retry</span>
      </button>
    )
  }

  return (
    <button 
      onClick={handleExecute} 
      className="execute-btn"
      disabled={status === 'sending'}
    >
      {status === 'sending' ? (
        <>
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Sending...</span>
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>Execute</span>
        </>
      )}
    </button>
  )
}
