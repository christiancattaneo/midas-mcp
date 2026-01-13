import { getApiKey } from './config.js';
import { chat, getCurrentModel, getProviderCapabilities } from './providers.js';
import { getActiveProvider } from './config.js';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';

/**
 * Scan codebase for ALL source files - no artificial limits.
 * Complete visibility is essential for accurate analysis.
 */
function scanCodebase(projectPath: string): string[] {
  const files: string[] = [];
  const importantExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.swift', '.md', '.json', '.yaml', '.yml'];
  const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.midas', 'coverage'];

  function scan(dir: string, depth = 0): void {
    if (depth > 6) return; // Reasonable depth for most project structures

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
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

/**
 * Read file content with smart truncation for very large files.
 */
function getFileContent(filePath: string, maxLines = 300): string {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    if (lines.length <= maxLines) return content;
    
    // For large files, take beginning + end (important context at both ends)
    const head = lines.slice(0, Math.floor(maxLines * 0.7));
    const tail = lines.slice(-Math.floor(maxLines * 0.3));
    return [...head, '\n// ... middle truncated ...\n', ...tail].join('\n');
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

  // Build context for AI - prioritize key files
  const fileList = files.map(f => f.replace(projectPath, '')).join('\n');
  
  // Prioritize tests, main entry, and config files
  const priorityPatterns = ['.test.', '.spec.', 'index.', 'main.', 'app.', 'server.', 'config.'];
  const priorityFiles = files.filter(f => priorityPatterns.some(p => f.includes(p))).slice(0, 10);
  const otherFiles = files.filter(f => !priorityPatterns.some(p => f.includes(p))).slice(0, 10);
  const sampleFiles = [...priorityFiles, ...otherFiles].slice(0, 15);
  
  const sampleContent = sampleFiles.map(f => {
    const content = getFileContent(f, 100);
    return `--- ${f.replace(projectPath, '')} ---\n${content}`;
  }).join('\n\n');

  try {
    const provider = getActiveProvider();
    const capabilities = getProviderCapabilities(provider);
    
    const response = await chat(
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
      {
        systemPrompt: 'You are a senior engineer analyzing a codebase. Be concise. Respond only with valid JSON.',
        useThinking: capabilities.thinking,
      }
    );

    const parsed = JSON.parse(response.content);
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
  const provider = getActiveProvider();
  const capabilities = getProviderCapabilities(provider);

  try {
    const response = await chat(
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
      {
        systemPrompt: 'You are Midas, a Golden Code coach. Generate prompts that are specific, actionable, and context-aware.',
        useThinking: capabilities.thinking,
      }
    );

    return response.content.trim();
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
  const provider = getActiveProvider();
  const capabilities = getProviderCapabilities(provider);

  try {
    const response = await chat(
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
      {
        systemPrompt: 'You are analyzing project completeness. Be conservative - only mark complete if clearly done.',
        useThinking: capabilities.thinking,
      }
    );

    return JSON.parse(response.content);
  } catch {
    return { completed: false, confidence: 0, reason: 'Analysis failed' };
  }
}

// Re-export for backward compatibility
export { getCurrentModel };
