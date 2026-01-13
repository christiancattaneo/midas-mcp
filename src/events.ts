import { existsSync, readFileSync, writeFileSync, mkdirSync, watchFile, unwatchFile } from 'fs';
import { join } from 'path';

const MIDAS_DIR = '.midas';
const EVENTS_FILE = 'events.json';

export interface MidasEvent {
  id: string;
  timestamp: string;
  type: 'tool_called' | 'phase_changed' | 'prompt_copied' | 'step_completed' | 'ai_suggestion';
  tool?: string;
  phase?: string;
  step?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface EventLog {
  events: MidasEvent[];
  lastUpdated: string;
}

function getEventsPath(projectPath: string): string {
  return join(projectPath, MIDAS_DIR, EVENTS_FILE);
}

function ensureMidasDir(projectPath: string): void {
  const dir = join(projectPath, MIDAS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function loadEvents(projectPath: string): EventLog {
  const eventsPath = getEventsPath(projectPath);
  
  if (!existsSync(eventsPath)) {
    return { events: [], lastUpdated: new Date().toISOString() };
  }

  try {
    const raw = readFileSync(eventsPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { events: [], lastUpdated: new Date().toISOString() };
  }
}

export function saveEvents(projectPath: string, log: EventLog): void {
  ensureMidasDir(projectPath);
  log.lastUpdated = new Date().toISOString();
  writeFileSync(getEventsPath(projectPath), JSON.stringify(log, null, 2));
}

export function logEvent(projectPath: string, event: Omit<MidasEvent, 'id' | 'timestamp'>): MidasEvent {
  const log = loadEvents(projectPath);
  
  const fullEvent: MidasEvent = {
    ...event,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };
  
  // Keep last 100 events
  log.events = [...log.events.slice(-99), fullEvent];
  saveEvents(projectPath, log);
  
  return fullEvent;
}

export function getRecentEvents(projectPath: string, count = 10): MidasEvent[] {
  const log = loadEvents(projectPath);
  return log.events.slice(-count);
}

export function watchEvents(
  projectPath: string,
  callback: (events: MidasEvent[]) => void
): () => void {
  const eventsPath = getEventsPath(projectPath);
  
  // Create file if doesn't exist
  if (!existsSync(eventsPath)) {
    saveEvents(projectPath, { events: [], lastUpdated: new Date().toISOString() });
  }

  let lastLength = loadEvents(projectPath).events.length;

  const checkForUpdates = () => {
    const log = loadEvents(projectPath);
    if (log.events.length > lastLength) {
      const newEvents = log.events.slice(lastLength);
      lastLength = log.events.length;
      callback(newEvents);
    }
  };

  watchFile(eventsPath, { interval: 500 }, checkForUpdates);

  return () => {
    unwatchFile(eventsPath, checkForUpdates);
  };
}
