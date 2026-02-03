/**
 * Midas Pilot
 * 
 * Local background runner that:
 * 1. Polls the cloud for pending commands
 * 2. Executes Claude Code via CLI
 * 3. Streams output back to cloud
 * 4. Updates task status on completion
 * 
 * Usage: midas pilot [--watch] [--remote] [--project <path>]
 */

import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { isAuthenticated, getAuthenticatedUser, loadAuth } from './auth.js';
import { sanitizePath } from './security.js';
import { 
  fetchPendingCommands, 
  markCommandRunning, 
  markCommandCompleted,
  getProjectById,
  syncProject,
  type PendingCommand 
} from './cloud.js';

// QR code library (dynamic import for ESM compatibility)
type QRCodeModule = { generate: (text: string, opts: { small: boolean }, cb: (qr: string) => void) => void };
let qrcode: QRCodeModule | null = null;

// ============================================================================
// TYPES
// ============================================================================

export interface PilotCommand {
  id: string;
  project_id: string;
  command_type: 'prompt' | 'task' | 'auto_advance';
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  created_at: string;
  started_at?: string;
  completed_at?: string;
  output?: string;
  error?: string;
}

export interface PilotConfig {
  projectPath: string;
  autoMode: boolean;
  maxTurns: number;
  allowedTools: string[];
  pollInterval: number; // ms
  outputFormat: 'text' | 'json' | 'stream-json';
  useStructuredOutput: boolean; // Use --json-schema for deterministic parsing
}

/**
 * JSON Schema for structured pilot execution results
 * Using Claude Code's --json-schema flag for guaranteed valid output
 */
export const PILOT_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    success: { 
      type: 'boolean', 
      description: 'Whether the task was completed successfully' 
    },
    summary: { 
      type: 'string', 
      description: 'Brief summary of what was accomplished' 
    },
    filesChanged: { 
      type: 'array', 
      items: { type: 'string' },
      description: 'List of files that were modified' 
    },
    testsPass: { 
      type: 'boolean', 
      description: 'Whether tests pass after the changes' 
    },
    nextSuggestion: { 
      type: 'string', 
      description: 'Suggested next action from gameplan' 
    },
    errors: { 
      type: 'array', 
      items: { type: 'string' },
      description: 'Any errors encountered' 
    }
  },
  required: ['success', 'summary']
} as const;

export interface StructuredPilotResult {
  success: boolean;
  summary: string;
  filesChanged?: string[];
  testsPass?: boolean;
  nextSuggestion?: string;
  errors?: string[];
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  exitCode: number;
  duration: number;
  sessionId?: string;
}

// Default configuration
const DEFAULT_CONFIG: PilotConfig = {
  projectPath: process.cwd(),
  autoMode: false,
  maxTurns: 10,
  allowedTools: ['Read', 'Edit', 'Bash', 'Grep', 'Glob'],
  pollInterval: 5000,
  outputFormat: 'json',
  useStructuredOutput: true, // Enable structured output by default
};

// ============================================================================
// CLAUDE CODE EXECUTION
// ============================================================================

/**
 * Execute a prompt via Claude Code CLI
 * 
 * Supports structured output via --json-schema for deterministic parsing
 */
export async function executeClaudeCode(
  prompt: string,
  config: Partial<PilotConfig> = {}
): Promise<ExecutionResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  
  return new Promise((resolve) => {
    const args: string[] = [
      '-p', prompt,
      '--output-format', cfg.outputFormat,
      '--max-turns', String(cfg.maxTurns),
    ];
    
    // Add allowed tools
    if (cfg.allowedTools.length > 0) {
      args.push('--allowedTools', cfg.allowedTools.join(','));
    }
    
    // Use structured output schema for deterministic parsing
    if (cfg.useStructuredOutput) {
      args.push('--json-schema', JSON.stringify(PILOT_RESULT_SCHEMA));
    }
    
    // Add Midas context to system prompt
    args.push(
      '--append-system-prompt',
      `You are being executed by Midas Pilot automation.
Complete the task efficiently and report results in the structured format.
If you encounter errors, include them in the errors array.
When done, provide a clear summary and suggest the next action.`
    );
    
    let output = '';
    let stderr = '';
    
    const proc = spawn('claude', args, {
      cwd: cfg.projectPath,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    proc.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });
    
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    
    proc.on('error', (err) => {
      resolve({
        success: false,
        output: `Failed to spawn claude: ${err.message}`,
        exitCode: -1,
        duration: Date.now() - startTime,
      });
    });
    
    proc.on('close', (code) => {
      const duration = Date.now() - startTime;
      const exitCode = code ?? 0;
      
      // Try to parse JSON output for session ID
      let sessionId: string | undefined;
      if (cfg.outputFormat === 'json') {
        try {
          const parsed = JSON.parse(output);
          sessionId = parsed.session_id;
          output = parsed.result || output;
        } catch {
          // Not JSON, use raw output
        }
      }
      
      resolve({
        success: exitCode === 0,
        output: output || stderr,
        exitCode,
        duration,
        sessionId,
      });
    });
  });
}

