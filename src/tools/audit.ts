import { z } from 'zod';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export const auditSchema = z.object({
  projectPath: z.string().optional().describe('Path to project root'),
});

export type AuditInput = z.infer<typeof auditSchema>;

interface IngredientScore {
  exists: boolean;
  score: number;
  issues: string[];
  suggestions: string[];
}

interface AuditResult {
  scores: Record<string, IngredientScore>;
  overall: number;
  level: 'functional' | 'integrated' | 'protected' | 'production';
}

function checkFilePatterns(projectPath: string, patterns: string[]): boolean {
  try {
    const files = getAllFiles(projectPath);
    return patterns.some(pattern => 
      files.some(f => f.toLowerCase().includes(pattern.toLowerCase()))
    );
  } catch {
    return false;
  }
}

function getAllFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        getAllFiles(path, files);
      } else {
        files.push(path);
      }
    }
  } catch {
    // Permission denied or other error
  }
  return files;
}

function checkPackageJson(projectPath: string): Record<string, unknown> | null {
  const pkgPath = join(projectPath, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    return null;
  }
}

function hasDependency(pkg: Record<string, unknown> | null, deps: string[]): boolean {
  if (!pkg) return false;
  const allDeps = {
    ...(pkg.dependencies as Record<string, string> || {}),
    ...(pkg.devDependencies as Record<string, string> || {}),
  };
  return deps.some(d => d in allDeps);
}

