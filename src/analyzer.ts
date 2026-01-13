import { getApiKey } from './config.js';
import { getRecentConversationIds, getConversation } from './cursor.js';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import type { Phase, EagleSightStep, BuildStep, ShipStep, GrowStep } from './state/phase.js';

async function callClaude(prompt: string, systemPrompt: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No API key');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json() as { content: Array<{ text: string }> };
  return data.content[0]?.text || '';
}

function scanFiles(dir: string, maxFiles = 30): string[] {
  const files: string[] = [];
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.swift', '.go', '.rs', '.md'];
  const ignore = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__'];

  function scan(d: string, depth = 0): void {
    if (depth > 3 || files.length >= maxFiles) return;
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (files.length >= maxFiles) break;
        if (entry.name.startsWith('.') || ignore.includes(entry.name)) continue;
        const path = join(d, entry.name);
        if (entry.isDirectory()) scan(path, depth + 1);
        else if (extensions.includes(extname(entry.name))) files.push(path);
      }
    } catch {}
  }
  scan(dir);
  return files;
}

function readFile(path: string, maxLines = 30): string {
  try {
    return readFileSync(path, 'utf-8').split('\n').slice(0, maxLines).join('\n');
  } catch {
    return '';
  }
}

function getRecentChatHistory(limit = 30): string {
  const ids = getRecentConversationIds(3);
  const messages: string[] = [];
  
  for (const id of ids) {
    const conv = getConversation(id);
    if (!conv) continue;
    
    for (const msg of conv.messages.slice(-15)) {
      const role = msg.type === 'user' ? 'USER' : 'ASSISTANT';
      const text = msg.text.slice(0, 500);
      messages.push(`${role}: ${text}`);
      if (messages.length >= limit) break;
    }
    if (messages.length >= limit) break;
  }
  
  return messages.join('\n\n');
}

export interface ProjectAnalysis {
  currentPhase: Phase;
  summary: string;
  whatsDone: string[];
  whatsNext: string;
  suggestedPrompt: string;
  confidence: number;
  techStack: string[];
}

