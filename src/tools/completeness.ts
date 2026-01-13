/**
 * 12-Category Completeness Model
 * 
 * Production readiness scoring across critical dimensions:
 * - Testing, Security, Documentation, Monitoring, etc.
 */

import { z } from 'zod';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { sanitizePath } from '../security.js';
import { execSync } from 'child_process';

// ============================================================================
// SCHEMA
// ============================================================================

export const completenessSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
  detailed: z.boolean().optional().describe('Include detailed recommendations'),
});

export type CompletenessInput = z.infer<typeof completenessSchema>;

// ============================================================================
// TYPES
// ============================================================================

interface CategoryScore {
  score: number;        // 0-100
  weight: number;       // Importance (1-3)
  status: 'pass' | 'warn' | 'fail';
  findings: string[];
  recommendations: string[];
}

interface CompletenessReport {
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  categories: Record<string, CategoryScore>;
  blockers: string[];
  topRecommendations: string[];
  productionReady: boolean;
}

// ============================================================================
// CATEGORY CHECKERS
// ============================================================================

function checkTesting(projectPath: string): CategoryScore {
  const findings: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  // Check for test files
  const testPatterns = ['.test.', '.spec.', '__tests__'];
  let testFiles = 0;
  let srcFiles = 0;

  function scan(dir: string, depth = 0): void {
    if (depth > 6) return;  // Deeper scan for complete visibility
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(path, depth + 1);
        } else {
          const ext = extname(entry.name);
          if (['.ts', '.tsx', '.js', '.jsx', '.py'].includes(ext)) {
            if (testPatterns.some(p => entry.name.includes(p))) {
              testFiles++;
            } else {
              srcFiles++;
            }
          }
        }
      }
    } catch {
      // Skip inaccessible
    }
  }
  scan(projectPath);

  // Calculate coverage ratio
  const testRatio = srcFiles > 0 ? testFiles / srcFiles : 0;
  
  if (testFiles === 0) {
    findings.push('No test files found');
    recommendations.push('Add unit tests for critical functions');
  } else {
    findings.push(`${testFiles} test files for ${srcFiles} source files`);
    score += 30;
  }

  if (testRatio >= 0.5) {
    score += 30;
    findings.push('Good test coverage ratio');
  } else if (testRatio >= 0.2) {
    score += 15;
    recommendations.push('Increase test coverage to at least 50%');
  }

  // Check for test config
  const hasJest = existsSync(join(projectPath, 'jest.config.js')) || 
                  existsSync(join(projectPath, 'jest.config.ts'));
  const hasVitest = existsSync(join(projectPath, 'vitest.config.ts'));
  const hasPytest = existsSync(join(projectPath, 'pytest.ini')) ||
                    existsSync(join(projectPath, 'pyproject.toml'));

  if (hasJest || hasVitest || hasPytest) {
    score += 20;
    findings.push('Test framework configured');
  }

  // Check CI runs tests
  const ciPath = join(projectPath, '.github', 'workflows');
  if (existsSync(ciPath)) {
    try {
      const workflows = readdirSync(ciPath);
      for (const wf of workflows) {
        const content = readFileSync(join(ciPath, wf), 'utf-8');
        if (content.includes('test') || content.includes('jest') || content.includes('vitest')) {
          score += 20;
          findings.push('Tests run in CI');
          break;
        }
      }
    } catch {
      // Skip
    }
  }

  return {
    score: Math.min(100, score),
    weight: 3,
    status: score >= 70 ? 'pass' : score >= 40 ? 'warn' : 'fail',
    findings,
    recommendations,
  };
}