/**
 * Execute a gameplan task with context
 */
export async function executeTask(
  task: string,
  projectName: string,
  phase: string,
  step: string,
  config: Partial<PilotConfig> = {}
): Promise<ExecutionResult> {
  const prompt = `I'm working on ${projectName}, currently in ${phase} phase (${step} step).

My next task from the gameplan is:
${task}

Please implement this task. Start by analyzing what's needed, then proceed with the implementation.
When complete, summarize what was done.`;

  return executeClaudeCode(prompt, config);
}

// ============================================================================
// PILOT RUNNER
// ============================================================================

export interface PilotStatus {
  running: boolean;
  currentCommand?: PilotCommand;
  lastExecution?: ExecutionResult;
  executedCount: number;
  failedCount: number;
  startedAt?: string;
}

let pilotStatus: PilotStatus = {
  running: false,
  executedCount: 0,
  failedCount: 0,
};

/**
 * Start the Midas Pilot
 * Currently runs a single command for prototyping
 */
export async function runPilot(
  prompt: string,
  config: Partial<PilotConfig> = {}
): Promise<ExecutionResult> {
  if (!isAuthenticated()) {
    return {
      success: false,
      output: 'Not authenticated. Run: midas login',
      exitCode: 1,
      duration: 0,
    };
  }
  
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  console.log('\n  ╔══════════════════════════════════════╗');
  console.log('  ║         MIDAS PILOT ENGAGED          ║');
  console.log('  ╚══════════════════════════════════════╝\n');
  console.log(`  Project: ${cfg.projectPath}`);
  console.log(`  Max turns: ${cfg.maxTurns}`);
  console.log(`  Tools: ${cfg.allowedTools.join(', ')}\n`);
  console.log('  Executing prompt...\n');
  
  pilotStatus.running = true;
  pilotStatus.startedAt = new Date().toISOString();
  
  const result = await executeClaudeCode(prompt, cfg);
  
  pilotStatus.running = false;
  pilotStatus.lastExecution = result;
  
  if (result.success) {
    pilotStatus.executedCount++;
    console.log('  ✓ Execution complete\n');
    console.log(`  Duration: ${(result.duration / 1000).toFixed(1)}s`);
    if (result.sessionId) {
      console.log(`  Session: ${result.sessionId}`);
    }
    console.log('\n  --- Output ---\n');
    console.log(result.output);
  } else {
    pilotStatus.failedCount++;
    console.log('  ✗ Execution failed\n');
    console.log(`  Exit code: ${result.exitCode}`);
    console.log(`  Error: ${result.output}\n`);
  }
  
  return result;
}

/**
 * Run a gameplan task via Pilot
 */
export async function runTaskPilot(
  task: string,
  projectPath: string
): Promise<ExecutionResult> {
  const projectName = projectPath.split('/').pop() || 'project';
  
  // TODO: Get actual phase/step from state
  const phase = 'BUILD';
  const step = 'IMPLEMENT';
  
  return runPilot(
    `Task from gameplan: ${task}`,
    { projectPath }
  );
}

/**
 * Get current pilot status
 */
export function getPilotStatus(): PilotStatus {
  return { ...pilotStatus };
}

// ============================================================================
// CLI COMMAND
// ============================================================================

// ============================================================================
// WATCH MODE (polls cloud for pending commands)
// ============================================================================

let watchRunning = false;

/**
 * Run Pilot in watch mode - polls cloud for commands
 * Also displays QR code for mobile control
 */
