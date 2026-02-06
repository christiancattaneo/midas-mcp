/**
 * Midas Pilot
 * 
 * Local background runner that:
 * 1. Polls the cloud for pending commands
 * 2. Executes Claude Code via CLI
 * 3. Streams output back to cloud
 * 4. Updates task status on completion
 * 
 * Usage: midas pilot [--project <path>]
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
import { loadTracker, getSmartPromptSuggestion, getGatesStatus } from './tracker.js';
import { loadState, PHASE_INFO } from './state/phase.js';
import { getGameplanProgress } from './gameplan-tracker.js';
import { analyzeProjectStreaming, type ProjectAnalysis, type AnalysisProgress } from './analyzer.js';

// QR code removed - dashboard handles remote control now

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
  config: Partial<PilotConfig> = {},
  onOutput?: (chunk: string, fullOutput: string) => void
): Promise<ExecutionResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  
  return new Promise((resolve) => {
    const args: string[] = [
      '-p', prompt,
      '--output-format', cfg.outputFormat,
    ];
    
    // Add allowed tools
    if (cfg.allowedTools.length > 0) {
      args.push('--allowedTools', cfg.allowedTools.join(','));
    }
    
    // Add Midas context to system prompt
    args.push(
      '--append-system-prompt',
      `You are being executed by Midas Pilot automation. Complete the task efficiently.`
    );
    
    let output = '';
    let stderr = '';
    
    const proc = spawn('claude', args, {
      cwd: cfg.projectPath,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    proc.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      if (onOutput) onOutput(chunk, output);
    });
    
    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      if (onOutput) onOutput(chunk, output + stderr);
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

/**
 * Execute a pending command from the cloud
 */
