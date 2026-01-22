/**
 * Vulnerability Scanner
 * 
 * Detects the top 5 reliably-detectable security anti-patterns:
 * 1. Hardcoded secrets (API keys, tokens, passwords)
 * 2. SQL injection (string concatenation in queries)
 * 3. Command injection (exec/spawn with user input)
 * 4. XSS vulnerabilities (innerHTML, dangerouslySetInnerHTML)
 * 5. Slopsquatting (AI-hallucinated package names that don't exist)
 * 
 * Based on Sec-Context research: https://arcanum-sec.github.io/sec-context/
 */

import { z } from 'zod';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, relative, extname } from 'path';
import { sanitizePath } from '../security.js';
import { logger } from '../logger.js';

// ============================================================================
// SCHEMAS
// ============================================================================

export const vulnScanSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  checkRegistry: z.boolean().optional().describe('Check npm registry for slopsquatting (requires network)'),
  severity: z.enum(['all', 'critical', 'high', 'medium']).optional().describe('Minimum severity to report'),
});

export type VulnScanInput = z.infer<typeof vulnScanSchema>;

// ============================================================================
// TYPES
// ============================================================================

export type VulnSeverity = 'critical' | 'high' | 'medium' | 'low';
export type VulnType = 'hardcoded-secret' | 'sql-injection' | 'command-injection' | 'xss' | 'slopsquatting';

export interface Vulnerability {
  type: VulnType;
  severity: VulnSeverity;
  file: string;
  line: number;
  code: string;
  description: string;
  recommendation: string;
}

export interface SlopsquattingResult {
  package: string;
  exists: boolean;
  similarTo?: string;
  error?: string;
}

export interface VulnScanReport {
  summary: {
    filesScanned: number;
    vulnerabilitiesFound: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  vulnerabilities: Vulnerability[];
  slopsquatting: SlopsquattingResult[];
  suggestedPrompt: string;
}

// ============================================================================
// DETECTION PATTERNS
// ============================================================================

const SECRET_PATTERNS: Array<{ pattern: RegExp; name: string; severity: VulnSeverity }> = [
  // API Keys with common prefixes
  { pattern: /api[_-]?key\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/gi, name: 'API key', severity: 'critical' },
  { pattern: /secret[_-]?key\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/gi, name: 'Secret key', severity: 'critical' },
  { pattern: /auth[_-]?token\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/gi, name: 'Auth token', severity: 'critical' },
  { pattern: /access[_-]?token\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/gi, name: 'Access token', severity: 'critical' },
  
  // Specific provider patterns - more flexible matching
  { pattern: /sk-[a-zA-Z0-9]{32,}/g, name: 'OpenAI API key', severity: 'critical' },
  { pattern: /ghp_[a-zA-Z0-9]{30,}/g, name: 'GitHub token', severity: 'critical' },
  { pattern: /gho_[a-zA-Z0-9]{30,}/g, name: 'GitHub OAuth token', severity: 'critical' },
  { pattern: /github_pat_[a-zA-Z0-9_]{20,}/g, name: 'GitHub PAT', severity: 'critical' },
  { pattern: /xoxb-[0-9]+-[a-zA-Z0-9]+/g, name: 'Slack bot token', severity: 'critical' },
  { pattern: /xoxp-[0-9]+-[a-zA-Z0-9]+/g, name: 'Slack user token', severity: 'critical' },
  { pattern: /AKIA[0-9A-Z]{12,}/g, name: 'AWS access key', severity: 'critical' },
  { pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g, name: 'Private key', severity: 'critical' },
  { pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/g, name: 'SSH private key', severity: 'critical' },
  
  // Database passwords
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/gi, name: 'Hardcoded password', severity: 'high' },
  { pattern: /(?:mongodb|postgres|mysql):\/\/[^:]+:[^@]+@/gi, name: 'Database connection with password', severity: 'high' },
  
  // JWT secrets
  { pattern: /jwt[_-]?secret\s*[:=]\s*['"][^'"]{16,}['"]/gi, name: 'JWT secret', severity: 'critical' },
];