export async function runWatchMode(pollInterval = 5000): Promise<void> {
  if (!isAuthenticated()) {
    console.log('\n  ✗ Not authenticated. Run: midas login\n');
    return;
  }
  
  // Check for Claude Code
  const checkClaude = spawn('which', ['claude']);
  const hasClaudeCode = await new Promise<boolean>((resolve) => {
    checkClaude.on('close', (code) => resolve(code === 0));
  });
  
  if (!hasClaudeCode) {
    console.log('\n  ✗ Claude Code CLI not found');
    console.log('    Install from: https://claude.ai/code\n');
    return;
  }
  
  console.log('\n  ╔══════════════════════════════════════╗');
  console.log('  ║       MIDAS PILOT - WATCH MODE       ║');
  console.log('  ╚══════════════════════════════════════╝\n');
  
  // Auto-sync on startup so dashboard has latest state
  console.log('  Syncing project state...');
  const syncResult = await syncProject(process.cwd());
  if (syncResult.success) {
    console.log('  ✓ Synced to dashboard\n');
  } else {
    console.log(`  ⚠ Sync skipped: ${syncResult.error}\n`);
  }
  
  // Create remote session and show QR code for mobile control
  const session = generateRemoteSession();
  const registered = await registerRemoteSession(session);
  
  if (registered) {
    const remoteUrl = `${DASHBOARD_URL}/pilot/${session.sessionId}?token=${session.sessionToken}`;
    console.log('  📱 Scan to control from phone:\n');
    await displayQRCode(remoteUrl);
    console.log(`\n  ${remoteUrl}\n`);
    
    // Update session status to idle
    await updateRemoteSession(session.sessionId, { status: 'idle' });
  } else {
    console.log('  (Mobile control unavailable - could not register session)\n');
  }
  
  console.log('  Watching for commands from dashboard...');
  console.log('  Press Ctrl+C to stop\n');
  
  watchRunning = true;
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n  Pilot stopped.\n');
    watchRunning = false;
    if (registered) {
      await updateRemoteSession(session.sessionId, { status: 'disconnected' });
    }
    process.exit(0);
  });
  
  while (watchRunning) {
    try {
      const commands = await fetchPendingCommands();
      
      if (commands.length > 0) {
        const command = commands[0]; // Process one at a time
        console.log(`\n  ▸ Received command #${command.id}`);
        console.log(`    Type: ${command.command_type}`);
        console.log(`    Prompt: ${command.prompt.slice(0, 60)}...`);
        
        // Update remote session status
        if (registered) {
          await updateRemoteSession(session.sessionId, {
            status: 'running',
            current_task: command.prompt.slice(0, 100),
          });
        }
        
        await executeCommand(command);
        
        // Update remote session back to idle
        if (registered) {
          await updateRemoteSession(session.sessionId, {
            status: 'idle',
            current_task: undefined,
          });
        }
      }
    } catch (err) {
      // Network error, wait and retry
      console.log(`  ⚠ Poll error: ${err instanceof Error ? err.message : 'unknown'}`);
    }
    
    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}

/**
 * Execute a pending command from the cloud
 */
async function executeCommand(command: PendingCommand): Promise<void> {
  // Get project details
  const project = await getProjectById(command.project_id);
  if (!project) {
    console.log(`  ✗ Project not found: ${command.project_id}`);
    return;
  }
  
  console.log(`    Project: ${project.name}`);
  console.log(`    Path: ${project.local_path}\n`);
  
  // Mark as running
  await markCommandRunning(command.id);
  
  // Execute
  const result = await executeClaudeCode(command.prompt, {
    projectPath: project.local_path,
    maxTurns: command.max_turns,
  });
  
  // Update status
  await markCommandCompleted(command.id, {
    success: result.success,
    output: result.output,
    exitCode: result.exitCode,
    durationMs: result.duration,
    sessionId: result.sessionId,
  });
  
  if (result.success) {
    console.log(`  ✓ Command #${command.id} completed`);
    console.log(`    Duration: ${(result.duration / 1000).toFixed(1)}s`);
  } else {
    console.log(`  ✗ Command #${command.id} failed`);
    console.log(`    Exit code: ${result.exitCode}`);
  }
  
  console.log('\n  Waiting for next command...');
}

// ============================================================================
// REMOTE MODE (QR code for phone control)
// ============================================================================

const DASHBOARD_URL = process.env.MIDAS_DASHBOARD_URL || 'https://dashboard.midasmcp.com';

interface RemoteSession {
  sessionId: string;
  sessionToken: string;
  expiresAt: Date;
}

/**
 * Generate a new remote session
 */
function generateRemoteSession(): RemoteSession {
  const sessionId = randomBytes(8).toString('hex');
  const sessionToken = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  
  return { sessionId, sessionToken, expiresAt };
}

/**
 * Register session with the cloud
 */
