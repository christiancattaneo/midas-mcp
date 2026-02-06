/**
 * Preflight Check Module
 * 
 * Analyzes project docs to infer what requirements apply,
 * categorizes them by what AI can/cannot do,
 * and generates context-aware prompts for Cursor.
 */

import { existsSync, readFileSync, mkdirSync } from 'fs';
import writeFileAtomic from 'write-file-atomic';
import { join } from 'path';
import { sanitizePath } from './security.js';
import { discoverDocsSync, getPlanningContext } from './docs-discovery.js';

// ============================================================================
// PERSISTENCE
// ============================================================================

const MIDAS_DIR = '.midas';
const PREFLIGHT_STATE_FILE = 'preflight-checks.json';

export type PreflightCheckStatus = 'pending' | 'completed' | 'skipped';

export interface PersistedCheckState {
  status: PreflightCheckStatus;
  updatedAt: string;
  skippedReason?: string;  // Why user skipped (optional)
}

interface PreflightStateFile {
  checkStates: Record<string, PersistedCheckState>;
  lastProfileHash: string;  // Detect when project profile changes
  viewCount?: number;       // How many times preflight checks have been viewed
}

function getPreflightStatePath(projectPath: string): string {
  return join(projectPath, MIDAS_DIR, PREFLIGHT_STATE_FILE);
}

export function loadPreflightState(projectPath: string): PreflightStateFile {
  const path = getPreflightStatePath(projectPath);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return { checkStates: {}, lastProfileHash: '' };
    }
  }
  // Try legacy reality-checks.json for backward compatibility
  const legacyPath = join(projectPath, MIDAS_DIR, 'reality-checks.json');
  if (existsSync(legacyPath)) {
    try {
      return JSON.parse(readFileSync(legacyPath, 'utf-8'));
    } catch {
      return { checkStates: {}, lastProfileHash: '' };
    }
  }
  return { checkStates: {}, lastProfileHash: '' };
}

function savePreflightState(projectPath: string, state: PreflightStateFile): void {
  const dir = join(projectPath, MIDAS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Use atomic write to prevent corruption from concurrent access
  writeFileAtomic.sync(getPreflightStatePath(projectPath), JSON.stringify(state, null, 2));
}

function hashProfile(profile: ProjectProfile): string {
  // Simple hash to detect profile changes
  return JSON.stringify(profile).split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0).toString(36);
}

/**
 * Update the status of a preflight check
 */
export function updateCheckStatus(
  projectPath: string,
  checkKey: string,
  status: PreflightCheckStatus,
  skippedReason?: string
): void {
  const safePath = sanitizePath(projectPath);
  const state = loadPreflightState(safePath);
  
  state.checkStates[checkKey] = {
    status,
    updatedAt: new Date().toISOString(),
    ...(skippedReason ? { skippedReason } : {}),
  };
  
  savePreflightState(safePath, state);
}

/**
 * Get the persisted status for a check
 */
export function getCheckStatus(projectPath: string, checkKey: string): PersistedCheckState | undefined {
  const safePath = sanitizePath(projectPath);
  const state = loadPreflightState(safePath);
  return state.checkStates[checkKey];
}

/**
 * Get all check statuses
 */
export function getAllCheckStatuses(projectPath: string): Record<string, PersistedCheckState> {
  const safePath = sanitizePath(projectPath);
  const state = loadPreflightState(safePath);
  return state.checkStates;
}

/**
 * Reset all check statuses (e.g., when profile changes significantly)
 */
export function resetCheckStatuses(projectPath: string): void {
  const safePath = sanitizePath(projectPath);
  savePreflightState(safePath, { checkStates: {}, lastProfileHash: '' });
}

/**
 * Map of check keys to the expected generated file paths
 */
const EXPECTED_OUTPUTS: Record<string, string[]> = {
  PRIVACY_POLICY: ['docs/privacy-policy.md', 'privacy-policy.md', 'PRIVACY.md'],
  TERMS_OF_SERVICE: ['docs/terms-of-service.md', 'docs/terms.md', 'TERMS.md'],
  COOKIE_POLICY: ['docs/cookie-policy.md'],
  GDPR_COMPLIANCE: ['docs/gdpr-checklist.md', 'docs/gdpr.md'],
  CCPA_COMPLIANCE: ['docs/ccpa-checklist.md'],
  AI_DISCLOSURE: ['docs/ai-disclosure.md', 'AI_DISCLOSURE.md'],
  ACCESSIBILITY: ['docs/accessibility.md', 'docs/a11y.md', 'ACCESSIBILITY.md'],
  DATA_RETENTION: ['docs/data-retention.md'],
  INCIDENT_RESPONSE: ['docs/incident-response.md'],
  OSS_LICENSE: ['LICENSE', 'LICENSE.md', 'docs/license.md'],
  HIPAA_COMPLIANCE: ['docs/hipaa-checklist.md'],
  FERPA_COMPLIANCE: ['docs/ferpa-checklist.md'],
  EU_AI_ACT: ['docs/eu-ai-act-assessment.md'],
  SBOM: ['sbom.json', 'docs/sbom-readme.md'],
  DATA_RESIDENCY: ['docs/data-residency.md'],
};

/**
 * Detect if any expected output files exist and auto-complete checks
 * Returns array of check keys that were auto-completed
 */