async function executeCommand(command: PendingCommand): Promise<void> {
  try {
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
  } catch (error) {
    console.error(`  ✗ Error executing command #${command.id}:`, error);
    try {
      await markCommandCompleted(command.id, {
        success: false,
        output: error instanceof Error ? error.message : String(error),
        exitCode: -1,
        durationMs: 0,
      });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ============================================================================
// WATCH MODE - sync and watch for dashboard commands
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

// QR code display removed - dashboard handles remote control

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
  
  const projectPath = process.cwd();
  
  // =========================================================================
  // STEP 0: Kill any existing pilot processes
  // =========================================================================
  try {
    // Find and kill other midas pilot processes (but not this one)
    const myPid = process.pid;
    const { execSync } = await import('child_process');
    const pids = execSync('pgrep -f "midas.*pilot" 2>/dev/null || true', { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(p => p && parseInt(p) !== myPid);
    
    for (const pid of pids) {
      try {
        process.kill(parseInt(pid), 'SIGTERM');
      } catch { /* already dead */ }
    }
    if (pids.length > 0) {
      console.log(`  Killed ${pids.length} existing pilot process(es)`);
    }
  } catch { /* ignore errors */ }
  
  // Clear screen and hide cursor
  process.stdout.write('\x1b[2J\x1b[H\x1b[?25l');
  
  console.log('\n  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║                   MIDAS WATCH MODE                       ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝\n');
  
  // =========================================================================
  // STEP 1: Full AI Analysis with TUI-style colorful progress
  // =========================================================================
  
  // ANSI colors
  const reset = '\x1b[0m';
  const bold = '\x1b[1m';
  const dim = '\x1b[2m';
  const green = '\x1b[32m';
  const yellow = '\x1b[33m';
  const cyan = '\x1b[36m';
  const magenta = '\x1b[35m';
  
  const spinners = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const stages = ['gathering', 'connecting', 'thinking', 'streaming', 'parsing'];
  const stageLabels = [
    'Read files and context',
    'Connect to AI', 
    'Extended thinking',
    'Receive response',
    'Parse results',
  ];
  
  let currentProgress: AnalysisProgress | null = null;
  let analysisStartTime = Date.now();
  
  // Render the colorful analysis box
  const renderAnalysisUI = () => {
    const elapsed = `${((Date.now() - analysisStartTime) / 1000).toFixed(1)}s`;
    const spinnerFrame = spinners[Math.floor(Date.now() / 100) % spinners.length];
    const currentIdx = currentProgress ? stages.indexOf(currentProgress.stage) : 0;
    
    // Stage indicator function
    const stageCheck = (idx: number) => {
      if (idx < currentIdx) return `${green}[✓]${reset}`;
      if (idx === currentIdx) return `${yellow}[${spinnerFrame}]${reset}`;
      return `${dim}[ ]${reset}`;
    };
    
    // Build the display
    let output = '\x1b[2J\x1b[H'; // Clear screen + home
    output += '\n  ╔══════════════════════════════════════════════════════════╗\n';
    output += '  ║                   MIDAS WATCH MODE                       ║\n';
    output += '  ╚══════════════════════════════════════════════════════════╝\n\n';
    
    output += `  ${bold}Analyzing project${reset} ${dim}${elapsed}${reset}\n\n`;
    
    // Progress stages with checkmarks
    for (let i = 0; i < stages.length; i++) {
      output += `  ${stageCheck(i)} ${stageLabels[i]}\n`;
    }
    output += '\n';
    
    // Show streaming details
    if (currentProgress?.stage === 'streaming' && currentProgress.tokensReceived) {
      output += `  ${dim}${currentProgress.tokensReceived} tokens received${reset}\n`;
      
      // Try to show partial results
      if (currentProgress.partialContent) {
        const phaseMatch = currentProgress.partialContent.match(/"phase"\s*:\s*"([^"]+)"/);
        const techMatch = currentProgress.partialContent.match(/"techStack"\s*:\s*\[([^\]]{5,50})/);
        
        if (phaseMatch) {
          output += `  ${green}→${reset} Phase: ${bold}${phaseMatch[1]}${reset}\n`;
        }
        if (techMatch) {
          const techs = techMatch[1].replace(/"/g, '').split(',').slice(0, 3).join(', ');
          output += `  ${green}→${reset} Tech: ${techs}\n`;
        }
      }
    } else if (currentProgress?.stage === 'thinking') {
      output += `  ${dim}AI is reasoning about your project...${reset}\n`;
    } else if (currentProgress?.stage === 'gathering') {
      output += `  ${dim}Reading codebase, docs, journal...${reset}\n`;
    }
    
    process.stdout.write(output);
  };
  
  // Start progress interval for smooth animation
  const progressInterval = setInterval(renderAnalysisUI, 100);
  renderAnalysisUI(); // Initial render
  
  let analysis: ProjectAnalysis | null = null;
  try {
    analysis = await analyzeProjectStreaming(projectPath, (progress) => {
      currentProgress = progress;
    });
    clearInterval(progressInterval);
    console.log(`\n  ${green}✓${reset} Analysis complete\n`);
  } catch (err) {
    clearInterval(progressInterval);
    console.log(`\n  ${yellow}⚠${reset} AI analysis failed, using local state\n`);
  }
  
  // Load supplementary state
  const gatesStatus = getGatesStatus(projectPath);
  const gameplan = getGameplanProgress(projectPath);
  
  // Clear and redraw with colorful project info
  process.stdout.write('\x1b[2J\x1b[H');
  
  console.log('\n  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║                   MIDAS WATCH MODE                       ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝\n');
  
  // Display current state with colors
  const phase = analysis?.currentPhase || loadState(projectPath).current;
  const phaseName = phase.phase === 'IDLE' ? 'Not started' : PHASE_INFO[phase.phase]?.name || phase.phase;
  const stepName = 'step' in phase ? phase.step : '';
  
  const phaseColors: Record<string, string> = { PLAN: yellow, BUILD: '\x1b[34m', SHIP: green, GROW: magenta };
  const phaseColor = phaseColors[phase.phase] || '';
  
  console.log(`  ${green}✓${reset} Project: ${bold}${projectPath.split('/').pop()}${reset}`);
  console.log(`  ${green}✓${reset} Phase: ${phaseColor}${bold}${phaseName}${reset}${stepName ? ` ${dim}→${reset} ${stepName}` : ''}`);
  
  // Show tech stack
  if (analysis?.techStack && analysis.techStack.length > 0) {
    console.log(`  ${green}✓${reset} Stack: ${cyan}${analysis.techStack.slice(0, 4).join(', ')}${reset}`);
  }
  
  // Show gates status
  if (gatesStatus.allPass) {
    console.log(`  ${green}✓${reset} Gates: ${green}All passing${reset}`);
  } else if (gatesStatus.failing.length > 0) {
    console.log(`  ${yellow}⚠${reset} Gates failing: ${yellow}${gatesStatus.failing.join(', ')}${reset}`);
  }
  
  // Show gameplan progress
  if (gameplan.documented > 0 || gameplan.actual > 0) {
    const pct = gameplan.actual;
    const pctColor = pct >= 75 ? green : pct >= 40 ? yellow : dim;
    console.log(`  ${green}✓${reset} Progress: ${pctColor}${pct}%${reset} complete`);
  }
  
  // Show AI summary in a box
  if (analysis?.summary) {
    console.log('');
    console.log(`  ${cyan}┌───────────────────────────────────────────────────────┐${reset}`);
    console.log(`  ${cyan}│${reset}  ${bold}AI ANALYSIS${reset}                                        ${cyan}│${reset}`);
    console.log(`  ${cyan}└───────────────────────────────────────────────────────┘${reset}`);
    // Word wrap the summary
    const summaryWords = analysis.summary.split(' ');
    let line = '  ';
    for (const word of summaryWords) {
      if ((line + word).length > 58) {
        console.log(`  ${dim}${line.trim()}${reset}`);
        line = word + ' ';
      } else {
        line += word + ' ';
      }
    }
    if (line.trim()) console.log(`  ${dim}${line.trim()}${reset}`);
  }
  
  // Show the suggested prompt prominently in gold
  console.log('');
  console.log(`  ${yellow}╔═══════════════════════════════════════════════════════╗${reset}`);
  console.log(`  ${yellow}║${reset}  ${bold}${yellow}SUGGESTED PROMPT${reset} ${dim}(synced to dashboard)${reset}              ${yellow}║${reset}`);
  console.log(`  ${yellow}╚═══════════════════════════════════════════════════════╝${reset}`);
  
  const suggestedPrompt = analysis?.suggestedPrompt || getSmartPromptSuggestion(projectPath).prompt;
  // Word wrap the prompt
  const promptWords = suggestedPrompt.split(' ');
  let promptLine = '';
  for (const word of promptWords) {
    if ((promptLine + word).length > 55) {
      console.log(`  ${promptLine.trim()}`);
      promptLine = word + ' ';
    } else {
      promptLine += word + ' ';
    }
  }
  if (promptLine.trim()) console.log(`  ${promptLine.trim()}`);
  console.log('');
  
  // =========================================================================
  // STEP 2: Sync to cloud (with full AI analysis)
  // =========================================================================
  console.log('  Syncing to dashboard...');
  const syncResult = await syncProject(projectPath, analysis ? {
    summary: analysis.summary,
    suggestedPrompt: analysis.suggestedPrompt,
    whatsNext: analysis.whatsNext,
    whatsDone: analysis.whatsDone,
    confidence: analysis.confidence,
    techStack: analysis.techStack,
  } : undefined);
  if (syncResult.success) {
    console.log('  ✓ Synced to dashboard (with AI prompt)');
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
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('');
  console.log(`  ${green}⚡ WATCHER READY${reset}`);
  console.log('');
  console.log('  Open dashboard to send commands:');
  console.log(`  ${cyan}${DASHBOARD_URL}/dashboard${reset}`);
  console.log('');
  console.log('  ⏰ Session expires in 60 minutes');
  console.log('  🛑 Press Ctrl+C to stop');
  console.log('');
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('');
  console.log('  Waiting for commands...');
  console.log('');
  
  let running = true;
  
  // Handle graceful shutdown - cleanup on any termination signal
  const cleanup = async (signal: string) => {
    if (!running) return; // Prevent double cleanup
    running = false;
    process.stdout.write('\x1b[?25h'); // Restore cursor
    console.log(`\n\n  Closing session (${signal})...`);
    try {
      await updateRemoteSession(session.sessionId, { status: 'disconnected' });
      console.log('  Pilot stopped.\n');
    } catch {
      console.log('  Pilot stopped (offline).\n');
    }
    process.exit(0);
  };
  
  process.on('SIGINT', () => cleanup('SIGINT'));
  process.on('SIGTERM', () => cleanup('SIGTERM'));
  process.on('SIGHUP', () => cleanup('SIGHUP'));
  
  // Also handle uncaught errors to cleanup session
  process.on('uncaughtException', async (err) => {
    console.error('\n  Unexpected error:', err.message);
    await cleanup('error');
  });
  
  // Update status to connected
  await updateRemoteSession(session.sessionId, { status: 'connected' });
  
  // Heartbeat loop
  let lastHeartbeat = Date.now();
  
  while (running) {
    try {
      // Check if session expired
      if (new Date() > session.expiresAt) {
        console.log('\n  Session expired. Restart with: midas watch\n');
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
  try {
    const project = await getProjectById(command.project_id);
    if (!project) {
      console.log(`  ✗ Project not found: ${command.project_id}`);
      return;
    }
    
    console.log(`    Project: ${project.name}`);
    
    await markCommandRunning(command.id);
    
    // Stream output to cloud every 2 seconds for live dashboard view
    let lastUpdateTime = 0;
    const OUTPUT_UPDATE_INTERVAL = 2000; // 2s between cloud updates
    
    const result = await executeClaudeCode(command.prompt, {
      projectPath: project.local_path,
      maxTurns: command.max_turns,
    }, (_chunk, fullOutput) => {
      // Throttle cloud updates to avoid rate limiting
      const now = Date.now();
      if (now - lastUpdateTime > OUTPUT_UPDATE_INTERVAL) {
        lastUpdateTime = now;
        // Fire-and-forget - don't await to avoid blocking stdout
        updateRemoteSession(sessionId, {
          last_output: fullOutput.slice(-5000), // Last 5KB
          output_lines: fullOutput.split('\n').length,
        }).catch(() => {});
      }
    });
    
    // Final output update
    await updateRemoteSession(sessionId, {
      last_output: result.output.slice(-5000),
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
      console.log(`  ✗ Failed (exit ${result.exitCode})`);
      if (result.output) {
        const errorLines = result.output.split('\n').slice(-5).join('\n');
        console.log(`    Last output: ${errorLines.slice(0, 200)}`);
      }
      console.log('');
    }
  } catch (error) {
    console.error(`  ✗ Error executing command #${command.id}:`, error);
    try {
      await markCommandCompleted(command.id, {
        success: false,
        output: error instanceof Error ? error.message : String(error),
        exitCode: -1,
        durationMs: 0,
      });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * CLI handler for: midas pilot ["prompt"]
 * 
 * With no args or with --remote/-r/--watch/-w: starts remote mode with QR code
 * With a prompt string: executes that prompt directly via Claude Code
 */
export async function runPilotCLI(args: string[]): Promise<void> {
  // Check for remote/watch mode flags or no prompt
  const hasRemoteFlag = args.includes('--remote') || args.includes('-r') || args.includes('--watch') || args.includes('-w');
  const promptArg = args.find(a => !a.startsWith('--') && a !== '-r' && a !== '-w');
  
  // Default: start remote mode (sync, show QR, poll for commands)
  if (hasRemoteFlag || !promptArg) {
    await runRemoteMode(3000);
    return;
  }
  
  // Direct prompt mode: execute a single prompt via Claude Code
  const prompt = promptArg;
  let projectPath = process.cwd();
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) {
      projectPath = sanitizePath(args[i + 1]);
      i++;
    }
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
  
  await runPilot(prompt, { projectPath });
}
