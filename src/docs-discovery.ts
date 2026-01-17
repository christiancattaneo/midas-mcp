/**
 * Intelligent documentation discovery and classification.
 * 
 * Instead of looking for specific filenames (brainlift.md, prd.md, gameplan.md),
 * this module:
 * 1. Discovers ALL documentation files in the project
 * 2. Reads them in full
 * 3. Uses AI to classify which ones fulfill planning requirements
 * 4. Returns structured results with confidence scores
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, basename } from 'path';
import { sanitizePath } from './security.js';
import { chat } from './providers.js';
import { logger } from './logger.js';

// Documentation categories we're looking for
export type DocCategory = 'brainlift' | 'prd' | 'gameplan' | 'readme' | 'other';

export interface DiscoveredDoc {
  path: string;           // Relative path from project root
  filename: string;       // Just the filename
  content: string;        // Full content
  sizeBytes: number;
  category?: DocCategory; // AI-classified category
  confidence?: number;    // 0-100 confidence in classification
  summary?: string;       // Brief summary of what the doc contains
}

export interface DocsDiscoveryResult {
  allDocs: DiscoveredDoc[];
  
  // Classified docs (may be null if not found)
  brainlift: DiscoveredDoc | null;  // Domain knowledge, unique insights
  prd: DiscoveredDoc | null;        // Requirements, specs, user stories
  gameplan: DiscoveredDoc | null;   // Implementation plan, roadmap
  readme: DiscoveredDoc | null;     // Project overview
  
  // Summary
  hasPlanningDocs: boolean;         // Has at least brainlift OR prd
  hasAllPlanningDocs: boolean;      // Has brainlift AND prd AND gameplan
  totalDocsFound: number;
  totalBytesRead: number;
  
  // For display
  planningStatus: {
    brainlift: 'found' | 'missing';
    prd: 'found' | 'missing';
    gameplan: 'found' | 'missing';
  };
}

// File extensions that are documentation
const DOC_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.rst', '.adoc', '.asciidoc'
]);

// Patterns that indicate documentation files
const DOC_PATTERNS = [
  /readme/i, /spec/i, /requirement/i, /prd/i, /design/i, /architecture/i,
  /plan/i, /roadmap/i, /vision/i, /brainlift/i, /gameplan/i, /todo/i,
  /changelog/i, /contributing/i, /guide/i, /overview/i, /summary/i,
  /proposal/i, /rfc/i, /adr/i, /decision/i
];

// Directories to search for docs
const DOC_DIRECTORIES = ['docs', 'doc', 'documentation', '.', 'design', 'specs', 'rfcs'];

// Directories to skip
const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt',
  '__pycache__', '.pytest_cache', 'vendor', 'target', '.midas'
]);

// Max file size to read (1MB)
const MAX_FILE_SIZE = 1024 * 1024;

/**
 * Discover all documentation files in a project
 */
export function discoverDocs(projectPath: string): DiscoveredDoc[] {
  const safePath = sanitizePath(projectPath);
  const docs: DiscoveredDoc[] = [];
  
  function scanDir(dir: string, depth: number = 0): void {
    if (depth > 3) return; // Don't go too deep
    
    if (!existsSync(dir)) return;
    
    try {
      const entries = readdirSync(dir);
      
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const relativePath = fullPath.replace(safePath + '/', '');
        
        try {
          const stat = statSync(fullPath);
          
          if (stat.isDirectory()) {
            // Check if this is a docs directory or we're still shallow
            const dirName = basename(entry).toLowerCase();
            if (SKIP_DIRECTORIES.has(dirName)) continue;
            
            // Prioritize doc directories
            if (DOC_DIRECTORIES.includes(dirName) || depth < 2) {
              scanDir(fullPath, depth + 1);
            }
          } else if (stat.isFile()) {
            // Check if this is a documentation file
            const ext = extname(entry).toLowerCase();
            const name = basename(entry).toLowerCase();
            
            const isDocExtension = DOC_EXTENSIONS.has(ext);
            const isDocPattern = DOC_PATTERNS.some(p => p.test(name));
            
            // Include if it's a markdown file or matches doc patterns
            if (isDocExtension || isDocPattern) {
              // Skip if too large
              if (stat.size > MAX_FILE_SIZE) {
                logger.debug(`Skipping large doc: ${relativePath} (${stat.size} bytes)`);
                continue;
              }
              
              try {
                const content = readFileSync(fullPath, 'utf-8');
                docs.push({
                  path: relativePath,
                  filename: entry,
                  content,
                  sizeBytes: stat.size,
                });
              } catch (readErr) {
                logger.debug(`Could not read ${relativePath}: ${readErr}`);
              }
            }
          }
        } catch (statErr) {
          // Skip files we can't stat
        }
      }
    } catch (readDirErr) {
      // Skip directories we can't read
    }
  }
  
  scanDir(safePath);
  
  // Sort by relevance: docs/ directory first, then by pattern match strength
  docs.sort((a, b) => {
    const aInDocs = a.path.startsWith('docs/') ? 0 : 1;
    const bInDocs = b.path.startsWith('docs/') ? 0 : 1;
    if (aInDocs !== bInDocs) return aInDocs - bInDocs;
    
    // Then by filename relevance
    const aRelevance = getFilenameRelevance(a.filename);
    const bRelevance = getFilenameRelevance(b.filename);
    return bRelevance - aRelevance;
  });
  
  return docs;
}

