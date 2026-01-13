# Deployment Checklist

Pre-flight checks, environment validation, and rollback procedures.

## Pre-Flight Checklist

Before every deployment, verify:

### 1. Code Quality Gates

```bash
# All must pass before deploy
npm run build          # TypeScript compiles
npm run test           # Tests pass
npm run lint           # No lint errors
```

### 2. Security Audit

- [ ] No API keys in code (`git log -p | grep -i "api_key\|secret\|password"`)
- [ ] Dependencies checked (`npm audit`)
- [ ] Sensitive files in `.gitignore`
- [ ] Rate limiting configured
- [ ] Input validation on all endpoints

### 3. Environment Variables

Required for production:

```bash
# Core
ANTHROPIC_API_KEY=     # Required for AI features
NODE_ENV=production    # Must be 'production'

# Optional providers
OPENAI_API_KEY=        # If using OpenAI
GOOGLE_API_KEY=        # If using Gemini
XAI_API_KEY=           # If using Grok
```

Verify with:

```bash
node -e "require('./dist/config.js').getApiKey() ? console.log('OK') : console.error('MISSING')"
```

### 4. Version Bump

```bash
# Bump version appropriately
npm version patch  # Bug fixes
npm version minor  # New features
npm version major  # Breaking changes

# Verify
cat package.json | grep version
```

### 5. Changelog Updated

Ensure `CHANGELOG.md` reflects:

- What changed
- Breaking changes (if any)
- Migration steps (if needed)

## Deployment Steps

### NPM Publish

```bash
# 1. Verify you're logged in
npm whoami

# 2. Dry run first
npm publish --dry-run

# 3. Publish
npm publish

# 4. Verify on npm
npm view midas-mcp
```

### Post-Deploy Verification

```bash
# Install fresh and test
npm install -g midas-mcp@latest
midas-mcp --version
midas-mcp status
```

## Rollback Procedures

### NPM Rollback

```bash
# Unpublish broken version (within 72 hours only)
npm unpublish midas-mcp@x.y.z

# Or deprecate
npm deprecate midas-mcp@x.y.z "Critical bug, use x.y.z-1"
```

### Git Rollback

```bash
# Revert to last known good
git revert HEAD
git push

# Or hard reset (destructive)
git reset --hard <last-good-commit>
git push --force
```

## Health Checks

### Local Validation

```bash
# Check MCP server starts
node dist/index.js &
PID=$!
sleep 2
kill $PID 2>/dev/null && echo "Server started OK" || echo "FAILED"
```

### TUI Validation

```bash
# Check TUI renders
echo 'q' | timeout 5 midas-mcp tui && echo "TUI OK" || echo "TUI FAILED"
```

## Monitoring Integration

### Error Tracking (Sentry)

If configured:

```typescript
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: require('../package.json').version,
});
```

### Metrics Export (OpenTelemetry)

```typescript
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('midas-mcp');
const analysisCounter = meter.createCounter('midas.analysis.count');
const analysisLatency = meter.createHistogram('midas.analysis.latency');
```

## Canary Deployment

For critical updates:

1. Publish as `next` tag: `npm publish --tag next`
2. Test on staging projects
3. Monitor for 24 hours
4. Promote: `npm dist-tag add midas-mcp@x.y.z latest`

## Emergency Procedures

### Critical Bug in Production

1. **Stop the bleeding**: Deprecate broken version immediately
2. **Communicate**: Update README with known issue
3. **Fix**: Create hotfix branch, minimal change only
4. **Test**: Full test suite + manual verification
5. **Deploy**: Publish patch version
6. **Verify**: Monitor for 1 hour post-deploy
7. **Retrospect**: Document what went wrong

### API Key Leaked

1. Immediately rotate the key at provider dashboard
2. Update `~/.midas/config.json` with new key
3. Audit git history: `git filter-branch` or BFG
4. Force push cleaned history
5. Notify affected users if applicable
