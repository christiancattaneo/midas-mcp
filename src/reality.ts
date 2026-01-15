/**
 * Reality Check Module
 * 
 * Analyzes project docs to infer what requirements apply,
 * categorizes them by what AI can/cannot do,
 * and generates context-aware prompts for Cursor.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { sanitizePath } from './security.js';

// ============================================================================
// PERSISTENCE
// ============================================================================

const MIDAS_DIR = '.midas';
const REALITY_STATE_FILE = 'reality-checks.json';

export type RealityCheckStatus = 'pending' | 'completed' | 'skipped';

export interface PersistedCheckState {
  status: RealityCheckStatus;
  updatedAt: string;
  skippedReason?: string;  // Why user skipped (optional)
}

interface RealityStateFile {
  checkStates: Record<string, PersistedCheckState>;
  lastProfileHash: string;  // Detect when project profile changes
}

function getRealityStatePath(projectPath: string): string {
  return join(projectPath, MIDAS_DIR, REALITY_STATE_FILE);
}

function loadRealityState(projectPath: string): RealityStateFile {
  const path = getRealityStatePath(projectPath);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return { checkStates: {}, lastProfileHash: '' };
    }
  }
  return { checkStates: {}, lastProfileHash: '' };
}

function saveRealityState(projectPath: string, state: RealityStateFile): void {
  const dir = join(projectPath, MIDAS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getRealityStatePath(projectPath), JSON.stringify(state, null, 2));
}

function hashProfile(profile: ProjectProfile): string {
  // Simple hash to detect profile changes
  return JSON.stringify(profile).split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0).toString(36);
}

/**
 * Update the status of a reality check
 */
export function updateCheckStatus(
  projectPath: string,
  checkKey: string,
  status: RealityCheckStatus,
  skippedReason?: string
): void {
  const safePath = sanitizePath(projectPath);
  const state = loadRealityState(safePath);
  
  state.checkStates[checkKey] = {
    status,
    updatedAt: new Date().toISOString(),
    ...(skippedReason ? { skippedReason } : {}),
  };
  
  saveRealityState(safePath, state);
}

/**
 * Get the persisted status for a check
 */
export function getCheckStatus(projectPath: string, checkKey: string): PersistedCheckState | undefined {
  const safePath = sanitizePath(projectPath);
  const state = loadRealityState(safePath);
  return state.checkStates[checkKey];
}

/**
 * Get all check statuses
 */
export function getAllCheckStatuses(projectPath: string): Record<string, PersistedCheckState> {
  const safePath = sanitizePath(projectPath);
  const state = loadRealityState(safePath);
  return state.checkStates;
}

/**
 * Reset all check statuses (e.g., when profile changes significantly)
 */