export function detectGeneratedDocs(projectPath: string): string[] {
  const safePath = sanitizePath(projectPath);
  const state = loadPreflightState(safePath);
  const autoCompleted: string[] = [];
  
  for (const [checkKey, possibleFiles] of Object.entries(EXPECTED_OUTPUTS)) {
    // Skip if already completed
    if (state.checkStates[checkKey]?.status === 'completed') continue;
    
    // Check if any of the expected files exist
    const fileExists = possibleFiles.some(file => 
      existsSync(join(safePath, file))
    );
    
    if (fileExists) {
      // Auto-complete this check
      state.checkStates[checkKey] = {
        status: 'completed',
        updatedAt: new Date().toISOString(),
      };
      autoCompleted.push(checkKey);
    }
  }
  
  if (autoCompleted.length > 0) {
    savePreflightState(safePath, state);
  }
  
  return autoCompleted;
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Two tiers of AI capability:
 * - ai_assisted: AI can help (draft docs, create checklists, generate code)
 * - manual: Requires real-world action (signup, purchase, certification)
 */
export type PreflightTier = 'ai_assisted' | 'manual';

// Legacy tier mapping for backward compatibility
const TIER_MAPPING: Record<string, PreflightTier> = {
  'generatable': 'ai_assisted',
  'assistable': 'ai_assisted', 
  'human_only': 'manual',
  'ai_assisted': 'ai_assisted',
  'manual': 'manual',
};

export interface PreflightCheck {
  key: string;
  category: string;
  tier: PreflightTier;
  headline: string;
  explanation: string;
  cursorPrompt: string;           // The prompt to copy to Cursor
  humanSteps?: string[];          // For human_only tier
  externalLinks?: string[];       // For human_only tier
  alsoNeeded?: string[];          // For assistable tier - what still needs human
  priority: 'critical' | 'high' | 'medium' | 'low';
  triggeredBy: string;            // Why this check applies (e.g., "Found 'payment' in PRD")
  // Persisted state
  status: PreflightCheckStatus;
  statusUpdatedAt?: string;
  skippedReason?: string;
}

export interface ProjectProfile {
  // Inferred from docs
  collectsUserData: boolean;
  collectsSensitiveData: boolean;  // health, financial, biometric
  hasUnder13Users: boolean;
  targetsEU: boolean;
  targetsCalifornia: boolean;
  hasPayments: boolean;
  hasSubscriptions: boolean;
  hasUserContent: boolean;         // user-generated content
  usesAI: boolean;
  aiMakesDecisions: boolean;       // consequential AI decisions
  isOpenSource: boolean;
  targetAudience: string[];        // 'students', 'enterprise', 'developers'
  businessModel: string;           // 'free', 'freemium', 'paid', 'b2b'
  industry: string[];              // 'healthcare', 'finance', 'education'
}

export interface PreflightResult {
  profile: ProjectProfile;
  checks: PreflightCheck[];
  summary: {
    total: number;
    critical: number;
    aiAssisted: number;    // AI can help with these
    manual: number;        // User must do these manually
    // Status counts
    pending: number;
    completed: number;
    skipped: number;
  };
  // Progressive disclosure
  totalAvailable?: number;  // All checks before filtering for first session
  isFirstSession?: boolean; // True if first or second view
}

// ============================================================================
// PREFLIGHT CHECK DEFINITIONS
// ============================================================================

// Static definition type - excludes runtime fields (cursorPrompt, status, triggeredBy)
type PreflightCheckDefinition = Omit<PreflightCheck, 'cursorPrompt' | 'status' | 'statusUpdatedAt' | 'skippedReason' | 'triggeredBy'> & { 
  promptTemplate: string; 
  condition: (p: ProjectProfile) => boolean;
  getTriggeredBy?: (p: ProjectProfile) => string;  // Optional - explain why this check applies
};

// Default triggered-by generators based on common profile fields
const DEFAULT_TRIGGERS: Record<string, (p: ProjectProfile) => string> = {
  PRIVACY_POLICY: (p) => p.collectsSensitiveData 
    ? 'Project collects sensitive data (health/financial/biometric)' 
    : 'Project collects user data',
  TERMS_OF_SERVICE: () => 'Public-facing product',
  COOKIE_POLICY: (p) => p.targetsEU ? 'Targets EU users' : 'Collects user data',
  GDPR_COMPLIANCE: (p) => p.targetsEU ? 'Explicitly targets EU users' : 'May have EU users',
  CCPA_COMPLIANCE: () => 'Targets California or US users',
  COPPA_COMPLIANCE: () => 'May have users under 13',
  AI_DISCLOSURE: () => 'Uses AI for decisions or recommendations',
  PAYMENT_SETUP: () => 'Has payment/subscription features',
  STRIPE_INTEGRATION: () => 'Has payment processing',
  APP_STORE: () => 'Distributes via iOS App Store',
  PLAY_STORE: () => 'Distributes via Google Play Store',
  ACCESSIBILITY: () => 'Public-facing product should be accessible',
  DATA_RETENTION: (p) => p.collectsSensitiveData ? 'Handles sensitive data' : 'Collects user data',
  INCIDENT_RESPONSE: () => 'Production system needs incident handling',
  OSS_LICENSE: () => 'Open source project needs license',
  HIPAA_COMPLIANCE: () => 'Healthcare industry + collects user data',
  FERPA_COMPLIANCE: () => 'Education industry + collects student data',
  EU_AI_ACT: (p) => p.targetsEU 
    ? 'AI system targeting EU users' 
    : 'AI system in regulated industry (healthcare/education/finance)',
  SBOM: () => 'Enterprise/finance audience expects supply chain transparency',
  DATA_RESIDENCY: (p) => p.targetsEU 
    ? 'EU users require data residency documentation (GDPR)'
    : 'Enterprise customers require data location clarity',
};

const PREFLIGHT_CHECKS: Record<string, PreflightCheckDefinition> = {
  // ✅ GENERATABLE - AI can draft these
  PRIVACY_POLICY: {
    key: 'PRIVACY_POLICY',
    category: 'Legal',
    tier: 'ai_assisted',
    headline: 'You need a Privacy Policy',
    explanation: 'You collect user data. Users need to know what you collect, why, and how to delete it.',
    priority: 'critical',
    promptTemplate: `Read docs/prd.md to understand this project. Then create a privacy policy.

First, identify from the docs:
- What user data is collected
- Why it's collected
- Who the target users are
- The business model

Then create docs/privacy-policy.md with sections:
- What we collect and why
- How we use the data
- Third parties we share with
- Data retention
- User rights (access, correct, delete)
- Contact information

Add at top: "DRAFT - Review with a lawyer before publishing"`,
    condition: (p) => p.collectsUserData,
  },

  TERMS_OF_SERVICE: {
    key: 'TERMS_OF_SERVICE',
    category: 'Legal',
    tier: 'ai_assisted',
    headline: 'You need Terms of Service',
    explanation: 'Any public product needs terms defining the rules of use and liability limits.',
    priority: 'high',
    promptTemplate: `Read docs/prd.md to understand this project. Then create terms of service.

Create docs/terms-of-service.md with sections:
- Acceptance of terms
- Description of service (from what you read)
- User responsibilities
- Prohibited uses
- Intellectual property
- Limitation of liability
- Termination
- Governing law (placeholder for jurisdiction)

Save to docs/terms-of-service.md

Add at the top: "DRAFT - Review with a lawyer before publishing"`,
    condition: (p) => p.collectsUserData || p.hasPayments,
  },

  AI_DISCLOSURE: {
    key: 'AI_DISCLOSURE',
    category: 'Transparency',
    tier: 'ai_assisted',
    headline: 'You need an AI disclosure',
    explanation: 'Users should know when AI is involved and that it can make mistakes.',
    priority: 'high',
    promptTemplate: `Create an AI transparency disclosure for this project.

Based on the PRD, this project uses AI to: {{aiUsage}}

Create a user-friendly disclosure explaining:
- What AI does in this product
- That AI can make mistakes or produce inaccurate results
- How users can report issues or get human help
- Any limitations users should know about

Save to docs/ai-disclosure.md

Also add a brief inline disclosure component/text that can be shown in the UI where AI is used.`,
    condition: (p) => p.usesAI,
  },

  REFUND_POLICY: {
    key: 'REFUND_POLICY',
    category: 'Business',
    tier: 'ai_assisted',
    headline: 'You need a refund policy',
    explanation: 'Paid products need clear refund terms to avoid disputes and chargebacks.',
    priority: 'high',
    promptTemplate: `Create a refund policy for this project.

Business model: {{businessModel}}
Subscription type: {{subscriptionType}}

Include:
- Refund eligibility (time period, conditions)
- How to request a refund
- Processing time
- Exceptions (if any)
- Contact information

Keep it simple and fair - generous refund policies reduce chargebacks.

Save to docs/refund-policy.md`,
    condition: (p) => p.hasPayments,
  },

  CONTENT_POLICY: {
    key: 'CONTENT_POLICY',
    category: 'Trust',
    tier: 'ai_assisted',
    headline: 'You need a content policy',
    explanation: 'User-generated content needs rules about what\'s allowed and how violations are handled.',
    priority: 'high',
    promptTemplate: `Create a content policy for this project.

This product allows users to: {{userContentType}}

Include:
- What content is allowed
- What content is prohibited (hate speech, harassment, illegal content, etc.)
- How violations are reported
- How we handle violations (warning, removal, ban)
- Appeal process

Save to docs/content-policy.md`,
    condition: (p) => p.hasUserContent,
  },

  // ⚠️ ASSISTABLE - AI can create guide, needs professional verification
  GDPR_COMPLIANCE: {
    key: 'GDPR_COMPLIANCE',
    category: 'Compliance',
    tier: 'ai_assisted',
    headline: 'GDPR applies to your product',
    explanation: 'You\'re targeting EU users. You need lawful basis for data processing, user consent, and data rights.',
    priority: 'critical',
    alsoNeeded: ['Legal review of implementation', 'DPA registration if required', 'Data Processing Agreements with vendors'],
    promptTemplate: `Create a GDPR compliance implementation guide for this project.

Based on analysis:
- Data collected: {{dataCollected}}
- Processing purposes: {{processingPurposes}}
- Third parties: {{thirdParties}}

Generate:
1. Data inventory table (what data, why collected, legal basis, retention period)
2. Consent flow requirements (what needs explicit consent vs legitimate interest)
3. User rights implementation checklist:
   - Right to access (export user data)
   - Right to rectification (edit profile)
   - Right to erasure (delete account)
   - Right to portability (download data)
4. Cookie consent requirements
5. Privacy by design checklist

Save to docs/gdpr-implementation.md

Note at top: "This is a technical implementation guide. Legal review required before launch."`,
    condition: (p) => p.targetsEU && p.collectsUserData,
  },

  CCPA_COMPLIANCE: {
    key: 'CCPA_COMPLIANCE',
    category: 'Compliance',
    tier: 'ai_assisted',
    headline: 'CCPA applies to your product',
    explanation: 'California users have rights to know, delete, and opt-out of data sales.',
    priority: 'high',
    alsoNeeded: ['Legal review', '"Do Not Sell" link if applicable'],
    promptTemplate: `Create a CCPA compliance checklist for this project.

Data collected: {{dataCollected}}
California users expected: Yes

Include:
1. Right to know (disclosure of data collected)
2. Right to delete implementation
3. Right to opt-out (if selling data)
4. Non-discrimination requirements
5. Privacy policy updates needed for CCPA

Save to docs/ccpa-checklist.md`,
    condition: (p) => p.targetsCalifornia && p.collectsUserData,
  },

  ACCESSIBILITY: {
    key: 'ACCESSIBILITY',
    category: 'Inclusion',
    tier: 'ai_assisted',
    headline: 'Consider accessibility (WCAG)',
    explanation: 'Making your product accessible helps more users and may be legally required for some customers.',
    priority: 'medium',
    alsoNeeded: ['Actual testing with screen readers', 'User testing with diverse users'],
    promptTemplate: `Create an accessibility checklist and implementation guide for this project.

Review the codebase and create:
1. WCAG 2.1 AA compliance checklist with current status
2. Priority fixes needed (semantic HTML, ARIA labels, color contrast)
3. Keyboard navigation requirements
4. Screen reader compatibility notes
5. Form accessibility (labels, error messages)

For each issue found, provide the fix.

Save checklist to docs/accessibility-checklist.md`,
    condition: (p) => p.targetAudience.some(a => ['enterprise', 'education', 'government'].includes(a)) || p.collectsUserData,
  },

  BIAS_ASSESSMENT: {
    key: 'BIAS_ASSESSMENT',
    category: 'Ethics',
    tier: 'ai_assisted',
    headline: 'AI bias assessment needed',
    explanation: 'AI that makes decisions about people can have unintended bias. Document what you\'ve considered.',
    priority: 'high',
    alsoNeeded: ['Testing with diverse user groups', 'Regular monitoring for bias', 'Human override mechanism'],
    promptTemplate: `Create an AI bias assessment document for this project.

AI is used for: {{aiUsage}}
Decisions affected: {{decisionsAffected}}

Document:
1. What decisions the AI influences
2. Potential sources of bias (training data, model architecture)
3. Protected characteristics that could be affected
4. Mitigation strategies implemented
5. Monitoring plan for detecting bias
6. Human override / appeal mechanism

Save to docs/ai-bias-assessment.md

This is for internal documentation and transparency.`,
    condition: (p) => p.aiMakesDecisions,
  },

  // ❌ HUMAN ONLY - Requires real-world action
  PAYMENT_SETUP: {
    key: 'PAYMENT_SETUP',
    category: 'Business',
    tier: 'manual',
    headline: 'You need payment processing',
    explanation: 'You want to charge users. You need a payment provider account first.',
    priority: 'critical',
    humanSteps: [
      'Go to stripe.com and create an account',
      'Complete business verification (1-3 days)',
      'Set up your bank account for payouts',
      'Get your API keys from the dashboard',
    ],
    externalLinks: ['https://stripe.com', 'https://stripe.com/docs/keys'],
    promptTemplate: `Implement Stripe payment integration for this project.

Requirements from PRD:
- Business model: {{businessModel}}
- Pricing: {{pricing}}

Implement:
1. Stripe SDK setup with environment variables for keys
2. Checkout session creation for {{checkoutType}}
3. Webhook handler for payment events (payment_intent.succeeded, subscription events)
4. Customer portal link for subscription management
5. Subscription status middleware to gate premium features

I have my Stripe API keys ready. Use STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY env vars.`,
    condition: (p) => p.hasPayments,
  },

  BUSINESS_REGISTRATION: {
    key: 'BUSINESS_REGISTRATION',
    category: 'Legal',
    tier: 'manual',
    headline: 'Consider business registration',
    explanation: 'If you\'re making money, you may need a business entity for taxes and liability protection.',
    priority: 'medium',
    humanSteps: [
      'Research business structures (LLC, Corp, Sole Prop)',
      'Register in your state/country',
      'Get an EIN (US) or equivalent tax ID',
      'Open a business bank account',
    ],
    externalLinks: ['https://www.sba.gov/business-guide/launch-your-business/choose-business-structure'],
    promptTemplate: `No code needed. This is a business/legal step.

Once you have your business set up, update your docs:
- Add business name to privacy policy and terms
- Add business address to contact information
- Update payment provider with business details`,
    condition: (p) => p.hasPayments && p.businessModel !== 'free',
  },

  TAX_SETUP: {
    key: 'TAX_SETUP',
    category: 'Business',
    tier: 'manual',
    headline: 'You need tax handling',
    explanation: 'Selling internationally means dealing with VAT, GST, and sales tax. Stripe Tax can help.',
    priority: 'high',
    humanSteps: [
      'Enable Stripe Tax in your Stripe dashboard',
      'Register for VAT/GST in required jurisdictions',
      'Or use a service like Paddle that handles tax for you',
    ],
    externalLinks: ['https://stripe.com/tax', 'https://paddle.com'],
    promptTemplate: `Add Stripe Tax integration to handle VAT/GST automatically.

Enable tax calculation in checkout:
1. Add tax_behavior: 'exclusive' or 'inclusive' to prices
2. Enable automatic_tax in checkout sessions
3. Collect customer address for tax calculation
4. Display tax amounts in checkout UI

See Stripe Tax docs for jurisdiction-specific setup.`,
    condition: (p) => p.hasPayments && p.targetsEU,
  },

  DOMAIN_SSL: {
    key: 'DOMAIN_SSL',
    category: 'Infrastructure',
    tier: 'manual',
    headline: 'You need a domain and SSL',
    explanation: 'To launch publicly, you need a domain name and HTTPS.',
    priority: 'high',
    humanSteps: [
      'Choose and purchase a domain (Namecheap, Cloudflare, etc.)',
      'Point DNS to your hosting provider',
      'SSL is usually automatic with modern hosts (Vercel, Netlify, etc.)',
    ],
    externalLinks: ['https://www.namecheap.com', 'https://www.cloudflare.com'],
    promptTemplate: `No code needed for domain purchase.

Once you have your domain, update:
1. Environment variables with production URL
2. OAuth redirect URLs if using social login
3. Stripe webhook URLs
4. Any hardcoded localhost references`,
    condition: (p) => p.collectsUserData || p.hasPayments,
  },

  APP_STORE: {
    key: 'APP_STORE',
    category: 'Distribution',
    tier: 'manual',
    headline: 'App Store submission needed',
    explanation: 'Mobile apps need App Store / Play Store developer accounts and review.',
    priority: 'critical',
    humanSteps: [
      'Apple: Enroll in Apple Developer Program ($99/year)',
      'Google: Create Google Play Developer account ($25 one-time)',
      'Prepare screenshots, descriptions, privacy policy URL',
      'Submit for review (Apple: 1-7 days, Google: hours to days)',
    ],
    externalLinks: ['https://developer.apple.com/programs/', 'https://play.google.com/console'],
    promptTemplate: `Prepare app store submission materials:

1. Generate app screenshots for required sizes
2. Write app store description (short and long)
3. Create app preview video (optional but recommended)
4. Prepare answers for review questions (data usage, permissions)
5. Ensure privacy policy URL is live and accessible

Check that the app follows platform guidelines before submission.`,
    condition: (p) => p.targetAudience.includes('mobile'),
  },

  COPPA_COMPLIANCE: {
    key: 'COPPA_COMPLIANCE',
    category: 'Compliance',
    tier: 'manual',
    headline: 'COPPA compliance required',
    explanation: 'Users under 13 require parental consent and special data handling.',
    priority: 'critical',
    humanSteps: [
      'Implement age gate / verification',
      'Get verifiable parental consent mechanism',
      'Limit data collection for children',
      'Review with lawyer specializing in children\'s privacy',
    ],
    externalLinks: ['https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions'],
    alsoNeeded: ['Legal review', 'Parental consent mechanism'],
    promptTemplate: `Implement COPPA-compliant age verification:

1. Add age gate before registration
2. If under 13, collect parent email
3. Send parental consent request
4. Only allow account creation after consent verified
5. Limit data collection for child accounts
6. Add easy way for parents to review/delete child data

This requires careful legal review - the FTC enforces COPPA strictly.`,
    condition: (p) => p.hasUnder13Users,
  },

  SOC2: {
    key: 'SOC2',
    category: 'Certification',
    tier: 'manual',
    headline: 'Enterprise customers may require SOC 2',
    explanation: 'B2B/enterprise sales often require SOC 2 certification to prove security practices.',
    priority: 'medium',
    humanSteps: [
      'This is a 6-12 month process costing $20K-100K+',
      'Choose a SOC 2 auditor (Vanta, Drata can help automate)',
      'Implement required controls',
      'Undergo Type I then Type II audit',
    ],
    externalLinks: ['https://vanta.com', 'https://drata.com'],
    promptTemplate: `SOC 2 is a certification process, not code.

However, you can prepare by implementing:
1. Access control (role-based permissions, MFA)
2. Audit logging (who did what, when)
3. Encryption at rest and in transit
4. Incident response procedures
5. Vendor management documentation

Create a security checklist: docs/security-checklist.md`,
    condition: (p) => p.targetAudience.includes('enterprise'),
  },

  // ⚠️ ASSISTABLE - Industry-specific regulations
  HIPAA_COMPLIANCE: {
    key: 'HIPAA_COMPLIANCE',
    category: 'Healthcare',
    tier: 'ai_assisted',
    headline: 'Healthcare data requires HIPAA compliance',
    explanation: 'Handling patient health information in the US requires HIPAA compliance. Violations can cost $100-50K per record.',
    priority: 'critical',
    alsoNeeded: ['Legal review of BAA', 'Security audit', 'Employee HIPAA training'],
    promptTemplate: `Read docs/prd.md. This is a healthcare application that may need HIPAA compliance.

Create docs/hipaa-checklist.md covering:
1. PHI (Protected Health Information) inventory - what health data do we handle?
2. Access controls - minimum necessary access
3. Audit logging - who accessed what PHI, when
4. Encryption - at rest and in transit
5. BAA requirements - list of vendors needing Business Associate Agreements
6. Incident response - breach notification within 60 days

Add warning: "This checklist requires review by a HIPAA compliance officer or healthcare attorney"`,
    condition: (p) => p.industry.includes('healthcare') && p.collectsUserData,
  },

  FERPA_COMPLIANCE: {
    key: 'FERPA_COMPLIANCE',
    category: 'Education',
    tier: 'ai_assisted',
    headline: 'Education records require FERPA compliance',
    explanation: 'Student education records in US schools are protected by FERPA. Violations can result in loss of federal funding.',
    priority: 'critical',
    alsoNeeded: ['School admin approval', 'Parent consent process', 'Annual notification'],
    promptTemplate: `Read docs/prd.md. This is an education application that may need FERPA compliance.

Create docs/ferpa-checklist.md covering:
1. Education records inventory - what student records do we access/store?
2. Consent requirements - when do we need parent/student consent?
3. Directory information policy - what can be disclosed without consent?
4. Access controls - only authorized school officials
5. Record keeping - maintain log of disclosures
6. Annual notification - how schools notify parents/students

Add warning: "This checklist requires review by school legal counsel"`,
    condition: (p) => p.industry.includes('education') && p.collectsUserData,
  },

  EU_AI_ACT: {
    key: 'EU_AI_ACT',
    category: 'AI Regulation',
    tier: 'ai_assisted',
    headline: 'EU AI Act may apply to your AI system',
    explanation: 'The EU AI Act regulates AI systems by risk level. High-risk AI (health, education, employment) has strict requirements.',
    priority: 'high',
    alsoNeeded: ['Risk classification assessment', 'Technical documentation', 'EU representative if non-EU company'],
    promptTemplate: `Read docs/prd.md. This AI system may be subject to the EU AI Act.

Create docs/eu-ai-act-assessment.md covering:
1. AI use case classification - what does the AI decide or recommend?
2. Risk level assessment:
   - Unacceptable (banned): social scoring, subliminal manipulation
   - High-risk: education, employment, credit, healthcare, law enforcement
   - Limited risk: chatbots (requires transparency)
   - Minimal risk: spam filters, games
3. If high-risk, document:
   - Data governance requirements
   - Technical documentation
   - Record keeping
   - Human oversight mechanisms
   - Accuracy, robustness, cybersecurity

Add warning: "This requires legal review for final classification"`,
    condition: (p) => p.usesAI && (p.targetsEU || p.industry.some(i => ['healthcare', 'education', 'finance'].includes(i))),
  },

  SBOM: {
    key: 'SBOM',
    category: 'Supply Chain',
    tier: 'ai_assisted',
    headline: 'Generate a Software Bill of Materials (SBOM)',
    explanation: 'An SBOM lists all dependencies in your software. Required by US Executive Order 14028 for government contractors, increasingly expected by enterprise customers.',
    priority: 'medium',
    promptTemplate: `Generate a Software Bill of Materials (SBOM) for this project.

Run these commands to generate the SBOM:
1. For npm: npx @cyclonedx/cyclonedx-npm --output-file sbom.json
2. Or use: npm sbom --sbom-format cyclonedx

Then create docs/sbom-readme.md explaining:
- What the SBOM contains
- How to regenerate it
- When to update it (after dependency changes)
- License summary of all dependencies

Add the sbom.json generation to CI/CD pipeline.`,
    condition: (p) => p.targetAudience.includes('enterprise') || p.industry.includes('finance'),
  },

  DATA_RESIDENCY: {
    key: 'DATA_RESIDENCY',
    category: 'Compliance',
    tier: 'ai_assisted',
    headline: 'Document data residency requirements',
    explanation: 'If you store data in specific regions, you need to document where data lives. GDPR, data sovereignty laws, and enterprise contracts often require this.',
    priority: 'high',
    alsoNeeded: ['Legal review of data transfer agreements', 'Cloud provider region verification'],
    promptTemplate: `Read docs/prd.md. Create a data residency documentation.

Create docs/data-residency.md covering:
1. Where is user data stored? (AWS region, GCP zone, etc.)
2. Does data cross borders? (US ↔ EU, etc.)
3. What legal basis for cross-border transfers? (SCCs, adequacy decisions)
4. Can customers choose data region? (for enterprise)
5. Where are backups stored?
6. Third-party services and their data locations (Stripe, analytics, etc.)

Add warning: "Verify regions with your cloud provider dashboard"`,
    condition: (p) => p.targetsEU || p.targetAudience.includes('enterprise'),
  },
};

// ============================================================================
// INFERENCE FUNCTIONS
// ============================================================================

/**
 * Infer project profile from PRD and package.json
 */
export function inferProjectProfile(projectPath: string): ProjectProfile {
  const safePath = sanitizePath(projectPath);
  
  const profile: ProjectProfile = {
    collectsUserData: false,
    collectsSensitiveData: false,
    hasUnder13Users: false,
    targetsEU: false,
    targetsCalifornia: false,
    hasPayments: false,
    hasSubscriptions: false,
    hasUserContent: false,
    usesAI: false,
    aiMakesDecisions: false,
    isOpenSource: false,
    targetAudience: [],
    businessModel: 'free',
    industry: [],
  };
  
  // Discover and read all planning docs (intelligent detection)
  const docsResult = discoverDocsSync(safePath);
  let content = getPlanningContext(docsResult).toLowerCase();
  
  // Also check README if not already included
  const readmePath = join(safePath, 'README.md');
  const packagePath = join(safePath, 'package.json');
  
  if (existsSync(readmePath) && !docsResult.readme) {
    content += readFileSync(readmePath, 'utf-8').toLowerCase() + '\n';
  }
  
  // Package.json analysis
  if (existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
      const deps = Object.keys(pkg.dependencies || {}).join(' ').toLowerCase();
      const allContent = JSON.stringify(pkg).toLowerCase();
      
      // Check for payment libraries
      if (deps.includes('stripe') || deps.includes('paypal') || deps.includes('paddle')) {
        profile.hasPayments = true;
      }
      
      // Check for AI libraries
      if (deps.includes('openai') || deps.includes('anthropic') || deps.includes('langchain') || deps.includes('ai')) {
        profile.usesAI = true;
      }
      
      // Check for auth (implies user data)
      if (deps.includes('next-auth') || deps.includes('passport') || deps.includes('clerk') || deps.includes('auth0') || deps.includes('firebase')) {
        profile.collectsUserData = true;
      }
      
      // Open source check
      if (pkg.license && pkg.license !== 'UNLICENSED' && pkg.license !== 'proprietary') {
        profile.isOpenSource = true;
      }
      
      content += allContent + '\n';
    } catch { /* ignore parse errors */ }
  }
  
  // CONSERVATIVE keyword analysis
  // Only trigger on explicit mentions, NOT on broad terms like "global" or "international"
  // AI catch-all will handle nuanced cases
  const keywords = {
    // User data - conservative: must be clear user accounts
    collectsUserData: ['user account', 'login', 'signup', 'sign up', 'register', 'authentication', 'auth'],
    collectsSensitiveData: ['health', 'medical', 'hipaa', 'financial', 'bank account', 'credit card', 'ssn', 'social security', 'biometric', 'fingerprint', 'face id'],
    hasUnder13Users: ['kids', 'children', 'child', 'k-12', 'elementary', 'middle school', 'under 13', 'coppa', 'parental consent'],
    // Geography - VERY conservative: only explicit mentions, not "global"
    targetsEU: ['eu', 'europe', 'european union', 'gdpr', 'germany', 'france', 'spain', 'italy', 'netherlands', 'uk users'],
    targetsCalifornia: ['california', 'ccpa', 'california users'],
    // Business - clear signals only
    hasPayments: ['payment', 'stripe', 'paypal', 'billing', 'checkout', 'purchase', 'monetize', 'pricing page'],
    hasSubscriptions: ['subscription', 'monthly plan', 'yearly plan', 'recurring billing', 'saas'],
    hasUserContent: ['upload', 'user generated', 'ugc', 'user posts', 'comments section', 'community content'],
    // AI - detect AI usage with common patterns
    usesAI: ['ai-powered', 'artificial intelligence', 'machine learning', 'gpt', 'llm', 'claude', 'openai', 'langchain', 'uses ai', 'ai features', 'ai model', 'neural network', 'deep learning', 'genai', 'generative ai'],
    aiMakesDecisions: ['ai decides', 'ai recommends', 'automated decision', 'algorithm determines', 'ai-driven', 'ai generates', 'ai creates'],
  };
  
  for (const [key, terms] of Object.entries(keywords)) {
    if (terms.some(term => content.includes(term))) {
      (profile as unknown as Record<string, boolean>)[key] = true;
    }
  }
  
  // Target audience inference
  if (content.includes('student') || content.includes('education') || content.includes('learn')) {
    profile.targetAudience.push('students');
  }
  if (content.includes('enterprise') || content.includes('b2b') || content.includes('business') || content.includes('team')) {
    profile.targetAudience.push('enterprise');
  }
  if (content.includes('developer') || content.includes('api') || content.includes('sdk')) {
    profile.targetAudience.push('developers');
  }
  if (content.includes('mobile') || content.includes('ios') || content.includes('android') || content.includes('app store')) {
    profile.targetAudience.push('mobile');
  }
  
  // Business model inference
  if (content.includes('free') && !content.includes('freemium') && !content.includes('premium')) {
    profile.businessModel = 'free';
  } else if (content.includes('freemium') || (content.includes('free') && content.includes('premium'))) {
    profile.businessModel = 'freemium';
  } else if (content.includes('subscription') || content.includes('saas')) {
    profile.businessModel = 'subscription';
  } else if (content.includes('enterprise') || content.includes('b2b')) {
    profile.businessModel = 'b2b';
  } else if (profile.hasPayments) {
    profile.businessModel = 'paid';
  }
  
  // Industry inference
  if (content.includes('health') || content.includes('medical') || content.includes('patient')) {
    profile.industry.push('healthcare');
  }
  if (content.includes('finance') || content.includes('banking') || content.includes('invest')) {
    profile.industry.push('finance');
  }
  if (content.includes('education') || content.includes('school') || content.includes('course')) {
    profile.industry.push('education');
  }
  
  return profile;
}