export function audit(input: AuditInput): AuditResult {
  const projectPath = input.projectPath || process.cwd();
  const pkg = checkPackageJson(projectPath);
  const scores: Record<string, IngredientScore> = {};

  // 1. Frontend
  const hasFrontend = checkFilePatterns(projectPath, [
    'index.html', 'app.tsx', 'app.jsx', 'app.vue', 'app.svelte',
    'pages/', 'components/', 'src/app',
  ]) || hasDependency(pkg, ['react', 'vue', 'svelte', 'next', 'nuxt']);
  
  scores['1-frontend'] = {
    exists: hasFrontend,
    score: hasFrontend ? 70 : 0,
    issues: hasFrontend ? [] : ['No frontend detected'],
    suggestions: hasFrontend ? ['Add loading states', 'Verify responsive design'] : ['Create UI components'],
  };

  // 2. Backend
  const hasBackend = checkFilePatterns(projectPath, [
    'server.ts', 'server.js', 'api/', 'routes/', 'controllers/',
  ]) || hasDependency(pkg, ['express', 'fastify', 'hono', 'koa', 'nest']);
  
  scores['2-backend'] = {
    exists: hasBackend,
    score: hasBackend ? 70 : 0,
    issues: hasBackend ? [] : ['No backend detected'],
    suggestions: hasBackend ? ['Add input validation', 'Add rate limiting'] : ['Create API endpoints'],
  };

  // 3. Database
  const hasDatabase = checkFilePatterns(projectPath, [
    'schema.prisma', 'migrations/', 'models/', 'db.ts', 'database.ts',
  ]) || hasDependency(pkg, ['prisma', 'mongoose', 'typeorm', 'drizzle', 'firebase']);
  
  scores['3-database'] = {
    exists: hasDatabase,
    score: hasDatabase ? 70 : 0,
    issues: hasDatabase ? [] : ['No database detected'],
    suggestions: hasDatabase ? ['Add indexes', 'Verify backup strategy'] : ['Set up database'],
  };

  // 4. Authentication
  const hasAuth = checkFilePatterns(projectPath, [
    'auth.ts', 'auth/', 'login', 'session', 'jwt',
  ]) || hasDependency(pkg, ['next-auth', 'passport', 'lucia', 'clerk', 'auth0']);
  
  scores['4-authentication'] = {
    exists: hasAuth,
    score: hasAuth ? 70 : 0,
    issues: hasAuth ? [] : ['No authentication detected'],
    suggestions: hasAuth ? ['Verify secure password hashing', 'Add account lockout'] : ['Add authentication'],
  };

  // 5. API Integrations
  const hasApiIntegrations = checkFilePatterns(projectPath, [
    'integrations/', 'services/', 'api-client', 'sdk',
  ]) || hasDependency(pkg, ['axios', 'openai', 'stripe', 'twilio']);
  
  scores['5-api-integrations'] = {
    exists: hasApiIntegrations,
    score: hasApiIntegrations ? 70 : 0,
    issues: hasApiIntegrations ? [] : ['No API integrations found'],
    suggestions: hasApiIntegrations ? ['Add retry logic', 'Add circuit breakers'] : [],
  };

  // 6. State Management
  const hasStateManagement = checkFilePatterns(projectPath, [
    'store/', 'state/', 'context/', 'atoms/',
  ]) || hasDependency(pkg, ['zustand', 'redux', 'jotai', 'recoil', 'mobx']);
  
  scores['6-state-management'] = {
    exists: hasStateManagement,
    score: hasStateManagement ? 70 : 0,
    issues: hasStateManagement ? [] : ['No state management detected'],
    suggestions: hasStateManagement ? ['Verify cache invalidation', 'Check for prop drilling'] : [],
  };

  // 7. Design/UX
  const hasDesign = checkFilePatterns(projectPath, [
    'styles/', 'css/', 'tailwind.config', 'theme',
  ]) || hasDependency(pkg, ['tailwindcss', 'styled-components', 'emotion', 'sass']);
  
  scores['7-design-ux'] = {
    exists: hasDesign,
    score: hasDesign ? 70 : 0,
    issues: hasDesign ? [] : ['No design system detected'],
    suggestions: hasDesign ? ['Verify empty states', 'Check mobile responsiveness'] : [],
  };

  // 8. Testing
  const hasTesting = checkFilePatterns(projectPath, [
    '.test.', '.spec.', '__tests__/', 'test/', 'tests/',
  ]) || hasDependency(pkg, ['jest', 'vitest', 'mocha', 'playwright', 'cypress']);
  
  scores['8-testing'] = {
    exists: hasTesting,
    score: hasTesting ? 70 : 0,
    issues: hasTesting ? [] : ['No tests detected'],
    suggestions: hasTesting ? ['Add E2E tests for critical flows', 'Verify CI runs tests'] : ['Add unit tests'],
  };

  // 9. Security
  const hasSecurity = checkFilePatterns(projectPath, [
    'security/', 'middleware/auth', 'helmet', 'cors',
  ]) || hasDependency(pkg, ['helmet', 'cors', 'csurf', 'express-rate-limit']);
  
  const hasEnvExample = existsSync(join(projectPath, '.env.example'));
  const hasGitignore = existsSync(join(projectPath, '.gitignore'));
  
  scores['9-security'] = {
    exists: hasSecurity || hasEnvExample,
    score: (hasSecurity ? 40 : 0) + (hasEnvExample ? 15 : 0) + (hasGitignore ? 15 : 0),
    issues: [
      ...(!hasSecurity ? ['No security middleware detected'] : []),
      ...(!hasEnvExample ? ['No .env.example for secrets documentation'] : []),
      ...(!hasGitignore ? ['No .gitignore'] : []),
    ],
    suggestions: ['Audit dependencies for vulnerabilities', 'Verify no secrets in code'],
  };

  // 10. Error Handling
  const hasErrorHandling = checkFilePatterns(projectPath, [
    'error', 'exception', 'catch', 'errorBoundary',
  ]);
  
  scores['10-error-handling'] = {
    exists: hasErrorHandling,
    score: hasErrorHandling ? 70 : 0,
    issues: hasErrorHandling ? [] : ['No centralized error handling detected'],
    suggestions: ['Add error boundaries', 'Ensure user-friendly error messages'],
  };

  // 11. Version Control
  const hasGit = existsSync(join(projectPath, '.git'));
  const hasGitignoreFile = existsSync(join(projectPath, '.gitignore'));
  
  scores['11-version-control'] = {
    exists: hasGit,
    score: (hasGit ? 50 : 0) + (hasGitignoreFile ? 20 : 0),
    issues: [
      ...(!hasGit ? ['Not a git repository'] : []),
      ...(!hasGitignoreFile ? ['No .gitignore'] : []),
    ],
    suggestions: ['Verify no secrets in git history', 'Use conventional commits'],
  };

  // 12. Deployment
  const hasDeployment = checkFilePatterns(projectPath, [
    'dockerfile', 'docker-compose', 'vercel.json', 'netlify.toml',
    '.github/workflows', 'fly.toml', 'railway.json',
  ]);
  
  scores['12-deployment'] = {
    exists: hasDeployment,
    score: hasDeployment ? 70 : 0,
    issues: hasDeployment ? [] : ['No deployment configuration detected'],
    suggestions: hasDeployment ? ['Add health checks', 'Verify rollback capability'] : ['Set up CI/CD'],
  };

  // Calculate overall
  const scoreValues = Object.values(scores).map(s => s.score);
  const overall = Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length);

  // Determine level
  const existsCounts = Object.values(scores).filter(s => s.exists).length;
  let level: 'functional' | 'integrated' | 'protected' | 'production';
  if (existsCounts >= 11) {
    level = 'production';
  } else if (existsCounts >= 8) {
    level = 'protected';
  } else if (existsCounts >= 5) {
    level = 'integrated';
  } else {
    level = 'functional';
  }

  return { scores, overall, level };
}