async function registerRemoteSession(session: RemoteSession): Promise<boolean> {
  const auth = loadAuth();
  if (!auth.githubUserId || !auth.githubAccessToken) {
    console.log('  ⚠ Missing auth credentials');
    return false;
  }
  
  try {
    const response = await fetch(`${DASHBOARD_URL}/api/pilot-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session_id: session.sessionId,
        session_token: session.sessionToken,
        github_user_id: auth.githubUserId,
        github_access_token: auth.githubAccessToken,
        expires_at: session.expiresAt.toISOString(),
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.log(`  ⚠ Session registration failed: ${response.status}`);
      console.log(`    ${(errorData as { error?: string }).error || 'Unknown error'}`);
    }
    
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Update session status in cloud
 */
async function updateRemoteSession(
  sessionId: string,
  updates: {
    status?: string;
    current_project?: string;
    current_task?: string;
    last_output?: string;
    output_lines?: number;
  }
): Promise<void> {
  const auth = loadAuth();
  if (!auth.githubAccessToken) return;
  
  try {
    await fetch(`${DASHBOARD_URL}/api/pilot-session/${sessionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.githubAccessToken}`,
      },
      body: JSON.stringify(updates),
    });
  } catch {
    // Ignore update errors
  }
}

/**
 * Display QR code for remote connection
 */
async function displayQRCode(url: string): Promise<void> {
  // Load qrcode-terminal dynamically
  if (!qrcode) {
    try {
      const mod = await import('qrcode-terminal');
      // Handle both ESM default export and CommonJS module.exports
      qrcode = (mod.default || mod) as QRCodeModule;
    } catch {
      console.log(`\n  QR code library not available.`);
      console.log(`  Open this URL on your phone:\n`);
      console.log(`  ${url}\n`);
      return;
    }
  }
  
  return new Promise((resolve) => {
    qrcode!.generate(url, { small: true }, (qr: string) => {
      const indented = qr.split('\n').map(line => '  ' + line).join('\n');
      console.log(indented);
      console.log(`\n  ${url}\n`);
      resolve();
    });
  });
}

/**
 * Run Pilot in remote mode - shows QR code for phone control
 */
export async function runRemoteMode(pollInterval = 3000): Promise<void> {
  if (!isAuthenticated()) {
    console.log('\n  ✗ Not authenticated. Run: midas login\n');
    return;
  }
  
  const user = getAuthenticatedUser();
  if (!user) {
    console.log('\n  ✗ User info not available\n');
    return;
  }
  
  // Check for Claude Code
  const checkClaude = spawn('which', ['claude']);
  const hasClaudeCode = await new Promise<boolean>((resolve) => {
    checkClaude.on('close', (code) => resolve(code === 0));
  });
  
  if (!hasClaudeCode) {
    console.log('\n  ✗ Claude Code CLI not found');
    console.log('    Install from: https://claude.ai/code\n');
    return;
  }
  
  // Generate session
  const session = generateRemoteSession();
  const connectionUrl = `${DASHBOARD_URL}/pilot/${session.sessionId}?token=${session.sessionToken}`;
  
  // Clear screen and hide cursor to prevent TUI interference
  process.stdout.write('\x1b[2J\x1b[H\x1b[?25l'); // Clear + home + hide cursor
  
  console.log('\n  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║              MIDAS PILOT - REMOTE MODE                   ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝\n');
  
  // Auto-sync on startup so dashboard has latest state
  console.log('  Syncing project state...');
  const syncResult = await syncProject(process.cwd());
  if (syncResult.success) {
    console.log('  ✓ Synced to dashboard');
  } else {
    console.log(`  ⚠ Sync skipped: ${syncResult.error}`);
  }
  
  // Register session with cloud
  console.log('  Registering session...');
  const registered = await registerRemoteSession(session);
  
  if (!registered) {
    console.log('\n  ✗ Failed to register session');
    console.log('    Check your internet connection\n');
    process.stdout.write('\x1b[?25h'); // Show cursor
    return;
  }
  
  console.log('  ✓ Session registered\n');
  console.log('  ╭─────────────────────────────────────────────────────────╮');
  console.log('  │  📱 SCAN WITH YOUR PHONE                                │');
  console.log('  ╰─────────────────────────────────────────────────────────╯\n');
  
  await displayQRCode(connectionUrl);
  
  console.log('');
  console.log(`  URL: ${connectionUrl}`);
  console.log('');
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('');
  console.log('  ⚡ Keep this terminal open - commands execute here');
  console.log('  ⏰ Session expires in 60 minutes');
  console.log('  🛑 Press Ctrl+C to stop');
  console.log('');
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('');
  console.log('  Waiting for commands from your phone...');
  console.log('');
  
  watchRunning = true;
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    process.stdout.write('\x1b[?25h'); // Restore cursor
    console.log('\n\n  Closing session...');
    await updateRemoteSession(session.sessionId, { status: 'disconnected' });
    console.log('  Pilot stopped.\n');
    watchRunning = false;
    process.exit(0);
  });
  
  // Update status to connected
  await updateRemoteSession(session.sessionId, { status: 'connected' });
  
  // Heartbeat loop
  let lastHeartbeat = Date.now();
  
  while (watchRunning) {
    try {
      // Check if session expired
      if (new Date() > session.expiresAt) {
        console.log('\n  Session expired. Start a new one with: midas pilot --remote\n');
        break;
      }
      
      // Send heartbeat every 30 seconds
      if (Date.now() - lastHeartbeat > 30000) {
        await updateRemoteSession(session.sessionId, { status: 'idle' });
        lastHeartbeat = Date.now();
      }
      
      // Poll for commands
      const commands = await fetchPendingCommands();
      
      if (commands.length > 0) {
        const command = commands[0];
        console.log(`  ▸ Received command #${command.id}`);
        console.log(`    ${command.prompt.slice(0, 60)}...`);
        
        // Update session status
        await updateRemoteSession(session.sessionId, {
          status: 'running',
          current_task: command.prompt.slice(0, 100),
        });
        
        // Execute command (reusing existing function)
        await executeCommandWithUpdates(command, session.sessionId);
        
        // Back to idle
        await updateRemoteSession(session.sessionId, {
          status: 'idle',
          current_task: undefined,
        });
      }
    } catch (err) {
      // Network error, continue
    }
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}