/**
 * Generate context-aware prompt by filling in template variables
 */
function fillPromptTemplate(template: string, profile: ProjectProfile, projectPath: string): string {
  const safePath = sanitizePath(projectPath);
  
  // Use intelligent docs discovery
  const docsResult = discoverDocsSync(safePath);
  const prdContent = docsResult.prd?.content || '';
  
  // Build replacements
  const replacements: Record<string, string> = {
    '{{dataCollected}}': profile.collectsSensitiveData 
      ? 'user accounts, emails, and sensitive data (health/financial)' 
      : profile.collectsUserData 
        ? 'user accounts, emails, preferences' 
        : 'minimal data',
    '{{targetUsers}}': profile.targetAudience.length > 0 
      ? profile.targetAudience.join(', ') 
      : 'general users',
    '{{businessModel}}': profile.businessModel,
    '{{productType}}': profile.usesAI ? 'AI-powered application' : 'web application',
    '{{keyFeatures}}': prdContent.slice(0, 200) || 'See PRD for details',
    '{{aiUsage}}': profile.usesAI ? 'AI features (see PRD for specifics)' : 'No AI',
    '{{processingPurposes}}': 'account management, service delivery, analytics',
    '{{thirdParties}}': profile.hasPayments ? 'Stripe for payments, analytics provider' : 'analytics provider',
    '{{subscriptionType}}': profile.hasSubscriptions ? 'recurring subscription' : 'one-time purchase',
    '{{userContentType}}': 'create and share content',
    '{{decisionsAffected}}': 'recommendations, personalization',
    '{{pricing}}': 'See PRD for pricing details',
    '{{checkoutType}}': profile.hasSubscriptions ? 'subscription' : 'one-time payment',
  };
  
  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
  }
  
  return result;
}