export async function analyzeProject(projectPath: string): Promise<ProjectAnalysis> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      currentPhase: { phase: 'IDLE' },
      summary: 'No API key - cannot analyze',
      whatsDone: [],
      whatsNext: 'Add API key to ~/.midas/config.json',
      suggestedPrompt: '',
      confidence: 0,
      techStack: [],
    };
  }

  // Gather context
  const files = scanFiles(projectPath);
  const fileList = files.map(f => f.replace(projectPath + '/', '')).join('\n');
  
  // Check for Eagle Sight docs
  const hasbrainlift = existsSync(join(projectPath, 'docs', 'brainlift.md'));
  const hasPrd = existsSync(join(projectPath, 'docs', 'prd.md'));
  const hasGameplan = existsSync(join(projectPath, 'docs', 'gameplan.md'));
  
  const brainliftContent = hasbrainlift ? readFile(join(projectPath, 'docs', 'brainlift.md')) : '';
  const prdContent = hasPrd ? readFile(join(projectPath, 'docs', 'prd.md')) : '';
  const gameplanContent = hasGameplan ? readFile(join(projectPath, 'docs', 'gameplan.md')) : '';
  
  // Check for deployment/monitoring
  const hasDockerfile = existsSync(join(projectPath, 'Dockerfile')) || existsSync(join(projectPath, 'docker-compose.yml'));
  const hasCI = existsSync(join(projectPath, '.github', 'workflows'));
  const hasTests = files.some(f => f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__'));
  
  // Get chat history
  const chatHistory = getRecentChatHistory();
  
  // Sample some code files
  const codeSamples = files.slice(0, 5).map(f => {
    const content = readFile(f, 20);
    return `--- ${f.replace(projectPath + '/', '')} ---\n${content}`;
  }).join('\n\n');

  const prompt = `Analyze this project and determine where the developer is in the product lifecycle.

## Project Files (${files.length} total):
${fileList}

## Eagle Sight Docs:
- brainlift.md: ${hasbrainlift ? 'exists' : 'missing'}
${brainliftContent ? `Preview:\n${brainliftContent.slice(0, 400)}` : ''}

- prd.md: ${hasPrd ? 'exists' : 'missing'}
${prdContent ? `Preview:\n${prdContent.slice(0, 400)}` : ''}

- gameplan.md: ${hasGameplan ? 'exists' : 'missing'}
${gameplanContent ? `Preview:\n${gameplanContent.slice(0, 400)}` : ''}

## Infrastructure:
- Tests: ${hasTests ? 'yes' : 'no'}
- Dockerfile/compose: ${hasDockerfile ? 'yes' : 'no'}
- CI/CD (.github/workflows): ${hasCI ? 'yes' : 'no'}

## Recent Chat History:
${chatHistory || 'No recent chat history'}

## Code Samples:
${codeSamples || 'No code files yet'}

## The 4 Phases with Steps:

EAGLE_SIGHT (Planning):
- IDEA: Define core idea, problem, audience
- RESEARCH: Landscape scan, competitors
- BRAINLIFT: Document unique insights
- PRD: Write requirements
- GAMEPLAN: Plan the build

BUILD (Development - the 7-step cycle):
- RULES: Read .cursorrules, understand constraints
- INDEX: Index codebase structure, architecture
- READ: Read specific implementation files
- RESEARCH: Look up docs, APIs, best practices
- IMPLEMENT: Write code with tests
- TEST: Run tests, fix failures
- DEBUG: Tornado cycle (research + logs + tests)

SHIP (Deployment):
- REVIEW: Code review, security audit
- DEPLOY: CI/CD, production deploy
- MONITOR: Logs, alerts, health checks

GROW (Iteration):
- FEEDBACK: Collect user feedback
- ANALYZE: Study metrics and behavior
- ITERATE: Plan next cycle (back to EAGLE_SIGHT)

Based on all evidence, determine:
1. Current phase and step
2. What's completed
3. What's next
4. Specific prompt for Cursor

Respond ONLY with valid JSON:
{
  "phase": "EAGLE_SIGHT" | "BUILD" | "SHIP" | "GROW" | "IDLE",
  "step": "step name",
  "summary": "one-line project summary",
  "techStack": ["tech1", "tech2"],
  "whatsDone": ["done1", "done2"],
  "whatsNext": "specific next action",
  "suggestedPrompt": "exact prompt to paste in Cursor",
  "confidence": 0-100
}`;

  try {
    const response = await callClaude(prompt, 
      'You are Midas, an elite vibecoding coach. Analyze projects and determine their exact phase in the development lifecycle. Be specific and actionable. Respond only with valid JSON.'
    );
    
    // Parse JSON from response
    let jsonStr = response;
    if (response.includes('```')) {
      const match = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1];
    }
    
    const data = JSON.parse(jsonStr.trim());
    
    // Convert to Phase type
    let currentPhase: Phase;
    if (data.phase === 'IDLE' || !data.phase) {
      currentPhase = { phase: 'IDLE' };
    } else if (data.phase === 'EAGLE_SIGHT') {
      currentPhase = { phase: 'EAGLE_SIGHT', step: data.step as EagleSightStep };
    } else if (data.phase === 'BUILD') {
      currentPhase = { phase: 'BUILD', step: data.step as BuildStep };
    } else if (data.phase === 'SHIP') {
      currentPhase = { phase: 'SHIP', step: data.step as ShipStep };
    } else if (data.phase === 'GROW') {
      currentPhase = { phase: 'GROW', step: data.step as GrowStep };
    } else {
      currentPhase = { phase: 'IDLE' };
    }
    
    return {
      currentPhase,
      summary: data.summary || 'Project analyzed',
      whatsDone: data.whatsDone || [],
      whatsNext: data.whatsNext || 'Continue development',
      suggestedPrompt: data.suggestedPrompt || '',
      confidence: data.confidence || 50,
      techStack: data.techStack || [],
    };
  } catch (error) {
    return {
      currentPhase: { phase: 'IDLE' },
      summary: 'Analysis failed',
      whatsDone: [],
      whatsNext: 'Try again or check API key',
      suggestedPrompt: '',
      confidence: 0,
      techStack: [],
    };
  }
}