/**
 * Execute command with real-time session updates
 */
async function executeCommandWithUpdates(command: PendingCommand, sessionId: string): Promise<void> {
  const project = await getProjectById(command.project_id);
  if (!project) {
    console.log(`  ✗ Project not found: ${command.project_id}`);
    return;
  }
  
  console.log(`    Project: ${project.name}`);
  
  await markCommandRunning(command.id);
  
  const result = await executeClaudeCode(command.prompt, {
    projectPath: project.local_path,
    maxTurns: command.max_turns,
  });
  
  // Update session with output
  await updateRemoteSession(sessionId, {
    last_output: result.output.slice(-5000), // Last 5KB
    output_lines: result.output.split('\n').length,
  });
  
  await markCommandCompleted(command.id, {
    success: result.success,
    output: result.output,
    exitCode: result.exitCode,
    durationMs: result.duration,
    sessionId: result.sessionId,
  });
  
  if (result.success) {
    console.log(`  ✓ Complete (${(result.duration / 1000).toFixed(1)}s)\n`);
  } else {
    console.log(`  ✗ Failed (exit ${result.exitCode})\n`);
  }
}

/**
 * CLI handler for: midas pilot "prompt"
 */
export async function runPilotCLI(args: string[]): Promise<void> {
  // Check for remote mode
  if (args.includes('--remote') || args.includes('-r')) {
    const pollInterval = 3000;
    await runRemoteMode(pollInterval);
    return;
  }
  
  // Check for watch mode
  if (args.includes('--watch') || args.includes('-w')) {
    const pollInterval = 5000;
    await runWatchMode(pollInterval);
    return;
  }
  
  // Check for Claude Code
  const checkClaude = spawn('which', ['claude']);
  const hasClaudeCode = await new Promise<boolean>((resolve) => {
    checkClaude.on('close', (code) => resolve(code === 0));
  });
  
  if (!hasClaudeCode) {
    console.log('\n  ✗ Claude Code CLI not found');
    console.log('    Install from: https://claude.ai/code\n');
    return;
  }
  
  // Parse arguments
  let prompt = '';
  let projectPath = process.cwd();
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) {
      projectPath = sanitizePath(args[i + 1]);
      i++;
    } else if (!args[i].startsWith('--')) {
      prompt = args[i];
    }
  }
  
  if (!prompt) {
    console.log('\n  Usage: midas pilot "your prompt here"');
    console.log('         midas pilot --watch');
    console.log('         midas pilot --remote');
    console.log('');
    console.log('  Options:');
    console.log('    --project <path>  Project directory');
    console.log('    --watch, -w       Watch mode - poll cloud for commands');
    console.log('    --remote, -r      Remote mode - show QR code for phone control\n');
    console.log('  Examples:');
    console.log('    midas pilot "Fix the failing test in auth.ts"');
    console.log('    midas pilot --watch');
    console.log('    midas pilot --remote\n');
    return;
  }
  
  await runPilot(prompt, { projectPath });
}
