/**
 * Midas Pilot
 * 
 * Local background runner that:
 * 1. Polls the cloud for pending commands
 * 2. Executes Claude Code via CLI
 * 3. Streams output back to cloud
 * 4. Updates task status on completion
 * 
 * Usage: midas pilot [--project <path>] [--auto]
 */

import { spawn, type ChildProcess } from 'child_process';
import { isAuthenticated, getAuthenticatedUser } from './auth.js';
import { sanitizePath } from './security.js';
import { 
  fetchPendingCommands, 
  markCommandRunning, 
  markCommandCompleted,
  getProjectById,
  type PendingCommand 
} from './cloud.js';

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
};

// ============================================================================
// CLAUDE CODE EXECUTION
// ============================================================================

/**
 * Execute a prompt via Claude Code CLI
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
    
    // Add Midas context to system prompt
    args.push(
      '--append-system-prompt',
      `You are being executed by Midas Pilot automation. 
Complete the task efficiently and report results clearly.
If you encounter errors, provide actionable diagnostics.
When done, summarize what was accomplished.`
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
  console.log('  Watching for commands from dashboard...');
  console.log('  Press Ctrl+C to stop\n');
  
  watchRunning = true;
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n  Pilot stopped.\n');
    watchRunning = false;
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
        
        await executeCommand(command);
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

/**
 * CLI handler for: midas pilot "prompt"
 */
export async function runPilotCLI(args: string[]): Promise<void> {
  // Check for watch mode
  if (args.includes('--watch') || args.includes('-w')) {
    const pollInterval = 5000; // Could be made configurable
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
    console.log('');
    console.log('  Options:');
    console.log('    --project <path>  Project directory');
    console.log('    --watch, -w       Watch mode - poll cloud for commands\n');
    console.log('  Examples:');
    console.log('    midas pilot "Fix the failing test in auth.ts"');
    console.log('    midas pilot --watch\n');
    return;
  }
  
  await runPilot(prompt, { projectPath });
}
