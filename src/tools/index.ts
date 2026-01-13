// Phase tools
export {
  startProject,
  startProjectSchema,
  getPhase,
  getPhaseSchema,
  setPhaseManually,
  setPhaseSchema,
} from './phase.js';

// Audit tool
export { audit, auditSchema } from './audit.js';

// Docs check tool
export { checkDocs, checkDocsSchema } from './docs.js';

// Oneshot tool
export { constructOneshot, oneshotSchema } from './oneshot.js';

// Tornado tool
export { triggerTornado, tornadoSchema } from './tornado.js';

// Horizon tool
export { expandHorizon, horizonSchema } from './horizon.js';

// AI-powered analyze tools
export {
  analyze,
  analyzeSchema,
  suggestPrompt,
  suggestPromptSchema,
  advancePhase,
  advancePhaseSchema,
} from './analyze.js';

// Journal tools - save full conversations for context
export {
  saveToJournal,
  saveJournalSchema,
  getJournalEntries,
  getJournalSchema,
  searchJournal,
  searchJournalSchema,
} from './journal.js';

// Verification and smart suggestion tools
export {
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
} from './verify.js';

// Provider/config tools
export {
  getProvider,
  getProviderSchema,
  setProvider,
  setProviderSchema,
  setApiKey,
  setApiKeySchema,
  listProviders,
  listProvidersSchema,
} from './config.js';