const SQL_INJECTION_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // String concatenation in queries - more flexible
  { pattern: /['"`]SELECT[^'"]*['"]\s*\+\s*(?:req\.|params)/gi, description: 'SQL query with request parameter concatenation' },
  { pattern: /query\s*\([^)]*\+\s*req\./gi, description: 'SQL query with request parameter' },
  { pattern: /query\s*\(\s*`[^`]*\$\{[^}]*req\./gi, description: 'SQL query with template literal injection' },
  { pattern: /execute\s*\(\s*['"`].*\+\s*(?:req\.|params\.|query\.)/gi, description: 'SQL execute with parameter concatenation' },
  { pattern: /\$queryRaw\s*`[^`]*\$\{/gi, description: 'Prisma raw query with interpolation' },
  { pattern: /\.raw\s*\(\s*`[^`]*\$\{/gi, description: 'ORM raw query with interpolation' },
  // Dynamic table/column names
  { pattern: /query\s*\(\s*['"`]SELECT.*FROM\s*['"`]\s*\+/gi, description: 'Dynamic table name in query' },
];

const COMMAND_INJECTION_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // exec with user input
  { pattern: /exec\s*\(\s*['"`].*\+\s*(?:req\.|params\.|query\.|input|user)/gi, description: 'exec() with user input concatenation' },
  { pattern: /exec\s*\(\s*`[^`]*\$\{(?:req\.|params\.|query\.|input|user)/gi, description: 'exec() with template literal injection' },
  { pattern: /execSync\s*\(\s*['"`].*\+\s*(?:req\.|params\.|query\.|input|user)/gi, description: 'execSync() with user input' },
  { pattern: /execSync\s*\(\s*`[^`]*\$\{(?:req\.|params\.|query\.|input|user)/gi, description: 'execSync() with template literal' },
  // spawn with shell
  { pattern: /spawn\s*\(\s*['"](?:sh|bash|cmd)['"]/gi, description: 'spawn() with shell - potential injection vector' },
  { pattern: /spawn\s*\([^)]*shell:\s*true/gi, description: 'spawn() with shell: true' },
  // child_process with user input
  { pattern: /child_process.*\+\s*(?:req\.|params\.|query\.|input|user)/gi, description: 'child_process with user input' },
];

const XSS_PATTERNS: Array<{ pattern: RegExp; description: string; severity: VulnSeverity }> = [
  // React
  { pattern: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html:/g, description: 'React dangerouslySetInnerHTML - XSS risk', severity: 'high' },
  // Vanilla JS
  { pattern: /\.innerHTML\s*=\s*(?!['"`]<)/g, description: 'innerHTML assignment with dynamic content', severity: 'high' },
  { pattern: /\.outerHTML\s*=\s*(?!['"`]<)/g, description: 'outerHTML assignment with dynamic content', severity: 'high' },
  // Vue
  { pattern: /v-html\s*=/g, description: 'Vue v-html directive - XSS risk', severity: 'medium' },
  // jQuery
  { pattern: /\$\([^)]+\)\.html\s*\([^)]*(?:req\.|params\.|query\.|input|user)/gi, description: 'jQuery .html() with user input', severity: 'high' },
  // document.write
  { pattern: /document\.write\s*\(/g, description: 'document.write() - XSS and performance issues', severity: 'medium' },
  // eval
  { pattern: /eval\s*\(\s*(?:req\.|params\.|query\.|input|user)/gi, description: 'eval() with user input - critical XSS/RCE', severity: 'critical' },
];

const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.midas', 'coverage', '.next', '__pycache__', 'vendor'];
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.php', '.go', '.java'];

// ============================================================================
// MAIN SCAN FUNCTION
// ============================================================================

export function vulnScan(input: VulnScanInput): VulnScanReport {
  const projectPath = sanitizePath(input.projectPath);
  const minSeverity = input.severity || 'all';
  
  const vulnerabilities: Vulnerability[] = [];
  const slopsquatting: SlopsquattingResult[] = [];
  let filesScanned = 0;
  
  // Scan all code files
  function scanDir(dir: string, depth = 0): void {
    if (depth > 10) return;
    
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORE_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;
        
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (CODE_EXTENSIONS.includes(ext)) {
            const fileVulns = scanFile(fullPath, projectPath);
            vulnerabilities.push(...fileVulns);
            filesScanned++;
          }
        }
      }
    } catch (error) {
      logger.debug('Error scanning directory', { dir, error: String(error) });
    }
  }
  
  scanDir(projectPath);
  
  // Check package.json for slopsquatting (sync, no network by default)
  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };
      
      // Check for suspicious package names (typosquatting indicators)
      for (const [name] of Object.entries(allDeps)) {
        const suspicious = checkSuspiciousPackage(name);
        if (suspicious) {
          slopsquatting.push(suspicious);
        }
      }
    } catch (error) {
      logger.debug('Error reading package.json', { error: String(error) });
    }
  }
  
  // Filter by severity
  const severityOrder: Record<VulnSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const minSeverityLevel = minSeverity === 'all' ? 3 : severityOrder[minSeverity as VulnSeverity];
  
  const filteredVulns = vulnerabilities.filter(v => severityOrder[v.severity] <= minSeverityLevel);
  
  // Sort by severity
  filteredVulns.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  
  // Count by severity
  const critical = filteredVulns.filter(v => v.severity === 'critical').length;
  const high = filteredVulns.filter(v => v.severity === 'high').length;
  const medium = filteredVulns.filter(v => v.severity === 'medium').length;
  const low = filteredVulns.filter(v => v.severity === 'low').length;
  
  // Generate suggested prompt
  let suggestedPrompt = 'No security vulnerabilities detected. Codebase looks secure!';
  
  if (critical > 0) {
    const topCritical = filteredVulns.find(v => v.severity === 'critical');
    if (topCritical) {
      suggestedPrompt = `CRITICAL: Fix ${topCritical.type} in ${topCritical.file}:${topCritical.line}. ${topCritical.recommendation}`;
    }
  } else if (high > 0) {
    const topHigh = filteredVulns.find(v => v.severity === 'high');
    if (topHigh) {
      suggestedPrompt = `Fix ${topHigh.type} in ${topHigh.file}:${topHigh.line}. ${topHigh.recommendation}`;
    }
  } else if (slopsquatting.length > 0) {
    const sus = slopsquatting[0];
    suggestedPrompt = `Verify package "${sus.package}" exists on npm. ${sus.similarTo ? `Did you mean "${sus.similarTo}"?` : 'May be AI-hallucinated.'}`;
  }
  
  return {
    summary: {
      filesScanned,
      vulnerabilitiesFound: filteredVulns.length,
      critical,
      high,
      medium,
      low,
    },
    vulnerabilities: filteredVulns.slice(0, 50), // Limit output
    slopsquatting,
    suggestedPrompt,
  };
}

// ============================================================================
// FILE SCANNING
// ============================================================================

function scanFile(filePath: string, projectPath: string): Vulnerability[] {
  const vulnerabilities: Vulnerability[] = [];
  
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const relativePath = relative(projectPath, filePath);
    
    // Skip test files for some checks
    const isTestFile = /\.(test|spec)\.[jt]sx?$/.test(filePath) || filePath.includes('__tests__');
    
    // Check for hardcoded secrets (skip test files)
    if (!isTestFile) {
      for (const { pattern, name, severity } of SECRET_PATTERNS) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const lineNum = content.slice(0, match.index).split('\n').length;
          const line = lines[lineNum - 1] || '';
          
          // Skip if it's clearly a placeholder or example
          if (isPlaceholder(match[0])) continue;
          
          vulnerabilities.push({
            type: 'hardcoded-secret',
            severity,
            file: relativePath,
            line: lineNum,
            code: truncateLine(line),
            description: `${name} detected in source code`,
            recommendation: 'Move to environment variable or secrets manager. Never commit secrets to version control.',
          });
        }
      }
    }
    
    // Check for SQL injection
    for (const { pattern, description } of SQL_INJECTION_PATTERNS) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNum = content.slice(0, match.index).split('\n').length;
        const line = lines[lineNum - 1] || '';
        
        vulnerabilities.push({
          type: 'sql-injection',
          severity: 'high',
          file: relativePath,
          line: lineNum,
          code: truncateLine(line),
          description,
          recommendation: 'Use parameterized queries or prepared statements. Never concatenate user input into SQL.',
        });
      }
    }
    
    // Check for command injection
    for (const { pattern, description } of COMMAND_INJECTION_PATTERNS) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNum = content.slice(0, match.index).split('\n').length;
        const line = lines[lineNum - 1] || '';
        
        vulnerabilities.push({
          type: 'command-injection',
          severity: 'critical',
          file: relativePath,
          line: lineNum,
          code: truncateLine(line),
          description,
          recommendation: 'Avoid shell commands with user input. Use execFile() with explicit arguments, or sanitize/validate input strictly.',
        });
      }
    }
    
    // Check for XSS
    for (const { pattern, description, severity } of XSS_PATTERNS) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNum = content.slice(0, match.index).split('\n').length;
        const line = lines[lineNum - 1] || '';
        
        vulnerabilities.push({
          type: 'xss',
          severity,
          file: relativePath,
          line: lineNum,
          code: truncateLine(line),
          description,
          recommendation: 'Sanitize HTML content with DOMPurify or similar. Prefer textContent over innerHTML when possible.',
        });
      }
    }
    
  } catch (error) {
    logger.debug('Error scanning file', { filePath, error: String(error) });
  }
  
  return vulnerabilities;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a string looks like a placeholder rather than a real secret
 */
function isPlaceholder(value: string): boolean {
  const placeholderPatterns = [
    /your[_-]?api[_-]?key/i,
    /xxx+/i,
    /placeholder/i,
    /example/i,
    /test[_-]?key/i,
    /dummy/i,
    /fake/i,
    /\<[^>]+\>/,  // <your-key-here>
    /\[.*\]/,     // [API_KEY]
    /\{.*\}/,     // {api_key}
    /^sk-[x]+$/i, // sk-xxxx...
  ];
  
  return placeholderPatterns.some(p => p.test(value));
}

/**
 * Truncate line for display
 */
function truncateLine(line: string, maxLen = 100): string {
  const trimmed = line.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen - 3) + '...';
}

/**
 * Check if a package name looks suspicious (potential typosquat/slopsquat)
 */
function checkSuspiciousPackage(name: string): SlopsquattingResult | null {
  // Common typosquatting targets and their typos
  const knownPackages: Record<string, string[]> = {
    'lodash': ['lodahs', 'lodasch', 'loadash', 'lodsh'],
    'express': ['expresss', 'expres', 'exprss'],
    'react': ['reacts', 'reactt', 'raect'],
    'axios': ['axois', 'axio', 'axioss'],
    'moment': ['momnet', 'momet', 'momen'],
    'colors': ['colrs', 'colour', 'colorss'],
    'chalk': ['challk', 'chalks', 'chak'],
    'request': ['requst', 'requets', 'requet'],
    'commander': ['comander', 'comanderr', 'commnder'],
    'dotenv': ['dotenvv', 'dotnev', 'dotev'],
  };
  
  // Check if it's a known typo
  for (const [correct, typos] of Object.entries(knownPackages)) {
    if (typos.includes(name)) {
      return {
        package: name,
        exists: false,
        similarTo: correct,
      };
    }
  }
  
  // Check for suspicious patterns
  const suspiciousPatterns = [
    /^[a-z]+-[a-z]+-[a-z]+-[a-z]+$/,  // Too many dashes (often AI-generated)
    /^[a-z]{20,}$/,                    // Very long single word
    /@[a-z]+\/[a-z]+-v\d+$/,          // Fake scoped package with version
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(name)) {
      return {
        package: name,
        exists: false, // Unknown
        error: 'Unusual package name pattern - verify it exists',
      };
    }
  }
  
  return null;
}

// ============================================================================
// ASYNC REGISTRY CHECK (for network-enabled scanning)
// ============================================================================

/**
 * Check if packages exist on npm registry
 * This requires network access and should be used with checkRegistry: true
 */
export async function checkNpmRegistry(packages: string[]): Promise<SlopsquattingResult[]> {
  const results: SlopsquattingResult[] = [];
  
  for (const pkg of packages.slice(0, 20)) { // Limit to 20 packages
    try {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      
      if (response.status === 404) {
        results.push({
          package: pkg,
          exists: false,
          error: 'Package does not exist on npm - may be AI-hallucinated',
        });
      } else if (response.ok) {
        // Package exists, no issue
      }
    } catch (error) {
      results.push({
        package: pkg,
        exists: false,
        error: `Could not verify: ${String(error)}`,
      });
    }
  }
  
  return results;
}

/**
 * Enhanced scan with npm registry verification
 */
export async function vulnScanWithRegistry(input: VulnScanInput): Promise<VulnScanReport> {
  const basicReport = vulnScan(input);
  
  if (!input.checkRegistry) {
    return basicReport;
  }
  
  // Get all dependencies
  const projectPath = sanitizePath(input.projectPath);
  const pkgPath = join(projectPath, 'package.json');
  
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = Object.keys({
        ...pkg.dependencies,
        ...pkg.devDependencies,
      });
      
      const registryResults = await checkNpmRegistry(allDeps);
      basicReport.slopsquatting.push(...registryResults);
      
      // Update suggested prompt if slopsquatting found
      if (registryResults.length > 0 && basicReport.summary.critical === 0) {
        const firstMissing = registryResults.find(r => !r.exists);
        if (firstMissing) {
          basicReport.suggestedPrompt = `Package "${firstMissing.package}" not found on npm. Remove or replace with correct package name.`;
        }
      }
    } catch (error) {
      logger.debug('Error checking npm registry', { error: String(error) });
    }
  }
  
  return basicReport;
}