/**
 * Get all applicable preflight checks for a project
 */
export function getPreflightChecks(projectPath: string): PreflightResult {
  const safePath = sanitizePath(projectPath);
  
  // Auto-detect generated docs and mark checks complete (feedback loop)
  detectGeneratedDocs(safePath);
  
  const profile = inferProjectProfile(safePath);
  const checks: PreflightCheck[] = [];
  
  // Load persisted state (after detection so it includes auto-completions)
  const persistedState = loadPreflightState(safePath);
  const checkStates = persistedState.checkStates;
  
  for (const check of Object.values(PREFLIGHT_CHECKS)) {
    if (check.condition(profile)) {
      const cursorPrompt = fillPromptTemplate(check.promptTemplate, profile, safePath);
      const persisted = checkStates[check.key];
      
      // Get triggered-by reason
      const triggeredBy = check.getTriggeredBy 
        ? check.getTriggeredBy(profile)
        : DEFAULT_TRIGGERS[check.key]?.(profile) || 'Inferred from project profile';
      
      checks.push({
        key: check.key,
        category: check.category,
        tier: check.tier,
        headline: check.headline,
        explanation: check.explanation,
        cursorPrompt,
        humanSteps: check.humanSteps,
        externalLinks: check.externalLinks,
        alsoNeeded: check.alsoNeeded,
        priority: check.priority,
        triggeredBy,
        // Add persisted status
        status: persisted?.status || 'pending',
        statusUpdatedAt: persisted?.updatedAt,
        skippedReason: persisted?.skippedReason,
      });
    }
  }
  
  // Sort by priority and tier
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const tierOrder: Record<string, number> = { manual: 0, ai_assisted: 1 };
  
  checks.sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return tierOrder[a.tier] - tierOrder[b.tier];
  });
  
  // Progressive disclosure: first 2 views show only critical + 2 more
  const totalAvailable = checks.length;
  const viewCount = persistedState.viewCount || 0;
  const isFirstSession = viewCount < 2;
  
  // Increment view count
  const newState = { ...persistedState, viewCount: viewCount + 1 };
  savePreflightState(safePath, newState);
  
  // On first sessions, limit to critical + 2 non-critical
  let displayChecks = checks;
  if (isFirstSession && checks.length > 4) {
    const critical = checks.filter(c => c.priority === 'critical');
    const nonCritical = checks.filter(c => c.priority !== 'critical').slice(0, 2);
    displayChecks = [...critical, ...nonCritical];
  }
  
  return {
    profile,
    checks: displayChecks,
    summary: {
      total: displayChecks.length,
      critical: displayChecks.filter(c => c.priority === 'critical').length,
      aiAssisted: displayChecks.filter(c => c.tier === 'ai_assisted').length,
      manual: displayChecks.filter(c => c.tier === 'manual').length,
      pending: displayChecks.filter(c => c.status === 'pending').length,
      completed: displayChecks.filter(c => c.status === 'completed').length,
      skipped: displayChecks.filter(c => c.status === 'skipped').length,
    },
    totalAvailable,
    isFirstSession,
  };
}

