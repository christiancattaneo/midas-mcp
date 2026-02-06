/**
 * Claude Code Integration
 * 
 * Handles detection, installation guidance, and authentication checks
 * for Claude Code CLI integration with Midas.
 */

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface ClaudeCodeStatus {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  installPath?: string;
  error?: string;
}

/**
 * Check if Claude Code CLI is installed
 */
export function isClaudeCodeInstalled(): boolean {
  try {
    // Try to run claude --version
    execSync('claude --version', { 
      stdio: 'pipe',
      timeout: 5000 
    });
    return true;
  } catch {
    // Check common installation paths
    const commonPaths = [
      join(homedir(), '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
    ];
    
    for (const path of commonPaths) {
      if (existsSync(path)) {
        return true;
      }
    }
    
    return false;
  }
}

/**
 * Get Claude Code version
 */
export function getClaudeCodeVersion(): string | null {
  try {
    const output = execSync('claude --version', { 
      stdio: 'pipe',
      timeout: 5000 
    }).toString().trim();
    return output;
  } catch {
    return null;
  }
}

/**
 * Check if Claude Code is authenticated
 * Claude Code stores auth in ~/.claude/ directory
 */
export function isClaudeCodeAuthenticated(): boolean {
  try {
    // Check for auth files in ~/.claude/
    const claudeDir = join(homedir(), '.claude');
    const authIndicators = [
      join(claudeDir, 'settings.json'),
      join(claudeDir, 'credentials.json'),
    ];
    
    // If claude directory exists with settings, likely authenticated
    if (existsSync(claudeDir)) {
      for (const file of authIndicators) {
        if (existsSync(file)) {
          return true;
        }
      }
    }
    
    // More reliable: try running a simple command
    // claude doctor checks auth status
    try {
      const output = execSync('claude doctor 2>&1', {
        stdio: 'pipe',
        timeout: 10000
      }).toString();
      
      // If it mentions "authenticated" or doesn't show auth errors, we're good
      if (output.includes('authenticated') || 
          !output.includes('not logged in') &&
          !output.includes('authentication required')) {
        return true;
      }
    } catch {
      // claude doctor might not exist in older versions
    }
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Get full Claude Code status
 */
export function getClaudeCodeStatus(): ClaudeCodeStatus {
  const installed = isClaudeCodeInstalled();
  
  if (!installed) {
    return {
      installed: false,
      authenticated: false,
      error: 'Claude Code is not installed'
    };
  }
  
  const version = getClaudeCodeVersion();
  const authenticated = isClaudeCodeAuthenticated();
  
  return {
    installed: true,
    authenticated,
    version: version || undefined,
    installPath: getClaudeCodePath() || undefined,
    error: authenticated ? undefined : 'Claude Code is not authenticated'
  };
}

/**
 * Get path to claude executable
 */
export function getClaudeCodePath(): string | null {
  try {
    const output = execSync('which claude', { 
      stdio: 'pipe',
      timeout: 5000 
    }).toString().trim();
    return output || null;
  } catch {
    // Check common paths
    const commonPaths = [
      join(homedir(), '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
    ];
    
    for (const path of commonPaths) {
      if (existsSync(path)) {
        return path;
      }
    }
    
    return null;
  }
}

/**
 * Get installation instructions based on platform
 */
export function getInstallInstructions(): {
  command: string;
  description: string;
  platform: string;
} {
  const platform = process.platform;
  
  if (platform === 'darwin' || platform === 'linux') {
    return {
      command: 'curl -fsSL https://claude.ai/install.sh | bash',
      description: 'Install Claude Code via the official installer',
      platform: platform === 'darwin' ? 'macOS' : 'Linux'
    };
  } else if (platform === 'win32') {
    return {
      command: 'irm https://claude.ai/install.ps1 | iex',
      description: 'Install Claude Code via PowerShell',
      platform: 'Windows'
    };
  }
  
  return {
    command: 'curl -fsSL https://claude.ai/install.sh | bash',
    description: 'Install Claude Code',
    platform: 'Unknown'
  };
}

/**
 * Get authentication instructions
 */
export function getAuthInstructions(): {
  command: string;
  description: string;
  steps: string[];
} {
  return {
    command: 'claude',
    description: 'Authenticate Claude Code with your Claude.ai account',
    steps: [
      'Run "claude" in your terminal',
      'A browser window will open for authentication',
      'Log in with your Claude.ai account (Pro, Max, or Teams)',
      'Return to the terminal - you should see "Authenticated successfully"',
      'Run "midas run" again to continue'
    ]
  };
}

/**
 * Interactive setup check - returns formatted messages for TUI
 */
export function checkSetupStatus(): {
  ready: boolean;
  status: ClaudeCodeStatus;
  messages: string[];
  actions: Array<{ label: string; command: string; description: string }>;
} {
  const status = getClaudeCodeStatus();
  const messages: string[] = [];
  const actions: Array<{ label: string; command: string; description: string }> = [];
  
  if (!status.installed) {
    messages.push('❌ Claude Code is not installed');
    messages.push('');
    messages.push('Midas uses Claude Code to execute AI prompts.');
    messages.push('Claude Code is a free CLI that connects to your Claude.ai account.');
    
    const install = getInstallInstructions();
    actions.push({
      label: 'Install Claude Code',
      command: install.command,
      description: install.description
    });
    
    return { ready: false, status, messages, actions };
  }
  
  if (!status.authenticated) {
    messages.push('✓ Claude Code installed' + (status.version ? ` (${status.version})` : ''));
    messages.push('❌ Claude Code not authenticated');
    messages.push('');
    messages.push('You need to log in to Claude.ai to use Claude Code.');
    
    const auth = getAuthInstructions();
    actions.push({
      label: 'Authenticate',
      command: auth.command,
      description: auth.description
    });
    
    return { ready: false, status, messages, actions };
  }
  
  messages.push('✓ Claude Code installed' + (status.version ? ` (${status.version})` : ''));
  messages.push('✓ Claude Code authenticated');
  messages.push('');
  messages.push('Ready to execute prompts via Claude Code!');
  
  return { ready: true, status, messages, actions };
}

/**
 * Run Claude Code with a prompt
 * Returns the output and exit code
 */
export async function runClaudeCode(
  prompt: string,
  options: {
    cwd?: string;
    maxTurns?: number;
    outputFormat?: 'text' | 'json' | 'stream-json';
    allowedTools?: string[];
    appendSystemPrompt?: string;
    timeout?: number;
    onOutput?: (chunk: string) => void;
  } = {}
): Promise<{
  success: boolean;
  output: string;
  exitCode: number;
  sessionId?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const args: string[] = ['-p', prompt];
    
    if (options.outputFormat) {
      args.push('--output-format', options.outputFormat);
    }
    
    if (options.maxTurns) {
      args.push('--max-turns', String(options.maxTurns));
    }
    
    if (options.allowedTools && options.allowedTools.length > 0) {
      args.push('--allowedTools', options.allowedTools.join(','));
    }
    
    if (options.appendSystemPrompt) {
      args.push('--append-system-prompt', options.appendSystemPrompt);
    }
    
    const child = spawn('claude', args, {
      cwd: options.cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });
    
    let output = '';
    let errorOutput = '';
    let sessionId: string | undefined;
    
    // Set timeout
    const timeoutMs = options.timeout || 600000; // 10 minutes default
    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        success: false,
        output,
        exitCode: -1,
        error: `Timeout after ${timeoutMs / 1000}s`
      });
    }, timeoutMs);
    
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      
      if (options.onOutput) {
        options.onOutput(text);
      }
      
      // Try to extract session ID from JSON output
      if (options.outputFormat === 'json' || options.outputFormat === 'stream-json') {
        try {
          const lines = text.split('\n').filter(l => l.trim());
          for (const line of lines) {
            const parsed = JSON.parse(line);
            if (parsed.session_id) {
              sessionId = parsed.session_id;
            }
          }
        } catch {
          // Not JSON or incomplete
        }
      }
    });
    
    child.stderr?.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });
    
    child.on('close', (code) => {
      clearTimeout(timeoutId);
      
      const exitCode = code ?? 0;
      resolve({
        success: exitCode === 0,
        output: output || errorOutput,
        exitCode,
        sessionId,
        error: exitCode !== 0 ? errorOutput || 'Command failed' : undefined
      });
    });
    
    child.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        output: '',
        exitCode: -1,
        error: err.message
      });
    });
  });
}

/**
 * Test Claude Code connection with a simple prompt
 */
export async function testClaudeCodeConnection(): Promise<{
  success: boolean;
  message: string;
  latencyMs?: number;
}> {
  const start = Date.now();
  
  try {
    const result = await runClaudeCode('Say "Hello from Claude Code" and nothing else.', {
      maxTurns: 1,
      timeout: 30000 // 30 second timeout for test
    });
    
    const latencyMs = Date.now() - start;
    
    if (result.success && result.output.toLowerCase().includes('hello')) {
      return {
        success: true,
        message: 'Claude Code connection successful',
        latencyMs
      };
    }
    
    return {
      success: false,
      message: result.error || 'Unexpected response from Claude Code',
      latencyMs
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Connection test failed'
    };
  }
}
