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
  unstuck,
  unstuckSchema,
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

// GROW phase tools - deployment, retrospectives, cycles
export {
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
  recordCost,
} from './grow.js';

// Completeness model - 12-category scoring
export {
  checkCompleteness,
  completenessSchema,
} from './completeness.js';

// Validation pipeline - enforce gates before phase advance
export {
  validateGates,
  validateGatesSchema,
  enforceGatesAndAdvance,
  enforceGatesSchema,
} from './validate.js';

// Example documents for coaching
export {
  showExample,
  showExampleSchema,
  listExamples,
} from './examples.js';

// Document validation - quality gates for planning docs
export {
  validateBrainlift,
  validateBrainliftSchema,
  validatePRD,
  validatePRDSchema,
  validateGameplan,
  validateGameplanSchema,
  validatePlanningDocs,
  validatePlanningDocsSchema,
} from './validate-docs.js';

// Hotfix mode - emergency bug fixes
export {
  startHotfix,
  startHotfixSchema,
  completeHotfix,
  completeHotfixSchema,
  cancelHotfix,
  cancelHotfixSchema,
  getHotfixStatus,
  getHotfixStatusSchema,
} from './hotfix.js';

// Tech debt cleanup
export {
  scanDebt,
  scanDebtSchema,
  getCleanupSuggestion,
  getCleanupSuggestionSchema,
} from './cleanup.js';

// Project type detection and scope tracking
export {
  detectProjectType,
  detectProjectTypeSchema,
  checkScopeCreep,
  checkScopeCreepSchema,
  setScopeBaseline,
  setScopeBaselineSchema,
} from './scope.js';
