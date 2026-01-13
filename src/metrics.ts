import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Phase } from './state/phase.js';

const MIDAS_DIR = '.midas';
const METRICS_FILE = 'metrics.json';

export interface SessionMetrics {
  sessionId: string;
  startTime: string;
  endTime?: string;
  startPhase: Phase;
  endPhase?: Phase;
  toolCalls: number;
  tornadoCycles: number;
  journalsSaved: number;
  promptsCopied: number;
}

export interface ProjectMetrics {
  totalSessions: number;
  totalToolCalls: number;
  totalTornadoCycles: number;
  totalJournalsSaved: number;
  phaseHistory: Array<{ phase: string; enteredAt: string; duration?: number }>;
  sessions: SessionMetrics[];
  averageSessionMinutes: number;
  currentStreak: number; // consecutive days with sessions
  lastSessionDate: string;
}

function getMetricsPath(projectPath: string): string {
  return join(projectPath, MIDAS_DIR, METRICS_FILE);
}

function ensureDir(projectPath: string): void {
  const dir = join(projectPath, MIDAS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function loadMetrics(projectPath: string): ProjectMetrics {
  const path = getMetricsPath(projectPath);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {}
  }
  return {
    totalSessions: 0,
    totalToolCalls: 0,
    totalTornadoCycles: 0,
    totalJournalsSaved: 0,
    phaseHistory: [],
    sessions: [],
    averageSessionMinutes: 0,
    currentStreak: 0,
    lastSessionDate: '',
  };
}

export function saveMetrics(projectPath: string, metrics: ProjectMetrics): void {
  ensureDir(projectPath);
  writeFileSync(getMetricsPath(projectPath), JSON.stringify(metrics, null, 2));
}

export function startSession(projectPath: string, currentPhase: Phase): string {
  const metrics = loadMetrics(projectPath);
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  
  const session: SessionMetrics = {
    sessionId,
    startTime: new Date().toISOString(),
    startPhase: currentPhase,
    toolCalls: 0,
    tornadoCycles: 0,
    journalsSaved: 0,
    promptsCopied: 0,
  };
  
  metrics.sessions.push(session);
  metrics.totalSessions++;
  
  // Update streak
  const today = new Date().toISOString().slice(0, 10);
  const lastDate = metrics.lastSessionDate;
  if (lastDate) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (lastDate === yesterday) {
      metrics.currentStreak++;
    } else if (lastDate !== today) {
      metrics.currentStreak = 1;
    }
  } else {
    metrics.currentStreak = 1;
  }
  metrics.lastSessionDate = today;
  
  saveMetrics(projectPath, metrics);
  return sessionId;
}

export function endSession(projectPath: string, sessionId: string, endPhase: Phase): void {
  const metrics = loadMetrics(projectPath);
  const session = metrics.sessions.find(s => s.sessionId === sessionId);
  
  if (session) {
    session.endTime = new Date().toISOString();
    session.endPhase = endPhase;
    
    // Calculate average session time
    const completedSessions = metrics.sessions.filter(s => s.endTime);
    if (completedSessions.length > 0) {
      const totalMinutes = completedSessions.reduce((acc, s) => {
        const start = new Date(s.startTime).getTime();
        const end = new Date(s.endTime!).getTime();
        return acc + (end - start) / 60000;
      }, 0);
      metrics.averageSessionMinutes = Math.round(totalMinutes / completedSessions.length);
    }
  }
  
  saveMetrics(projectPath, metrics);
}

export function recordToolCall(projectPath: string, sessionId: string, toolName: string): void {
  const metrics = loadMetrics(projectPath);
  const session = metrics.sessions.find(s => s.sessionId === sessionId);
  
  if (session) {
    session.toolCalls++;
    metrics.totalToolCalls++;
    
    if (toolName === 'midas_tornado') {
      session.tornadoCycles++;
      metrics.totalTornadoCycles++;
    }
    
    if (toolName === 'midas_journal_save') {
      session.journalsSaved++;
      metrics.totalJournalsSaved++;
    }
  }
  
  saveMetrics(projectPath, metrics);
}

export function recordPromptCopied(projectPath: string, sessionId: string): void {
  const metrics = loadMetrics(projectPath);
  const session = metrics.sessions.find(s => s.sessionId === sessionId);
  
  if (session) {
    session.promptsCopied++;
  }
  
  saveMetrics(projectPath, metrics);
}

export function recordPhaseChange(projectPath: string, phase: Phase): void {
  const metrics = loadMetrics(projectPath);
  
  // Close previous phase
  const lastPhase = metrics.phaseHistory[metrics.phaseHistory.length - 1];
  if (lastPhase && !lastPhase.duration) {
    const entered = new Date(lastPhase.enteredAt).getTime();
    lastPhase.duration = Math.round((Date.now() - entered) / 60000); // minutes
  }
  
  // Add new phase
  const phaseStr = phase.phase === 'IDLE' ? 'IDLE' : `${phase.phase}:${phase.step}`;
  metrics.phaseHistory.push({
    phase: phaseStr,
    enteredAt: new Date().toISOString(),
  });
  
  saveMetrics(projectPath, metrics);
}

export function getMetricsSummary(projectPath: string): string {
  const m = loadMetrics(projectPath);
  
  if (m.totalSessions === 0) {
    return 'No sessions yet';
  }
  
  const lines: string[] = [];
  lines.push(`Sessions: ${m.totalSessions} (${m.currentStreak} day streak)`);
  lines.push(`Avg session: ${m.averageSessionMinutes} min`);
  lines.push(`Tool calls: ${m.totalToolCalls}`);
  lines.push(`Tornado cycles: ${m.totalTornadoCycles}`);
  lines.push(`Journals saved: ${m.totalJournalsSaved}`);
  
  return lines.join('\n');
}
