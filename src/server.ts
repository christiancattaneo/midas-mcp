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

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'midas',
    version: '1.0.0',
  });

  // Register tools
  server.tool(
    'midas_start_project',
    'Initialize a new project with Eagle Sight phase and create docs templates',
    startProjectSchema.shape,
    async (args) => {
      const result = startProject(args as Parameters<typeof startProject>[0]);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    'midas_get_phase',
    'Get current phase and recommended next steps',
    getPhaseSchema.shape,
    async (args) => {
      const result = getPhase(args as Parameters<typeof getPhase>[0]);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    'midas_set_phase',
    'Manually set the current phase',
    setPhaseSchema.shape,
    async (args) => {
      const result = setPhaseManually(args as Parameters<typeof setPhaseManually>[0]);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    'midas_audit',
    'Audit project against 12 ingredients of production readiness',
    auditSchema.shape,
    async (args) => {
      const result = audit(args as Parameters<typeof audit>[0]);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    'midas_check_docs',
    'Verify Eagle Sight docs (brainlift, prd, gameplan) exist and are complete',
    checkDocsSchema.shape,
    async (args) => {
      const result = checkDocs(args as Parameters<typeof checkDocs>[0]);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    'midas_oneshot',
    'Construct a Oneshot retry prompt from original prompt and error',
    oneshotSchema.shape,
    async (args) => {
      const result = constructOneshot(args as Parameters<typeof constructOneshot>[0]);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    'midas_tornado',
    'Guide through the Tornado cycle (Research + Logs + Tests)',
    tornadoSchema.shape,
    async (args) => {
      const result = triggerTornado(args as Parameters<typeof triggerTornado>[0]);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    'midas_horizon',
    'Expand horizontal context when AI output does not fit',
    horizonSchema.shape,
    async (args) => {
      const result = expandHorizon(args as Parameters<typeof expandHorizon>[0]);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Register prompts
  registerAllPrompts(server);

  // Register resources
  registerAllResources(server);

  return server;
}