function checkSecurity(projectPath: string): CategoryScore {
  const findings: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  // Check .gitignore
  const gitignorePath = join(projectPath, '.gitignore');
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    const patterns = ['.env', 'node_modules', '*.key', '*.pem', 'secrets'];
    const found = patterns.filter(p => content.includes(p));
    if (found.length >= 3) {
      score += 25;
      findings.push('.gitignore covers sensitive files');
    } else {
      recommendations.push('Add more sensitive patterns to .gitignore');
    }
  } else {
    recommendations.push('Create .gitignore to exclude sensitive files');
  }

  // Check for hardcoded secrets (basic check)
  const secretPatterns = [
    /api[_-]?key\s*[:=]\s*['"][a-zA-Z0-9]{20,}/i,
    /secret\s*[:=]\s*['"][a-zA-Z0-9]{20,}/i,
    /password\s*[:=]\s*['"][^'"]+['"]/i,
  ];

  let foundSecrets = false;
  function scanForSecrets(dir: string, depth = 0): void {
    if (depth > 3 || foundSecrets) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          scanForSecrets(path, depth + 1);
        } else if (['.ts', '.js', '.py', '.json'].includes(extname(entry.name))) {
          try {
            const content = readFileSync(path, 'utf-8').slice(0, 10000);
            for (const pattern of secretPatterns) {
              if (pattern.test(content)) {
                foundSecrets = true;
                findings.push(`Potential secret in ${entry.name}`);
                break;
              }
            }
          } catch {
            // Skip unreadable
          }
        }
      }
    } catch {
      // Skip
    }
  }
  scanForSecrets(projectPath);

  if (!foundSecrets) {
    score += 25;
    findings.push('No hardcoded secrets detected');
  } else {
    recommendations.push('Remove hardcoded secrets and use environment variables');
  }

  // Check npm audit
  try {
    const audit = execSync('npm audit --json 2>/dev/null || echo "{}"', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: 'pipe',
    });
    const result = JSON.parse(audit || '{}');
    const vulns = result.metadata?.vulnerabilities || {};
    const critical = vulns.critical || 0;
    const high = vulns.high || 0;

    if (critical === 0 && high === 0) {
      score += 25;
      findings.push('No critical/high vulnerabilities');
    } else {
      findings.push(`${critical} critical, ${high} high vulnerabilities`);
      recommendations.push('Run npm audit fix to address vulnerabilities');
    }
  } catch {
    findings.push('npm audit skipped');
    score += 10;  // Neutral
  }

  // Check for security headers / rate limiting mentions
  const srcDir = join(projectPath, 'src');
  if (existsSync(srcDir)) {
    try {
      const files = readdirSync(srcDir);
      for (const f of files.slice(0, 50)) {  // Check more files
        try {
          const content = readFileSync(join(srcDir, f), 'utf-8');
          if (content.includes('rate-limit') || content.includes('rateLimit') ||
              content.includes('helmet') || content.includes('cors')) {
            score += 25;
            findings.push('Security middleware detected');
            break;
          }
        } catch {
          // Skip
        }
      }
    } catch {
      // Skip
    }
  }

  return {
    score: Math.min(100, score),
    weight: 3,
    status: score >= 70 ? 'pass' : score >= 40 ? 'warn' : 'fail',
    findings,
    recommendations,
  };
}

