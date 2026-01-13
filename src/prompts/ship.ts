import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerShipPrompts(server: McpServer): void {
  // Pre-deployment checklist
  server.prompt(
    'pre_deploy_checklist',
    'Verify everything is ready for production deployment',
    { environment: z.string().optional().describe('Target environment (staging/production)') },
    (args) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Pre-deployment checklist for ${args.environment || 'production'}:

1. **Code Review**
   - All PRs merged and approved
   - No TODO comments in production paths
   - Console.logs removed

2. **Testing**
   - All tests passing
   - E2E tests cover critical flows
   - Load testing completed

3. **Security**
   - Dependencies updated
   - No exposed secrets
   - CORS configured correctly
   - Rate limiting enabled

4. **Environment**
   - Environment variables set
   - Database migrations ready
   - Rollback plan documented

5. **Monitoring**
   - Error tracking configured
   - Health checks working
   - Alerts set up

Go through each item and report status.`,
          },
        },
      ],
    })
  );

  // Deployment review
  server.prompt(
    'deployment_review',
    'Review deployment configuration and CI/CD setup',
    {},
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Review the deployment setup:

1. Read any deployment configs (Dockerfile, docker-compose, vercel.json, etc.)
2. Check CI/CD workflows (.github/workflows, etc.)
3. Verify:
   - Build process is correct
   - Environment variables are handled securely
   - No sensitive data in images/artifacts
   - Health check endpoints exist
   - Rollback mechanism works

4. List any issues or improvements needed.`,
          },
        },
      ],
    })
  );

  // Post-deploy monitoring
  server.prompt(
    'post_deploy_check',
    'Verify deployment is healthy after release',
    {},
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Post-deployment health check:

1. **Immediate (first 5 min)**
   - Health endpoint returning 200
   - No spike in error rates
   - Key user flows working

2. **Short-term (first hour)**
   - Monitor error tracking dashboard
   - Check database connection pool
   - Verify background jobs running

3. **Ongoing**
   - Compare metrics to baseline
   - Watch for memory leaks
   - Monitor response times

Report any anomalies and recommend next steps.`,
          },
        },
      ],
    })
  );
}