// ============================================================================
// AI CATCH-ALL FILTER
// ============================================================================

/**
 * AI-powered preflight check filter
 * 
 * Conservative defaults may miss edge cases. This AI pass:
 * 1. Reviews the full project context
 * 2. Filters out irrelevant checks (e.g., GDPR for US-only app)
 * 3. Adds missing checks based on nuanced understanding
 * 
 * Called only when API key is available, falls back to keyword-based otherwise.
 */
export async function filterChecksWithAI(
  profile: ProjectProfile,
  checks: PreflightCheck[],
  projectPath: string
): Promise<{ filtered: PreflightCheck[]; additions: string[]; removals: string[] }> {
  // Dynamic import to avoid circular dependency
  const { getApiKey } = await import('./config.js');
  const { chat } = await import('./providers.js');
  
  const apiKey = getApiKey();
  if (!apiKey) {
    // No API key - return checks as-is
    return { filtered: checks, additions: [], removals: [] };
  }
  
  const safePath = sanitizePath(projectPath);
  
  // Use intelligent docs discovery
  const docsResult = discoverDocsSync(safePath);
  const docsContent = getPlanningContext(docsResult);
  
  if (!docsContent || docsResult.totalDocsFound === 0) {
    // No docs to analyze - return checks as-is
    return { filtered: checks, additions: [], removals: [] };
  }
  
  // Combined profile validation + check filtering in a single focused prompt
  const systemPrompt = `Compliance check filter. Given project docs and proposed checks, return JSON only:
{"keep":["KEY",...], "remove":["KEY",...], "add":["KEY",...]}
Rules: Remove checks that clearly don't apply. Add missing checks from available list. Be conservative.`;

  // Compact prompt - less tokens, faster response
  const proposed = checks.map(c => c.key).join(',');
  const available = Object.keys(PREFLIGHT_CHECKS).filter(k => !checks.some(c => c.key === k)).join(',');
  
  const prompt = `Docs:\n${docsContent}\n\nProposed: ${proposed}\nAvailable: ${available}\n\nProfile: ${profile.businessModel}, EU:${profile.targetsEU}, AI:${profile.usesAI}, payments:${profile.hasPayments}`;

  try {
    const response = await chat(prompt, {
      systemPrompt,
      maxTokens: 1000,
      useThinking: false,  // Fast response
      timeout: 15000,  // Quick timeout
    });
    
    // Parse response
    let jsonStr = response.content;
    if (response.content.includes('```')) {
      const match = response.content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1];
    }
    
    const result = JSON.parse(jsonStr.trim());
    
    // Filter checks based on AI response
    const keepSet = new Set(result.keep || []);
    const removeSet = new Set(result.remove || []);
    const addKeys = result.add || [];
    
    // Apply filtering
    let filtered = checks.filter(c => {
      // If explicitly removed, remove it
      if (removeSet.has(c.key)) return false;
      // If explicitly kept or not mentioned, keep it (conservative)
      return true;
    });
    
    // Add any checks AI says we're missing
    const safePath = sanitizePath(projectPath);
    const persistedState = loadPreflightState(safePath);
    
    for (const key of addKeys) {
      if (PREFLIGHT_CHECKS[key] && !filtered.some(c => c.key === key)) {
        const check = PREFLIGHT_CHECKS[key];
        const cursorPrompt = fillPromptTemplate(check.promptTemplate, profile, projectPath);
        const persisted = persistedState.checkStates[key];
        
        // Get triggered-by reason (AI-added checks)
        const triggeredBy = check.getTriggeredBy 
          ? check.getTriggeredBy(profile)
          : 'Added by AI analysis of project context';
        
        filtered.push({
          key: check.key,
          category: check.category,
          tier: check.tier,
          headline: check.headline,
          explanation: check.explanation,
          cursorPrompt,
          humanSteps: check.humanSteps,
          externalLinks: check.externalLinks,
          alsoNeeded: check.alsoNeeded,
          priority: check.priority,
          triggeredBy,
          status: persisted?.status || 'pending',
          statusUpdatedAt: persisted?.updatedAt,
          skippedReason: persisted?.skippedReason,
        });
      }
    }
    
    // Re-sort
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const tierOrder: Record<string, number> = { manual: 0, ai_assisted: 1 };
    filtered.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return tierOrder[a.tier] - tierOrder[b.tier];
    });
    
    return {
      filtered,
      additions: addKeys,
      removals: Array.from(removeSet) as string[],
    };
  } catch (error) {
    // AI failed - return original checks (conservative fallback)
    return { filtered: checks, additions: [], removals: [] };
  }
}