function checkDocumentation(projectPath: string): CategoryScore {
  const findings: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  // README
  if (existsSync(join(projectPath, 'README.md'))) {
    const content = readFileSync(join(projectPath, 'README.md'), 'utf-8');
    const wordCount = content.split(/\s+/).length;
    
    if (wordCount > 200) {
      score += 30;
      findings.push('README with substantial content');
    } else {
      score += 15;
      recommendations.push('Expand README with installation and usage');
    }

    // Check for key sections
    const sections = ['install', 'usage', 'api', 'example', 'license'];
    const found = sections.filter(s => content.toLowerCase().includes(s));
    if (found.length >= 3) {
      score += 20;
      findings.push('README has key sections');
    }
  } else {
    recommendations.push('Create README.md with project overview');
  }

  // API docs / JSDoc
  let hasApiDocs = false;
  const docsDir = join(projectPath, 'docs');
  if (existsSync(docsDir)) {
    score += 20;
    findings.push('docs/ directory exists');
    hasApiDocs = true;
  }

  // Check for inline documentation
  const srcDir = join(projectPath, 'src');
  if (existsSync(srcDir)) {
    try {
      const files = readdirSync(srcDir).filter(f => f.endsWith('.ts'));
      let jsdocCount = 0;
      for (const f of files.slice(0, 30)) {  // Check more files
        const content = readFileSync(join(srcDir, f), 'utf-8');
        if (content.includes('/**') || content.includes('* @')) {
          jsdocCount++;
        }
      }
      if (jsdocCount >= 2) {
        score += 20;
        findings.push('JSDoc comments present');
      } else {
        recommendations.push('Add JSDoc comments to exported functions');
      }
    } catch {
      // Skip
    }
  }

  // CHANGELOG
  if (existsSync(join(projectPath, 'CHANGELOG.md'))) {
    score += 10;
    findings.push('CHANGELOG.md exists');
  } else {
    recommendations.push('Create CHANGELOG.md to track versions');
  }

  return {
    score: Math.min(100, score),
    weight: 2,
    status: score >= 70 ? 'pass' : score >= 40 ? 'warn' : 'fail',
    findings,
    recommendations,
  };
}

function checkMonitoring(projectPath: string): CategoryScore {
  const findings: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  // Check for logging
  const srcDir = join(projectPath, 'src');
  let hasLogging = false;
  let hasMetrics = false;
  let hasSentry = false;

  if (existsSync(srcDir)) {
    try {
      const files = readdirSync(srcDir);
      for (const f of files.slice(0, 50)) {  // Check more files for observability
        try {
          const content = readFileSync(join(srcDir, f), 'utf-8');
          if (content.includes('logger') || content.includes('winston') || content.includes('pino')) {
            hasLogging = true;
          }
          if (content.includes('metrics') || content.includes('prometheus') || content.includes('opentelemetry')) {
            hasMetrics = true;
          }
          if (content.includes('sentry') || content.includes('Sentry')) {
            hasSentry = true;
          }
        } catch {
          // Skip
        }
      }
    } catch {
      // Skip
    }
  }

  if (hasLogging) {
    score += 30;
    findings.push('Logging configured');
  } else {
    recommendations.push('Add structured logging (winston, pino)');
  }

  if (hasMetrics) {
    score += 30;
    findings.push('Metrics/observability present');
  } else {
    recommendations.push('Add metrics export (OpenTelemetry, Prometheus)');
  }

  if (hasSentry) {
    score += 20;
    findings.push('Error tracking (Sentry) detected');
  }

  // Health check endpoint
  try {
    const files = readdirSync(srcDir);
    for (const f of files) {
      if (f.includes('health') || f.includes('status')) {
        score += 20;
        findings.push('Health check endpoint found');
        break;
      }
    }
  } catch {
    // Skip
  }

  if (findings.length === 0) {
    recommendations.push('Add monitoring for production visibility');
  }

  return {
    score: Math.min(100, score),
    weight: 2,
    status: score >= 70 ? 'pass' : score >= 40 ? 'warn' : 'fail',
    findings,
    recommendations,
  };
}

function checkCI(projectPath: string): CategoryScore {
  const findings: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  const ciPath = join(projectPath, '.github', 'workflows');
  const hasGithubActions = existsSync(ciPath);
  const hasGitlab = existsSync(join(projectPath, '.gitlab-ci.yml'));
  const hasCircle = existsSync(join(projectPath, '.circleci'));

  if (hasGithubActions || hasGitlab || hasCircle) {
    score += 40;
    findings.push('CI/CD pipeline configured');

    // Check workflow content
    if (hasGithubActions) {
      try {
        const workflows = readdirSync(ciPath);
        for (const wf of workflows) {
          const content = readFileSync(join(ciPath, wf), 'utf-8');
          if (content.includes('npm test') || content.includes('jest') || content.includes('vitest')) {
            score += 20;
            findings.push('CI runs tests');
          }
          if (content.includes('npm run build') || content.includes('tsc')) {
            score += 20;
            findings.push('CI runs build');
          }
          if (content.includes('npm run lint') || content.includes('eslint')) {
            score += 20;
            findings.push('CI runs linting');
          }
        }
      } catch {
        // Skip
      }
    }
  } else {
    recommendations.push('Add CI/CD pipeline (GitHub Actions recommended)');
  }

  return {
    score: Math.min(100, score),
    weight: 2,
    status: score >= 70 ? 'pass' : score >= 40 ? 'warn' : 'fail',
    findings,
    recommendations,
  };
}