function getFilenameRelevance(filename: string): number {
  const lower = filename.toLowerCase();
  let score = 0;
  
  // High-value names
  if (lower.includes('brainlift')) score += 10;
  if (lower.includes('prd')) score += 10;
  if (lower.includes('gameplan')) score += 10;
  if (lower.includes('readme')) score += 8;
  if (lower.includes('spec')) score += 7;
  if (lower.includes('requirement')) score += 7;
  if (lower.includes('design')) score += 6;
  if (lower.includes('architecture')) score += 6;
  if (lower.includes('plan')) score += 5;
  if (lower.includes('roadmap')) score += 5;
  if (lower.includes('vision')) score += 5;
  
  return score;
}

/**
 * Use AI to classify which docs fulfill planning requirements
 */
export async function classifyDocs(docs: DiscoveredDoc[]): Promise<DocsDiscoveryResult> {
  // If no docs found, return empty result
  if (docs.length === 0) {
    return {
      allDocs: [],
      brainlift: null,
      prd: null,
      gameplan: null,
      readme: null,
      hasPlanningDocs: false,
      hasAllPlanningDocs: false,
      totalDocsFound: 0,
      totalBytesRead: 0,
      planningStatus: {
        brainlift: 'missing',
        prd: 'missing',
        gameplan: 'missing',
      },
    };
  }
  
  // First, try heuristic classification for obvious cases
  const heuristicResult = classifyByHeuristics(docs);
  
  // If we found all three with high confidence, skip AI
  if (heuristicResult.brainlift?.confidence === 100 &&
      heuristicResult.prd?.confidence === 100 &&
      heuristicResult.gameplan?.confidence === 100) {
    return buildResult(docs, heuristicResult);
  }
  
  // Use AI to classify remaining docs
  try {
    const aiResult = await classifyWithAI(docs, heuristicResult);
    return buildResult(docs, aiResult);
  } catch (error) {
    logger.error('AI classification failed, using heuristics only', error as unknown);
    return buildResult(docs, heuristicResult);
  }
}

interface ClassificationResult {
  brainlift: DiscoveredDoc | null;
  prd: DiscoveredDoc | null;
  gameplan: DiscoveredDoc | null;
  readme: DiscoveredDoc | null;
}

function classifyByHeuristics(docs: DiscoveredDoc[]): ClassificationResult {
  const result: ClassificationResult = {
    brainlift: null,
    prd: null,
    gameplan: null,
    readme: null,
  };
  
  for (const doc of docs) {
    const lower = doc.filename.toLowerCase();
    const pathLower = doc.path.toLowerCase();
    
    // Exact matches get 100% confidence
    if (lower === 'brainlift.md' || pathLower.includes('brainlift')) {
      if (!result.brainlift || doc.confidence === undefined || doc.confidence < 100) {
        doc.category = 'brainlift';
        doc.confidence = 100;
        doc.summary = 'Domain knowledge and unique insights';
        result.brainlift = doc;
      }
    } else if (lower === 'prd.md' || lower === 'requirements.md' || lower === 'spec.md') {
      if (!result.prd || (result.prd.confidence ?? 0) < 100) {
        doc.category = 'prd';
        doc.confidence = lower === 'prd.md' ? 100 : 80;
        doc.summary = 'Product requirements and specifications';
        result.prd = doc;
      }
    } else if (lower === 'gameplan.md' || lower === 'roadmap.md' || lower === 'plan.md') {
      if (!result.gameplan || (result.gameplan.confidence ?? 0) < 100) {
        doc.category = 'gameplan';
        doc.confidence = lower === 'gameplan.md' ? 100 : 80;
        doc.summary = 'Implementation plan and roadmap';
        result.gameplan = doc;
      }
    } else if (lower === 'readme.md' || lower === 'readme') {
      if (!result.readme) {
        doc.category = 'readme';
        doc.confidence = 100;
        doc.summary = 'Project overview';
        result.readme = doc;
      }
    }
  }
  
  return result;
}