export function resetCheckStatuses(projectPath: string): void {
  const safePath = sanitizePath(projectPath);
  saveRealityState(safePath, { checkStates: {}, lastProfileHash: '' });
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Three tiers of AI capability:
 * - generatable: AI can draft the document, just needs human review
 * - assistable: AI can help with checklist/guide, but needs professional verification
 * - human_only: Requires real-world action (signup, purchase, certification)
 */
export type RealityTier = 'generatable' | 'assistable' | 'human_only';

export interface RealityCheck {
  key: string;
  category: string;
  tier: RealityTier;
  headline: string;
  explanation: string;
  cursorPrompt: string;           // The prompt to copy to Cursor
  humanSteps?: string[];          // For human_only tier
  externalLinks?: string[];       // For human_only tier
  alsoNeeded?: string[];          // For assistable tier - what still needs human
  priority: 'critical' | 'high' | 'medium' | 'low';
  // Persisted state
  status: RealityCheckStatus;
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

export interface RealityCheckResult {
  profile: ProjectProfile;
  checks: RealityCheck[];
  summary: {
    total: number;
    critical: number;
    generatable: number;
    assistable: number;
    humanOnly: number;
    // Status counts
    pending: number;
    completed: number;
    skipped: number;
  };
}

// ============================================================================
// REALITY CHECK DEFINITIONS
// ============================================================================

// Static definition type - excludes runtime fields (cursorPrompt, status)
type RealityCheckDefinition = Omit<RealityCheck, 'cursorPrompt' | 'status' | 'statusUpdatedAt' | 'skippedReason'> & { 
  promptTemplate: string; 
  condition: (p: ProjectProfile) => boolean;
};

const REALITY_CHECKS: Record<string, RealityCheckDefinition> = {
  // ✅ GENERATABLE - AI can draft these
  PRIVACY_POLICY: {
    key: 'PRIVACY_POLICY',
    category: 'Legal',
    tier: 'generatable',
    headline: 'You need a Privacy Policy',
    explanation: 'You collect user data. Users need to know what you collect, why, and how to delete it.',
    priority: 'critical',
    promptTemplate: `Create a privacy policy for this project based on the brainlift and PRD.

We collect: {{dataCollected}}
Target users: {{targetUsers}}
Business model: {{businessModel}}

Include sections:
- What we collect and why
- How we use the data
- Third parties we share with (if any)
- How long we keep data
- User rights (access, correct, delete)
- How to contact us

Save to docs/privacy-policy.md

Add at the top: "DRAFT - Review with a lawyer before publishing"`,
    condition: (p) => p.collectsUserData,
  },

  TERMS_OF_SERVICE: {
    key: 'TERMS_OF_SERVICE',
    category: 'Legal',
    tier: 'generatable',
    headline: 'You need Terms of Service',
    explanation: 'Any public product needs terms defining the rules of use and liability limits.',
    priority: 'high',
    promptTemplate: `Create terms of service for this project based on the brainlift and PRD.

Product type: {{productType}}
Business model: {{businessModel}}
Key features: {{keyFeatures}}

Include sections:
- Acceptance of terms
- Description of service
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
    tier: 'generatable',
    headline: 'You need an AI disclosure',
    explanation: 'Users should know when AI is involved and that it can make mistakes.',
    priority: 'high',
    promptTemplate: `Create an AI transparency disclosure for this project.

Based on the brainlift, this project uses AI to: {{aiUsage}}

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
    tier: 'generatable',
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
    tier: 'generatable',
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
    tier: 'assistable',
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
    tier: 'assistable',
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
    tier: 'assistable',
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
    tier: 'assistable',
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
    tier: 'human_only',
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
    tier: 'human_only',
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
    tier: 'human_only',
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
    tier: 'human_only',
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
    tier: 'human_only',
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
    tier: 'human_only',
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
    tier: 'human_only',
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
};

// ============================================================================
// INFERENCE FUNCTIONS
// ============================================================================

/**
 * Infer project profile from brainlift, PRD, and package.json
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
  
  // Read docs
  const brainliftPath = join(safePath, 'docs', 'brainlift.md');
  const prdPath = join(safePath, 'docs', 'prd.md');
  const readmePath = join(safePath, 'README.md');
  const packagePath = join(safePath, 'package.json');
  
  let content = '';
  
  if (existsSync(brainliftPath)) {
    content += readFileSync(brainliftPath, 'utf-8').toLowerCase() + '\n';
  }
  if (existsSync(prdPath)) {
    content += readFileSync(prdPath, 'utf-8').toLowerCase() + '\n';
  }
  if (existsSync(readmePath)) {
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
    // AI - only when clearly AI-powered
    usesAI: ['ai-powered', 'artificial intelligence', 'machine learning', 'gpt', 'llm', 'claude api', 'openai api', 'langchain'],
    aiMakesDecisions: ['ai decides', 'ai recommends', 'automated decision', 'algorithm determines', 'ai-driven'],
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
  
  // Read docs for context
  let brainliftContent = '';
  let prdContent = '';
  
  const brainliftPath = join(safePath, 'docs', 'brainlift.md');
  const prdPath = join(safePath, 'docs', 'prd.md');
  
  if (existsSync(brainliftPath)) {
    brainliftContent = readFileSync(brainliftPath, 'utf-8');  // Read full doc for accurate inference
  }
  if (existsSync(prdPath)) {
    prdContent = readFileSync(prdPath, 'utf-8');  // Read full doc for accurate inference
  }
  
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
    '{{keyFeatures}}': brainliftContent.slice(0, 200) || 'See brainlift for details',
    '{{aiUsage}}': profile.usesAI ? 'AI features (see brainlift for specifics)' : 'No AI',
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
 * Get all applicable reality checks for a project
 */
export function getRealityChecks(projectPath: string): RealityCheckResult {
  const safePath = sanitizePath(projectPath);
  const profile = inferProjectProfile(safePath);
  const checks: RealityCheck[] = [];
  
  // Load persisted state
  const persistedState = loadRealityState(safePath);
  const checkStates = persistedState.checkStates;
  
  for (const check of Object.values(REALITY_CHECKS)) {
    if (check.condition(profile)) {
      const cursorPrompt = fillPromptTemplate(check.promptTemplate, profile, safePath);
      const persisted = checkStates[check.key];
      
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
        // Add persisted status
        status: persisted?.status || 'pending',
        statusUpdatedAt: persisted?.updatedAt,
        skippedReason: persisted?.skippedReason,
      });
    }
  }
  
  // Sort by priority and tier
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const tierOrder = { human_only: 0, assistable: 1, generatable: 2 };
  
  checks.sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return tierOrder[a.tier] - tierOrder[b.tier];
  });
  
  return {
    profile,
    checks,
    summary: {
      total: checks.length,
      critical: checks.filter(c => c.priority === 'critical').length,
      generatable: checks.filter(c => c.tier === 'generatable').length,
      assistable: checks.filter(c => c.tier === 'assistable').length,
      humanOnly: checks.filter(c => c.tier === 'human_only').length,
      pending: checks.filter(c => c.status === 'pending').length,
      completed: checks.filter(c => c.status === 'completed').length,
      skipped: checks.filter(c => c.status === 'skipped').length,
    },
  };
}