function checkDeployment(projectPath: string): CategoryScore {
  const findings: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  // Docker
  if (existsSync(join(projectPath, 'Dockerfile')) || 
      existsSync(join(projectPath, 'docker-compose.yml'))) {
    score += 30;
    findings.push('Docker configuration present');
  }

  // Infrastructure as code
  if (existsSync(join(projectPath, 'terraform')) ||
      existsSync(join(projectPath, 'pulumi')) ||
      existsSync(join(projectPath, 'cdk.json'))) {
    score += 30;
    findings.push('Infrastructure as code configured');
  }

  // Deployment docs
  if (existsSync(join(projectPath, 'docs', 'DEPLOYMENT.md')) ||
      existsSync(join(projectPath, 'DEPLOYMENT.md'))) {
    score += 20;
    findings.push('Deployment documentation exists');
  } else {
    recommendations.push('Document deployment process');
  }

  // Environment config
  if (existsSync(join(projectPath, '.env.example')) ||
      existsSync(join(projectPath, '.env.template'))) {
    score += 20;
    findings.push('Environment template provided');
  } else {
    recommendations.push('Create .env.example for required variables');
  }

  if (score === 0) {
    recommendations.push('Add deployment configuration (Docker, CI/CD)');
  }

  return {
    score: Math.min(100, score),
    weight: 2,
    status: score >= 70 ? 'pass' : score >= 40 ? 'warn' : 'fail',
    findings,
    recommendations,
  };
}

function checkErrorHandling(projectPath: string): CategoryScore {
  const findings: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  const srcDir = join(projectPath, 'src');
  let tryCatchCount = 0;
  let errorBoundaries = 0;
  let fileCount = 0;

  if (existsSync(srcDir)) {
    function scan(dir: string, depth = 0): void {
      if (depth > 3) return;
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const path = join(dir, entry.name);
          if (entry.isDirectory()) {
            scan(path, depth + 1);
          } else if (['.ts', '.tsx', '.js', '.jsx'].includes(extname(entry.name))) {
            fileCount++;
            try {
              const content = readFileSync(path, 'utf-8');
              const catches = (content.match(/catch\s*\(/g) || []).length;
              tryCatchCount += catches;
              if (content.includes('ErrorBoundary') || content.includes('componentDidCatch')) {
                errorBoundaries++;
              }
            } catch {
              // Skip
            }
          }
        }
      } catch {
        // Skip
      }
    }
    scan(srcDir);
  }

  const catchRatio = fileCount > 0 ? tryCatchCount / fileCount : 0;

  if (catchRatio >= 0.5) {
    score += 40;
    findings.push('Good error handling coverage');
  } else if (catchRatio >= 0.2) {
    score += 20;
    recommendations.push('Add try/catch to more async operations');
  } else {
    recommendations.push('Add error handling to critical operations');
  }

  if (errorBoundaries > 0) {
    score += 30;
    findings.push('React error boundaries present');
  }

  // Check for global error handlers
  try {
    const indexFile = join(srcDir, 'index.ts');
    if (existsSync(indexFile)) {
      const content = readFileSync(indexFile, 'utf-8');
      if (content.includes('uncaughtException') || content.includes('unhandledRejection')) {
        score += 30;
        findings.push('Global error handlers configured');
      }
    }
  } catch {
    // Skip
  }

  return {
    score: Math.min(100, score),
    weight: 2,
    status: score >= 70 ? 'pass' : score >= 40 ? 'warn' : 'fail',
    findings,
    recommendations,
  };
}