async function classifyWithAI(
  docs: DiscoveredDoc[],
  heuristicResult: ClassificationResult
): Promise<ClassificationResult> {
  // Build a summary of each doc for AI classification
  const docSummaries = docs.slice(0, 20).map((doc, i) => {
    // Truncate content for the prompt but keep enough for context
    const preview = doc.content.slice(0, 2000);
    return `[${i}] ${doc.path}\n${preview}${doc.content.length > 2000 ? '\n...(truncated)' : ''}`;
  }).join('\n\n---\n\n');
  
  const prompt = `Analyze these project documentation files and classify which ones serve as:

1. BRAINLIFT: Domain knowledge, unique insights, "what YOU know that AI doesn't", mental models, key decisions. Think "second brain" - knowledge transfer from human to AI.

2. PRD: Product Requirements Document - goals, non-goals, user stories, specs, success criteria, features, constraints.

3. GAMEPLAN: Implementation plan, roadmap, tech stack decisions, task breakdown, phases, milestones.

Files to analyze:

${docSummaries}

Respond in JSON:
{
  "brainlift": { "index": <number or null>, "confidence": <0-100>, "reason": "..." },
  "prd": { "index": <number or null>, "confidence": <0-100>, "reason": "..." },
  "gameplan": { "index": <number or null>, "confidence": <0-100>, "reason": "..." }
}

Rules:
- A README can partially fulfill PRD if it contains requirements
- One doc can fulfill multiple categories if it covers all topics
- Return null index if no doc matches that category
- Be generous - partial matches are better than missing`;

  const response = await chat(prompt, {
    systemPrompt: 'You are a documentation analyst. Classify docs concisely. Return only valid JSON.',
    maxTokens: 500,
    useThinking: false,
  });
  
  // Parse response
  let jsonStr = response.content;
  if (jsonStr.includes('```')) {
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonStr = match[1];
  }
  
  const classification = JSON.parse(jsonStr.trim());
  
  // Build result from AI classification
  const result: ClassificationResult = { ...heuristicResult };
  
  if (classification.brainlift?.index !== null && classification.brainlift?.index !== undefined) {
    const doc = docs[classification.brainlift.index];
    if (doc && (!result.brainlift || classification.brainlift.confidence > (result.brainlift.confidence ?? 0))) {
      doc.category = 'brainlift';
      doc.confidence = classification.brainlift.confidence;
      doc.summary = classification.brainlift.reason;
      result.brainlift = doc;
    }
  }
  
  if (classification.prd?.index !== null && classification.prd?.index !== undefined) {
    const doc = docs[classification.prd.index];
    if (doc && (!result.prd || classification.prd.confidence > (result.prd.confidence ?? 0))) {
      doc.category = 'prd';
      doc.confidence = classification.prd.confidence;
      doc.summary = classification.prd.reason;
      result.prd = doc;
    }
  }
  
  if (classification.gameplan?.index !== null && classification.gameplan?.index !== undefined) {
    const doc = docs[classification.gameplan.index];
    if (doc && (!result.gameplan || classification.gameplan.confidence > (result.gameplan.confidence ?? 0))) {
      doc.category = 'gameplan';
      doc.confidence = classification.gameplan.confidence;
      doc.summary = classification.gameplan.reason;
      result.gameplan = doc;
    }
  }
  
  return result;
}

function buildResult(docs: DiscoveredDoc[], classification: ClassificationResult): DocsDiscoveryResult {
  const totalBytesRead = docs.reduce((sum, d) => sum + d.sizeBytes, 0);
  
  return {
    allDocs: docs,
    brainlift: classification.brainlift,
    prd: classification.prd,
    gameplan: classification.gameplan,
    readme: classification.readme,
    hasPlanningDocs: !!(classification.brainlift || classification.prd),
    hasAllPlanningDocs: !!(classification.brainlift && classification.prd && classification.gameplan),
    totalDocsFound: docs.length,
    totalBytesRead,
    planningStatus: {
      brainlift: classification.brainlift ? 'found' : 'missing',
      prd: classification.prd ? 'found' : 'missing',
      gameplan: classification.gameplan ? 'found' : 'missing',
    },
  };
}

/**
 * Quick sync check - just discovers docs and uses heuristics
 * For when you don't want to call AI
 */
export function discoverDocsSync(projectPath: string): DocsDiscoveryResult {
  const docs = discoverDocs(projectPath);
  const heuristicResult = classifyByHeuristics(docs);
  return buildResult(docs, heuristicResult);
}

/**
 * Full discovery with AI classification
 */
export async function discoverAndClassifyDocs(projectPath: string): Promise<DocsDiscoveryResult> {
  const docs = discoverDocs(projectPath);
  return classifyDocs(docs);
}

/**
 * Get combined planning context from all discovered docs
 * Use this to feed into analyzer instead of reading specific files
 */
export function getPlanningContext(result: DocsDiscoveryResult): string {
  const sections: string[] = [];
  
  if (result.brainlift) {
    sections.push(`## Brainlift (Domain Knowledge)\nSource: ${result.brainlift.path}\n\n${result.brainlift.content}`);
  }
  
  if (result.prd) {
    sections.push(`## PRD (Requirements)\nSource: ${result.prd.path}\n\n${result.prd.content}`);
  }
  
  if (result.gameplan) {
    sections.push(`## Gameplan (Implementation Plan)\nSource: ${result.gameplan.path}\n\n${result.gameplan.content}`);
  }
  
  if (result.readme && !result.brainlift && !result.prd) {
    // Only include README if we don't have brainlift or prd
    sections.push(`## README\nSource: ${result.readme.path}\n\n${result.readme.content}`);
  }
  
  return sections.join('\n\n---\n\n');
}