// ============================================================================
// AI CATCH-ALL FILTER
// ============================================================================

/**
 * AI-powered reality check filter
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
  checks: RealityCheck[],
  projectPath: string
): Promise<{ filtered: RealityCheck[]; additions: string[]; removals: string[] }> {
  // Dynamic import to avoid circular dependency
  const { getApiKey } = await import('./config.js');
  const { chat } = await import('./providers.js');
  
  const apiKey = getApiKey();
  if (!apiKey) {
    // No API key - return checks as-is
    return { filtered: checks, additions: [], removals: [] };
  }
  
  const safePath = sanitizePath(projectPath);
  
  // Read full docs for context
  let docsContent = '';
  const brainliftPath = join(safePath, 'docs', 'brainlift.md');
  const prdPath = join(safePath, 'docs', 'prd.md');
  const readmePath = join(safePath, 'README.md');
  
  if (existsSync(brainliftPath)) {
    docsContent += `## Brainlift:\n${readFileSync(brainliftPath, 'utf-8').slice(0, 4000)}\n\n`;
  }
  if (existsSync(prdPath)) {
    docsContent += `## PRD:\n${readFileSync(prdPath, 'utf-8').slice(0, 4000)}\n\n`;
  }
  if (existsSync(readmePath)) {
    docsContent += `## README:\n${readFileSync(readmePath, 'utf-8').slice(0, 2000)}\n`;
  }
  
  if (!docsContent) {
    // No docs to analyze - return checks as-is
    return { filtered: checks, additions: [], removals: [] };
  }
  
  const systemPrompt = `You are a compliance advisor reviewing reality checks for a software project.
Your job is to FILTER the proposed checks based on the actual project context.

Rules:
1. REMOVE checks that don't apply (e.g., GDPR for US-only apps, COPPA for adult-only products)
2. FLAG checks that might apply but need confirmation (add to "maybeAdd" list)
3. Be CONSERVATIVE: when in doubt, keep the check
4. Consider industry-specific requirements (healthcare → HIPAA, education → FERPA, etc.)
5. Consider geographic requirements (EU → GDPR, California → CCPA, etc.)

Respond ONLY with JSON.`;

  const prompt = `# Project Documentation
${docsContent}

# Inferred Profile
${JSON.stringify(profile, null, 2)}

# Proposed Checks
${checks.map(c => `- ${c.key}: ${c.headline}`).join('\n')}

# All Available Checks (not currently triggered)
${Object.keys(REALITY_CHECKS).filter(k => !checks.some(c => c.key === k)).map(k => `- ${k}: ${REALITY_CHECKS[k].headline}`).join('\n')}

Review this and respond with:
{
  "keep": ["CHECK_KEY", ...],      // Checks that definitely apply
  "remove": ["CHECK_KEY", ...],   // Checks that don't apply (with reason)
  "add": ["CHECK_KEY", ...],      // Checks from available list that SHOULD apply
  "reasoning": "Brief explanation of key decisions"
}`;

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
    const persistedState = loadRealityState(safePath);
    
    for (const key of addKeys) {
      if (REALITY_CHECKS[key] && !filtered.some(c => c.key === key)) {
        const check = REALITY_CHECKS[key];
        const cursorPrompt = fillPromptTemplate(check.promptTemplate, profile, projectPath);
        const persisted = persistedState.checkStates[key];
        
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
          status: persisted?.status || 'pending',
          statusUpdatedAt: persisted?.updatedAt,
          skippedReason: persisted?.skippedReason,
        });
      }
    }
    
    // Re-sort
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const tierOrder = { human_only: 0, assistable: 1, generatable: 2 };
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
 * Get reality checks with AI filtering (async version)
 * Use this when you want the most accurate checks
 */
export async function getRealityChecksWithAI(projectPath: string): Promise<RealityCheckResult & { aiFiltered: boolean }> {
  const basic = getRealityChecks(projectPath);
  
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
        generatable: filtered.filter(c => c.tier === 'generatable').length,
        assistable: filtered.filter(c => c.tier === 'assistable').length,
        humanOnly: filtered.filter(c => c.tier === 'human_only').length,
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
export function getTierSymbol(tier: RealityTier): string {
  switch (tier) {
    case 'generatable': return '✅';
    case 'assistable': return '⚠️';
    case 'human_only': return '🔴';
  }
}

/**
 * Get tier description
 */
export function getTierDescription(tier: RealityTier): string {
  switch (tier) {
    case 'generatable': return 'AI can draft this';
    case 'assistable': return 'AI can help, needs review';
    case 'human_only': return 'You need to do this';
  }
}