function checkCodeQuality(projectPath: string): CategoryScore {
  const findings: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  // TypeScript
  if (existsSync(join(projectPath, 'tsconfig.json'))) {
    score += 25;
    findings.push('TypeScript configured');

    try {
      const config = JSON.parse(readFileSync(join(projectPath, 'tsconfig.json'), 'utf-8'));
      if (config.compilerOptions?.strict) {
        score += 15;
        findings.push('Strict mode enabled');
      } else {
        recommendations.push('Enable TypeScript strict mode');
      }
    } catch {
      // Skip
    }
  }

  // Linting
  if (existsSync(join(projectPath, '.eslintrc.json')) ||
      existsSync(join(projectPath, '.eslintrc.js')) ||
      existsSync(join(projectPath, 'eslint.config.js'))) {
    score += 25;
    findings.push('ESLint configured');
  } else {
    recommendations.push('Add ESLint for code quality');
  }

  // Formatting
  if (existsSync(join(projectPath, '.prettierrc')) ||
      existsSync(join(projectPath, '.prettierrc.json'))) {
    score += 15;
    findings.push('Prettier configured');
  }

  // Pre-commit hooks
  if (existsSync(join(projectPath, '.husky'))) {
    score += 20;
    findings.push('Pre-commit hooks configured');
  }

  return {
    score: Math.min(100, score),
    weight: 2,
    status: score >= 70 ? 'pass' : score >= 40 ? 'warn' : 'fail',
    findings,
    recommendations,
  };
}

function checkPerformance(projectPath: string): CategoryScore {
  const findings: string[] = [];
  const recommendations: string[] = [];
  let score = 30; // Base score - hard to detect without running

  // Bundle optimization
  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const deps = Object.keys(pkg.dependencies || {});

      // Check for known performance helpers
      if (deps.includes('compression') || deps.includes('zlib')) {
        score += 20;
        findings.push('Compression middleware present');
      }

      // Check for caching
      if (deps.includes('redis') || deps.includes('ioredis') || deps.includes('memcached')) {
        score += 20;
        findings.push('Caching layer configured');
      }

      // Lazy loading indicators
      const srcDir = join(projectPath, 'src');
      if (existsSync(srcDir)) {
        try {
          const content = readdirSync(srcDir).map(f => {
            try {
              return readFileSync(join(srcDir, f), 'utf-8');
            } catch {
              return '';
            }
          }).join('');

          if (content.includes('lazy(') || content.includes('React.lazy')) {
            score += 15;
            findings.push('Lazy loading detected');
          }
          if (content.includes('useMemo') || content.includes('useCallback')) {
            score += 15;
            findings.push('React memoization used');
          }
        } catch {
          // Skip
        }
      }
    } catch {
      // Skip
    }
  }

  return {
    score: Math.min(100, score),
    weight: 1,
    status: score >= 70 ? 'pass' : score >= 40 ? 'warn' : 'fail',
    findings,
    recommendations,
  };
}

function checkAccessibility(projectPath: string): CategoryScore {
  const findings: string[] = [];
  const recommendations: string[] = [];
  let score = 50; // Base - needs runtime testing

  // Check for a11y testing libraries
  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      if (allDeps['@axe-core/react'] || allDeps['jest-axe'] || allDeps['@testing-library/jest-dom']) {
        score += 25;
        findings.push('Accessibility testing library present');
      }

      if (allDeps['@headlessui/react'] || allDeps['@radix-ui/react-accessible-icon']) {
        score += 25;
        findings.push('Accessible component library used');
      }
    } catch {
      // Skip
    }
  }

  // Check for aria usage
  const srcDir = join(projectPath, 'src');
  if (existsSync(srcDir)) {
    try {
      const files = readdirSync(srcDir).filter(f => f.endsWith('.tsx'));
      for (const f of files.slice(0, 5)) {
        const content = readFileSync(join(srcDir, f), 'utf-8');
        if (content.includes('aria-') || content.includes('role=')) {
          findings.push('ARIA attributes used');
          break;
        }
      }
    } catch {
      // Skip
    }
  }

  return {
    score: Math.min(100, score),
    weight: 1,
    status: score >= 70 ? 'pass' : score >= 40 ? 'warn' : 'fail',
    findings,
    recommendations,
  };
}

