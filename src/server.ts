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
  analyze,
  analyzeSchema,
  suggestPrompt,
  suggestPromptSchema,
  advancePhase,
  advancePhaseSchema,
  saveToJournal,
  saveJournalSchema,
  getJournalEntries,
  getJournalSchema,
  searchJournal,
  searchJournalSchema,
} from './tools/index.js';
import { registerAllPrompts } from './prompts/index.js';
import { registerAllResources } from './resources/index.js';
import { logger } from './logger.js';
import { trackToolCall } from './tracker.js';
import { logEvent } from './events.js';

export function createServer(): McpServer {
  logger.info('Creating Midas MCP server');
  
  const server = new McpServer({
    name: 'midas',
    version: '1.0.0',
  });

  // Register tools with logging wrapper
  const wrapTool = <T, R>(name: string, fn: (args: T) => R) => {
    return async (args: T) => {
      const projectPath = process.cwd();
      logger.tool(name, args as Record<string, unknown>);
      
      // Track tool call for activity monitoring AND event log (for TUI sync)
      try {
        trackToolCall(projectPath, name, args as Record<string, unknown>);
        logEvent(projectPath, { type: 'tool_called', tool: name, data: args as Record<string, unknown> });
      } catch {}
      
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

  // Async tool wrapper for analyze (which is async)
  const wrapAsyncTool = <T, R>(name: string, fn: (args: T) => Promise<R>) => {
    return async (args: T) => {
      const projectPath = process.cwd();
      logger.tool(name, args as Record<string, unknown>);
      
      // Track tool call for activity monitoring AND event log (for TUI sync)
      try {
        trackToolCall(projectPath, name, args as Record<string, unknown>);
        logEvent(projectPath, { type: 'tool_called', tool: name, data: args as Record<string, unknown> });
      } catch {}
      
      try {
        const result = await fn(args);
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
    'midas_analyze',
    'AI-powered project analysis - determines current phase, what is done, and suggests next steps',
    analyzeSchema.shape,
    wrapAsyncTool('midas_analyze', analyze)
  );

  server.tool(
    'midas_suggest_prompt',
    'Get a context-aware prompt suggestion for the current phase and step',
    suggestPromptSchema.shape,
    wrapTool('midas_suggest_prompt', suggestPrompt)
  );

  server.tool(
    'midas_advance_phase',
    'Advance to the next step in the development lifecycle',
    advancePhaseSchema.shape,
    wrapTool('midas_advance_phase', advancePhase)
  );

  // Journal tools - save full conversations for future context
  server.tool(
    'midas_journal_save',
    'Save a full conversation to the project journal. Use this after important discussions, decisions, or implementations to preserve context for future sessions.',
    saveJournalSchema.shape,
    wrapTool('midas_journal_save', saveToJournal)
  );

  server.tool(
    'midas_journal_list',
    'Get recent journal entries to understand project history and past decisions',
    getJournalSchema.shape,
    wrapTool('midas_journal_list', getJournalEntries)
  );

  server.tool(
    'midas_journal_search',
    'Search journal entries for specific topics, decisions, or implementations',
    searchJournalSchema.shape,
    wrapTool('midas_journal_search', searchJournal)
  );

  // Register prompts
  registerAllPrompts(server);
  logger.debug('Registered prompts');

  // Register resources
  registerAllResources(server);
  logger.debug('Registered resources');

  logger.info('Midas MCP server ready', { tools: 14, prompts: 17, resources: 5 });
  return server;
}
