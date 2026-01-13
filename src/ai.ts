import { getApiKey } from './config.js';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';

// Claude 4.5 Opus with extended thinking for deep analysis
async function callClaude(prompt: string, systemPrompt?: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No API key configured');
  }

  const maxTokens = 16000;
  const thinkingBudget = 10000;

  // Add timeout protection (60 seconds)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-20250514',
        max_tokens: maxTokens,
        thinking: {
          type: 'enabled',
          budget_tokens: thinkingBudget,
        },
        system: systemPrompt || 'You are Midas, a Golden Code coach. Be concise and actionable.',
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} - ${error}`);
  }

  // Extended thinking response has thinking blocks + text blocks
  const data = await response.json() as { 
    content: Array<{ type: string; text?: string; thinking?: string }> 
  };
  
  // Extract text content (skip thinking blocks)
  const textBlocks = data.content.filter(block => block.type === 'text');
  return textBlocks[0]?.text || '';
}

// Scan codebase for context
function scanCodebase(projectPath: string, maxFiles = 20): string[] {
  const files: string[] = [];
  const importantExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.swift'];
  const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__'];

  function scan(dir: string, depth = 0): void {
    if (depth > 3 || files.length >= maxFiles) return;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        if (entry.name.startsWith('.')) continue;
        if (ignoreDirs.includes(entry.name)) continue;

        const fullPath = join(dir, entry.name);
        
        if (entry.isDirectory()) {
          scan(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (importantExtensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Permission denied or other error
    }
  }

  scan(projectPath);
  return files;
}

function getFileContent(filePath: string, maxLines = 50): string {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').slice(0, maxLines);
    return lines.join('\n');
  } catch {
    return '';
  }
}

export interface CodebaseContext {
  files: string[];
  summary: string;
  techStack: string[];
  suggestedNextStep: string;
}

export async function analyzeCodebase(projectPath: string): Promise<CodebaseContext> {
  const apiKey = getApiKey();
  
  // Get file list
  const files = scanCodebase(projectPath);
  
  if (!apiKey) {
    // Return basic analysis without AI
    const techStack: string[] = [];
    
    // Detect tech stack from files
    const hasPackageJson = files.some(f => f.endsWith('package.json'));
    const hasTsConfig = files.some(f => f.endsWith('tsconfig.json'));
    const hasRequirements = files.some(f => f.endsWith('requirements.txt'));
    const hasCargoToml = files.some(f => f.endsWith('Cargo.toml'));
    
    if (hasPackageJson) techStack.push('Node.js');
    if (hasTsConfig) techStack.push('TypeScript');
    if (hasRequirements) techStack.push('Python');
    if (hasCargoToml) techStack.push('Rust');
    if (files.some(f => f.includes('react') || f.endsWith('.tsx') || f.endsWith('.jsx'))) techStack.push('React');
    
    return {
      files,
      summary: `Found ${files.length} source files`,
      techStack,
      suggestedNextStep: 'Continue with current phase',
    };
  }

  // Build context for AI
  const fileList = files.map(f => f.replace(projectPath, '')).join('\n');
  const sampleContent = files.slice(0, 5).map(f => {
    const content = getFileContent(f);
    return `--- ${f.replace(projectPath, '')} ---\n${content}`;
  }).join('\n\n');

  try {
    const response = await callClaude(
      `Analyze this codebase and provide:
1. A one-line summary of what it does
2. The tech stack (list)
3. The most important next step for production readiness

Files:
${fileList}

Sample content:
${sampleContent}

Respond in JSON format:
{"summary": "...", "techStack": ["..."], "suggestedNextStep": "..."}`,
      'You are a senior engineer analyzing a codebase. Be concise. Respond only with valid JSON.'
    );

    const parsed = JSON.parse(response);
    return {
      files,
      summary: parsed.summary || `Found ${files.length} source files`,
      techStack: parsed.techStack || [],
      suggestedNextStep: parsed.suggestedNextStep || 'Continue with current phase',
    };
  } catch (error) {
    return {
      files,
      summary: `Found ${files.length} source files`,
      techStack: [],
      suggestedNextStep: 'Continue with current phase',
    };
  }
}

export async function generateSmartPrompt(
  projectPath: string,
  phase: string,
  step: string,
  context?: CodebaseContext
): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return ''; // Fall back to default prompts
  }

  const codebaseContext = context || await analyzeCodebase(projectPath);

  try {
    const response = await callClaude(
      `Generate a specific, actionable prompt for a developer to paste into Cursor AI.

Project: ${codebaseContext.summary}
Tech stack: ${codebaseContext.techStack.join(', ')}
Current phase: ${phase}
Current step: ${step}

The prompt should:
1. Be specific to THIS codebase
2. Reference actual files/patterns if known
3. Be immediately actionable
4. Follow the Golden Code methodology

Respond with just the prompt text, no explanation.`,
      'You are Midas, a Golden Code coach. Generate prompts that are specific, actionable, and context-aware.'
    );

    return response.trim();
  } catch {
    return '';
  }
}

export async function detectStepCompletion(
  projectPath: string,
  currentStep: string
): Promise<{ completed: boolean; confidence: number; reason: string }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { completed: false, confidence: 0, reason: 'No API key' };
  }

  const context = await analyzeCodebase(projectPath);

  try {
    const response = await callClaude(
      `Based on this codebase analysis, determine if the following step is complete:

Step: ${currentStep}
Files: ${context.files.length} source files
Tech stack: ${context.techStack.join(', ')}

Consider:
- IDEA: Is there a clear project purpose?
- RESEARCH: Are there docs about alternatives?
- BRAINLIFT: Is there a brainlift.md with insights?
- PRD: Is there a prd.md with requirements?
- GAMEPLAN: Is there a gameplan.md with plan?
- BUILD steps: Is there working code with tests?

Respond in JSON:
{"completed": true/false, "confidence": 0-100, "reason": "..."}`,
      'You are analyzing project completeness. Be conservative - only mark complete if clearly done.'
    );

    return JSON.parse(response);
  } catch {
    return { completed: false, confidence: 0, reason: 'Analysis failed' };
  }
}