function checkDataIntegrity(projectPath: string): CategoryScore {
  const findings: string[] = [];
  const recommendations: string[] = [];
  let score = 30;

  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Validation libraries
      if (deps.zod || deps.joi || deps.yup || deps['class-validator']) {
        score += 30;
        findings.push('Input validation library present');
      } else {
        recommendations.push('Add validation library (zod recommended)');
      }

      // Database migrations
      if (deps.prisma || deps.knex || deps.typeorm || deps.sequelize) {
        score += 20;
        findings.push('Database ORM configured');
      }

      // Backup/transaction handling
      const srcDir = join(projectPath, 'src');
      if (existsSync(srcDir)) {
        try {
          const content = readdirSync(srcDir).slice(0, 10).map(f => {
            try {
              return readFileSync(join(srcDir, f), 'utf-8');
            } catch {
              return '';
            }
          }).join('');

          if (content.includes('transaction') || content.includes('$transaction')) {
            score += 20;
            findings.push('Database transactions used');
          }
        } catch {
          // Skip
        }
      }
    } catch {
      // Skip
    }
  }

  return {
    score: Math.min(100, score),
    weight: 2,
    status: score >= 70 ? 'pass' : score >= 40 ? 'warn' : 'fail',
    findings,
    recommendations,
  };
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

export function checkCompleteness(input: CompletenessInput): CompletenessReport {
  const projectPath = sanitizePath(input.projectPath || process.cwd());
  const detailed = input.detailed ?? true;

  // Run all category checks
  const categories: Record<string, CategoryScore> = {
    testing: checkTesting(projectPath),
    security: checkSecurity(projectPath),
    documentation: checkDocumentation(projectPath),
    monitoring: checkMonitoring(projectPath),
    ci_cd: checkCI(projectPath),
    deployment: checkDeployment(projectPath),
    error_handling: checkErrorHandling(projectPath),
    code_quality: checkCodeQuality(projectPath),
    performance: checkPerformance(projectPath),
    accessibility: checkAccessibility(projectPath),
    data_integrity: checkDataIntegrity(projectPath),
  };

  // Calculate weighted score
  let totalWeight = 0;
  let weightedScore = 0;
  const blockers: string[] = [];
  const allRecommendations: string[] = [];

  for (const [name, category] of Object.entries(categories)) {
    totalWeight += category.weight;
    weightedScore += category.score * category.weight;

    if (category.status === 'fail') {
      blockers.push(`${name}: ${category.findings[0] || 'Needs attention'}`);
    }

    for (const rec of category.recommendations) {
      allRecommendations.push(`[${name}] ${rec}`);
    }
  }

  const overallScore = Math.round(weightedScore / totalWeight);

  // Determine grade
  let grade: 'A' | 'B' | 'C' | 'D' | 'F';
  if (overallScore >= 90) grade = 'A';
  else if (overallScore >= 80) grade = 'B';
  else if (overallScore >= 70) grade = 'C';
  else if (overallScore >= 60) grade = 'D';
  else grade = 'F';

  // Top recommendations (prioritized by category weight)
  const topRecommendations = allRecommendations.slice(0, 5);

  return {
    overallScore,
    grade,
    categories: detailed ? categories : Object.fromEntries(
      Object.entries(categories).map(([k, v]) => [k, { ...v, findings: [], recommendations: [] }])
    ),
    blockers,
    topRecommendations,
    productionReady: grade !== 'F' && blockers.length === 0,
  };
}
