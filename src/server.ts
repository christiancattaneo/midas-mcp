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
  // Verification and smart suggestion tools
  verify,
  verifySchema,
  smartSuggest,
  smartSuggestSchema,
  setTask,
  setTaskSchema,
  updateTask,
  updateTaskSchema,
  clearTask,
  clearTaskSchema,
  recordErrorTool,
  recordErrorSchema,
  recordFix,
  recordFixSchema,
  getStuck,
  getStuckSchema,
  unstuck,
  unstuckSchema,
  // Provider config tools
  getProvider,
  getProviderSchema,
  setProvider,
  setProviderSchema,
  setApiKey,
  setApiKeySchema,
  listProviders,
  listProvidersSchema,
  // GROW phase tools
  verifyDeploy,
  verifyDeploySchema,
  generateChangelog,
  changelogSchema,
  saveRetrospective,
  retrospectiveSchema,
  startNextCycle,
  nextCycleSchema,
  archiveCycle,
  archiveCycleSchema,
  getCostReport,
  costReportSchema,
  // Completeness model
  checkCompleteness,
  completenessSchema,
  // Validation pipeline
  validateGates,
  validateGatesSchema,
  enforceGatesAndAdvance,
  enforceGatesSchema,
  // Examples
  showExample,
  showExampleSchema,
  // Document validation
  validateBrainlift,
  validateBrainliftSchema,
  validatePRD,
  validatePRDSchema,
  validateGameplan,
  validateGameplanSchema,
  validatePlanningDocs,
  validatePlanningDocsSchema,
  // Hotfix mode
  startHotfix,
  startHotfixSchema,
  completeHotfix,
  completeHotfixSchema,
  cancelHotfix,
  cancelHotfixSchema,
  getHotfixStatus,
  getHotfixStatusSchema,
  // Tech debt cleanup
  scanDebt,
  scanDebtSchema,
  getCleanupSuggestion,
  getCleanupSuggestionSchema,
  // Project type and scope tracking
  detectProjectType,
  detectProjectTypeSchema,
  checkScopeCreep,
  checkScopeCreepSchema,
  setScopeBaseline,
  setScopeBaselineSchema,
  // Preflight - before-you-ship requirements
  preflightCheck,
  preflightCheckSchema,
  preflightUpdate,
  preflightUpdateSchema,
  // Gameplan progress tracking
  analyzeGameplanTool,
  analyzeGameplanSchema,
  getGameplanProgressTool,
  getProgressSchema,
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
    'Initialize a new project with Plan phase and create docs templates',
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
    'Verify planning docs (brainlift, prd, gameplan) exist and are complete',
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

  // Verification and smart suggestion tools
  server.tool(
    'midas_verify',
    'Run verification gates: build, test, lint. Returns pass/fail status and auto-advances phase if all pass.',
    verifySchema.shape,
    wrapTool('midas_verify', verify)
  );

  server.tool(
    'midas_smart_suggest',
    'Get an intelligent prompt suggestion based on current gates, errors, and phase. Prioritizes fixing broken builds/tests.',
    smartSuggestSchema.shape,
    wrapTool('midas_smart_suggest', smartSuggest)
  );

  server.tool(
    'midas_set_task',
    'Set the current task focus. Helps Midas track what you are working on.',
    setTaskSchema.shape,
    wrapTool('midas_set_task', setTask)
  );

  server.tool(
    'midas_update_task',
    'Update the current task phase (plan, implement, verify, reflect).',
    updateTaskSchema.shape,
    wrapTool('midas_update_task', updateTask)
  );

  server.tool(
    'midas_clear_task',
    'Clear the current task focus when done.',
    clearTaskSchema.shape,
    wrapTool('midas_clear_task', clearTask)
  );

  server.tool(
    'midas_record_error',
    'Record an error for tracking. Helps Midas remember what errors occurred and suggest Tornado when stuck.',
    recordErrorSchema.shape,
    wrapTool('midas_record_error', recordErrorTool)
  );

  server.tool(
    'midas_record_fix',
    'Record a fix attempt for an error. Helps Midas track what approaches have been tried.',
    recordFixSchema.shape,
    wrapTool('midas_record_fix', recordFix)
  );

  server.tool(
    'midas_get_stuck',
    'Get errors that have had multiple failed fix attempts. These are candidates for Tornado debugging.',
    getStuckSchema.shape,
    wrapTool('midas_get_stuck', getStuck)
  );

  server.tool(
    'midas_unstuck',
    'Get intervention options when stuck: diagnose, simplify, pivot, or take a break. Returns guidance and suggested prompts.',
    unstuckSchema.shape,
    wrapTool('midas_unstuck', unstuck)
  );

  // Provider configuration tools
  server.tool(
    'midas_get_provider',
    'Get the current AI provider (anthropic, openai, google, xai) and its capabilities.',
    getProviderSchema.shape,
    wrapTool('midas_get_provider', getProvider)
  );

  server.tool(
    'midas_set_provider',
    'Switch AI provider. Options: anthropic (Claude Opus 4), openai (GPT-4o), google (Gemini 2.0), xai (Grok 2).',
    setProviderSchema.shape,
    wrapTool('midas_set_provider', setProvider)
  );

  server.tool(
    'midas_set_api_key',
    'Set API key for a provider. Keys are stored in ~/.midas/config.json.',
    setApiKeySchema.shape,
    wrapTool('midas_set_api_key', setApiKey)
  );

  server.tool(
    'midas_list_providers',
    'List all available AI providers with their capabilities and configuration status.',
    listProvidersSchema.shape,
    wrapTool('midas_list_providers', listProviders)
  );

  // GROW phase tools
  server.tool(
    'midas_verify_deploy',
    'Pre-flight deployment checks: build, test, lint, security audit, git status.',
    verifyDeploySchema.shape,
    wrapTool('midas_verify_deploy', verifyDeploy)
  );

  server.tool(
    'midas_changelog',
    'Generate changelog from git commits. Groups by conventional commit type.',
    changelogSchema.shape,
    wrapTool('midas_changelog', generateChangelog)
  );

  server.tool(
    'midas_retrospective',
    'Record a sprint/cycle retrospective. Saves what worked, what didn\'t, learnings.',
    retrospectiveSchema.shape,
    wrapTool('midas_retrospective', saveRetrospective)
  );

  server.tool(
    'midas_next_cycle',
    'Start a new development cycle with hypothesis, scope, and success metrics.',
    nextCycleSchema.shape,
    wrapTool('midas_next_cycle', startNextCycle)
  );

  server.tool(
    'midas_archive_cycle',
    'Archive the current cycle to history. Preserves retrospective and metrics.',
    archiveCycleSchema.shape,
    wrapTool('midas_archive_cycle', archiveCycle)
  );

  server.tool(
    'midas_cost_report',
    'Get API cost report for the project. Shows breakdown by provider and projected costs.',
    costReportSchema.shape,
    wrapTool('midas_cost_report', getCostReport)
  );

  // Completeness model
  server.tool(
    'midas_completeness',
    '12-category production readiness score: testing, security, docs, monitoring, CI/CD, etc.',
    completenessSchema.shape,
    wrapTool('midas_completeness', checkCompleteness)
  );

  // Validation pipeline
  server.tool(
    'midas_validate_gates',
    'Run validation gates: compile, lint, test. Returns pass/fail for each.',
    validateGatesSchema.shape,
    wrapTool('midas_validate_gates', validateGates)
  );

  server.tool(
    'midas_enforce_advance',
    'Advance phase only if gates pass. Blocks BUILD->SHIP if tests fail.',
    enforceGatesSchema.shape,
    wrapTool('midas_enforce_advance', enforceGatesAndAdvance)
  );

  // Example documents for coaching
  server.tool(
    'midas_show_example',
    'Show example document for a planning step (brainlift, prd, gameplan). Helps users understand what good artifacts look like.',
    showExampleSchema.shape,
    wrapTool('midas_show_example', showExample)
  );

  // Document validation - quality gates for planning docs
  server.tool(
    'midas_validate_brainlift',
    'Validate brainlift.md has required sections: problem, audience, unique context.',
    validateBrainliftSchema.shape,
    wrapTool('midas_validate_brainlift', validateBrainlift)
  );

  server.tool(
    'midas_validate_prd',
    'Validate prd.md has required sections: goals, non-goals, requirements.',
    validatePRDSchema.shape,
    wrapTool('midas_validate_prd', validatePRD)
  );

  server.tool(
    'midas_validate_gameplan',
    'Validate gameplan.md has required sections: tech stack, ordered tasks.',
    validateGameplanSchema.shape,
    wrapTool('midas_validate_gameplan', validateGameplan)
  );

  server.tool(
    'midas_validate_planning',
    'Validate all planning docs. Returns overall score and blockers. Use before advancing from PLAN to BUILD.',
    validatePlanningDocsSchema.shape,
    wrapTool('midas_validate_planning', validatePlanningDocs)
  );

  // Hotfix mode - emergency bug fixes
  server.tool(
    'midas_start_hotfix',
    'Start hotfix mode for emergency bug fixes. Saves current phase and jumps to BUILD/DEBUG.',
    startHotfixSchema.shape,
    wrapTool('midas_start_hotfix', startHotfix)
  );

  server.tool(
    'midas_complete_hotfix',
    'Complete hotfix mode and return to previous phase.',
    completeHotfixSchema.shape,
    wrapTool('midas_complete_hotfix', completeHotfix)
  );

  server.tool(
    'midas_cancel_hotfix',
    'Cancel hotfix mode and return to previous phase without completion.',
    cancelHotfixSchema.shape,
    wrapTool('midas_cancel_hotfix', cancelHotfix)
  );

  server.tool(
    'midas_hotfix_status',
    'Check if currently in hotfix mode and get details.',
    getHotfixStatusSchema.shape,
    wrapTool('midas_hotfix_status', getHotfixStatus)
  );

  // Tech debt cleanup
  server.tool(
    'midas_scan_debt',
    'Scan codebase for TODO/FIXME/HACK comments, prioritized by file churn.',
    scanDebtSchema.shape,
    wrapTool('midas_scan_debt', scanDebt)
  );

  server.tool(
    'midas_cleanup_suggestion',
    'Get a cleanup-focused suggestion for refactoring (not feature building).',
    getCleanupSuggestionSchema.shape,
    wrapTool('midas_cleanup_suggestion', getCleanupSuggestion)
  );

  // Project type detection and scope tracking
  server.tool(
    'midas_detect_project_type',
    'Detect project type (cli, library, web-app, api, mobile) from config files.',
    detectProjectTypeSchema.shape,
    wrapTool('midas_detect_project_type', detectProjectType)
  );

  server.tool(
    'midas_check_scope_creep',
    'Check if project scope has grown beyond initial PRD baseline.',
    checkScopeCreepSchema.shape,
    wrapTool('midas_check_scope_creep', checkScopeCreep)
  );

  server.tool(
    'midas_set_scope_baseline',
    'Set current project size as the baseline for scope tracking.',
    setScopeBaselineSchema.shape,
    wrapTool('midas_set_scope_baseline', setScopeBaseline)
  );

  server.tool(
    'midas_preflight',
    'Get before-you-ship requirements based on project profile. Returns prompts to generate docs like privacy policy, terms, etc.',
    preflightCheckSchema.shape,
    wrapTool('midas_preflight', preflightCheck)
  );

  server.tool(
    'midas_preflight_update',
    'Update the status of a preflight check (mark as completed or skipped). Persisted between sessions.',
    preflightUpdateSchema.shape,
    wrapTool('midas_preflight_update', preflightUpdate)
  );

  // Gameplan progress tracking
  server.tool(
    'midas_gameplan_analyze',
    'Analyze gameplan progress. Parses tasks from gameplan.md, cross-references with code, detects what is implemented vs missing.',
    analyzeGameplanSchema.shape,
    wrapTool('midas_gameplan_analyze', analyzeGameplanTool)
  );

  server.tool(
    'midas_gameplan_progress',
    'Get quick gameplan progress summary. Shows documented vs actual progress percentage.',
    getProgressSchema.shape,
    wrapTool('midas_gameplan_progress', getGameplanProgressTool)
  );

  // Register prompts
  registerAllPrompts(server);
  logger.debug('Registered prompts');

  // Register resources
  registerAllResources(server);
  logger.debug('Registered resources');

  logger.info('Midas MCP server ready', { tools: 35, prompts: 20, resources: 5 });
  return server;
}
