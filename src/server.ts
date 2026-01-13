import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  startProject,
  startProjectSchema,
  getPhase,
  getPhaseSchema,
  setPhaseManually,
  setPhaseSchema,
  audit,
  auditSchema,
  checkDocs,
  checkDocsSchema,
  constructOneshot,
  oneshotSchema,
  triggerTornado,
  tornadoSchema,
  expandHorizon,
  horizonSchema,
} from './tools/index.js';
import { registerAllPrompts } from './prompts/index.js';
import { registerAllResources } from './resources/index.js';
import { logger } from './logger.js';

export function createServer(): McpServer {
  logger.info('Creating Midas MCP server');
  
  const server = new McpServer({
    name: 'midas',
    version: '1.0.0',
  });

  // Register tools with logging wrapper
  const wrapTool = <T, R>(name: string, fn: (args: T) => R) => {
    return async (args: T) => {
      logger.tool(name, args as Record<string, unknown>);
      try {
        const result = fn(args);
        logger.debug(`Tool ${name} completed`);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        logger.error(`Tool ${name} failed`, error);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(error) }) }],
          isError: true,
        };
      }
    };
  };

  server.tool(
    'midas_start_project',
    'Initialize a new project with Eagle Sight phase and create docs templates',
    startProjectSchema.shape,
    wrapTool('midas_start_project', startProject)
  );

  server.tool(
    'midas_get_phase',
    'Get current phase and recommended next steps',
    getPhaseSchema.shape,
    wrapTool('midas_get_phase', getPhase)
  );

  server.tool(
    'midas_set_phase',
    'Manually set the current phase',
    setPhaseSchema.shape,
    wrapTool('midas_set_phase', setPhaseManually)
  );

  server.tool(
    'midas_audit',
    'Audit project against 12 ingredients of production readiness',
    auditSchema.shape,
    wrapTool('midas_audit', audit)
  );

  server.tool(
    'midas_check_docs',
    'Verify Eagle Sight docs (brainlift, prd, gameplan) exist and are complete',
    checkDocsSchema.shape,
    wrapTool('midas_check_docs', checkDocs)
  );

  server.tool(
    'midas_oneshot',
    'Construct a Oneshot retry prompt from original prompt and error',
    oneshotSchema.shape,
    wrapTool('midas_oneshot', constructOneshot)
  );

  server.tool(
    'midas_tornado',
    'Guide through the Tornado cycle (Research + Logs + Tests)',
    tornadoSchema.shape,
    wrapTool('midas_tornado', triggerTornado)
  );

  server.tool(
    'midas_horizon',
    'Expand horizontal context when AI output does not fit',
    horizonSchema.shape,
    wrapTool('midas_horizon', expandHorizon)
  );

  // Register prompts
  registerAllPrompts(server);
  logger.debug('Registered prompts');

  // Register resources
  registerAllResources(server);
  logger.debug('Registered resources');

  logger.info('Midas MCP server ready', { tools: 8, prompts: 17, resources: 5 });
  return server;
}
