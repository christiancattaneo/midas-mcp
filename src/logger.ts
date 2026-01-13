/**
 * Logging utility for Midas MCP server
 * Writes to stderr to keep stdout clean for MCP protocol
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Default to 'info' unless MCP_DEBUG is set
const currentLevel: LogLevel = (process.env.MIDAS_LOG_LEVEL as LogLevel) || 
  (process.env.MCP_DEBUG ? 'debug' : 'info');

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, message: string, data?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  const prefix = `[${timestamp}] [MIDAS]`;
  
  let color = COLORS.reset;
  let levelStr = level.toUpperCase().padEnd(5);
  
  switch (level) {
    case 'debug':
      color = COLORS.dim;
      break;
    case 'info':
      color = COLORS.cyan;
      break;
    case 'warn':
      color = COLORS.yellow;
      break;
    case 'error':
      color = COLORS.red;
      break;
  }
  
  let output = `${color}${prefix} ${levelStr}${COLORS.reset} ${message}`;
  
  if (data) {
    output += ` ${COLORS.dim}${JSON.stringify(data)}${COLORS.reset}`;
  }
  
  return output;
}

export const logger = {
  debug(message: string, data?: Record<string, unknown>): void {
    if (shouldLog('debug')) {
      console.error(formatMessage('debug', message, data));
    }
  },

  info(message: string, data?: Record<string, unknown>): void {
    if (shouldLog('info')) {
      console.error(formatMessage('info', message, data));
    }
  },

  warn(message: string, data?: Record<string, unknown>): void {
    if (shouldLog('warn')) {
      console.error(formatMessage('warn', message, data));
    }
  },

  error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    if (shouldLog('error')) {
      const errorData = error instanceof Error 
        ? { ...data, error: error.message, stack: error.stack }
        : { ...data, error: String(error) };
      console.error(formatMessage('error', message, errorData));
    }
  },

  /** Log tool invocation for debugging */
  tool(name: string, input: Record<string, unknown>): void {
    this.debug(`Tool called: ${name}`, input);
  },

  /** Log phase transition */
  phase(from: string, to: string): void {
    this.info(`Phase transition: ${from} → ${to}`);
  },
};