/**
 * Get preflight checks with AI filtering (async version)
 * Use this when you want the most accurate checks
 */
export async function getPreflightChecksWithAI(projectPath: string): Promise<PreflightResult & { aiFiltered: boolean }> {
  const basic = getPreflightChecks(projectPath);
  
  try {
    const { filtered, additions, removals } = await filterChecksWithAI(
      basic.profile,
      basic.checks,
      projectPath
    );
    
    return {
      profile: basic.profile,
      checks: filtered,
      summary: {
        total: filtered.length,
        critical: filtered.filter(c => c.priority === 'critical').length,
        aiAssisted: filtered.filter(c => c.tier === 'ai_assisted').length,
        manual: filtered.filter(c => c.tier === 'manual').length,
        pending: filtered.filter(c => c.status === 'pending').length,
        completed: filtered.filter(c => c.status === 'completed').length,
        skipped: filtered.filter(c => c.status === 'skipped').length,
      },
      aiFiltered: additions.length > 0 || removals.length > 0,
    };
  } catch {
    // Fallback to basic checks
    return { ...basic, aiFiltered: false };
  }
}

/**
 * Get tier symbol for display
 */
export function getTierSymbol(tier: PreflightTier): string {
  const mapped = TIER_MAPPING[tier] || tier;
  switch (mapped) {
    case 'ai_assisted': return '🤖';
    case 'manual': return '👤';
    default: return '❓';
  }
}

/**
 * Get tier description
 */
export function getTierDescription(tier: PreflightTier): string {
  const mapped = TIER_MAPPING[tier] || tier;
  switch (mapped) {
    case 'ai_assisted': return 'AI can help with this';
    case 'manual': return 'You need to do this yourself';
    default: return 'Unknown tier';
  }
}

// ============================================================================
// BACKWARD COMPATIBILITY ALIASES
// ============================================================================

// Type aliases for backward compatibility
export type RealityCheck = PreflightCheck;
export type RealityCheckResult = PreflightResult;
export type RealityCheckStatus = PreflightCheckStatus;
export type RealityTier = PreflightTier;

// Function aliases for backward compatibility
export const getRealityChecks = getPreflightChecks;
export const getRealityChecksWithAI = getPreflightChecksWithAI;
export const loadRealityState = loadPreflightState;
