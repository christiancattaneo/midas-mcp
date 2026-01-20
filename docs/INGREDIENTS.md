# The 12 Ingredients

Production readiness checklist for any application.

---

## Core Ingredients (1-4)

Every app needs these. Without them, nothing works.

### 1. Frontend
What users see and touch. UI, buttons, screens, interactions.

**Responsiveness:**
- [ ] Responsive design (mobile, tablet, desktop)
- [ ] Touch-friendly targets (44px minimum)

**User Feedback:**
- [ ] Loading states for async operations
- [ ] Error states with recovery options
- [ ] Success confirmations for actions

**Quality:**
- [ ] Accessibility basics (labels, contrast, keyboard nav)
- [ ] Consistent component patterns
- [ ] Form validation with clear error messages

### 2. Backend
Server logic, APIs, business rules.

**API Structure:**
- [ ] RESTful or GraphQL API design
- [ ] Proper HTTP status codes (200, 201, 400, 401, 403, 404, 500)
- [ ] Consistent response format (envelope pattern or JSON:API)

**Input Handling:**
- [ ] Input validation on all endpoints (zod, yup, joi)
- [ ] Request body size limits
- [ ] File upload validation (type, size)

**Resilience:**
- [ ] Rate limiting on public endpoints
- [ ] Graceful error responses (no stack traces in production)
- [ ] Request timeouts configured

### 3. Database
Where data lives and persists.

**Checklist:**
- [ ] Schema designed for access patterns
- [ ] Indexes on frequently queried fields
- [ ] Foreign key constraints where appropriate
- [ ] Backup strategy defined
- [ ] Migration system in place

### 4. Authentication
Who users are, login/signup, permissions.

**Password Security:**
- [ ] Secure password hashing (bcrypt/argon2, never MD5/SHA1)
- [ ] Salt per password (automatic with bcrypt/argon2)
- [ ] Minimum password requirements enforced

**Session Management:**
- [ ] JWT or session tokens with expiration
- [ ] Secure cookie settings (httpOnly, secure, sameSite)
- [ ] Token refresh mechanism

**Account Protection:**
- [ ] Account lockout after failed attempts
- [ ] Password reset flow with expiring tokens
- [ ] Email verification on signup

---

## Power Ingredients (5-7)

These transform a basic app into something real.

### 5. API Integrations
Connecting to external services.

**Checklist:**
- [ ] API keys stored securely (env vars)
- [ ] Retry logic with exponential backoff
- [ ] Timeout handling
- [ ] Circuit breakers for failing services
- [ ] Rate limit awareness

### 6. State Management
How data flows through your app.

**Checklist:**
- [ ] Clear data flow pattern
- [ ] Loading/error/success states
- [ ] Optimistic updates where appropriate
- [ ] Cache invalidation strategy
- [ ] No prop drilling hell

### 7. Design/UX
Making it beautiful and usable.

**Checklist:**
- [ ] Consistent visual language
- [ ] Clear user feedback for actions
- [ ] Intuitive navigation
- [ ] Empty states designed
- [ ] Mobile-first or responsive

---

## Protection Ingredients (8-10)

Without protection, your app is vulnerable.

### 8. Testing
Proving it works before shipping.

**Checklist:**
- [ ] Unit tests for business logic
- [ ] Integration tests for API endpoints
- [ ] E2E tests for critical flows
- [ ] Tests run in CI before deploy
- [ ] Coverage on new code

### 9. Security
Protection from attacks, data safety.

**API Protection:**
- [ ] Rate limiting on endpoints (express-rate-limit, etc.)
- [ ] Authorization headers required on protected routes
- [ ] IP block list for abuse prevention (public APIs)
- [ ] CORS configured properly (not wildcard in production)
- [ ] Security middleware enabled (helmet for Node.js)
- [ ] File upload limits set (size, type validation)

**Injection Prevention:**
- [ ] SQL injection prevention (ORM or parameterized queries)
- [ ] XSS prevention (output encoding, CSP headers)
- [ ] CSRF protection (tokens on state-changing requests)
- [ ] Input validation on frontend and backend (zod, yup, joi)

**Secrets Management:**
- [ ] Secrets not in code or logs
- [ ] Environment variables for all credentials
- [ ] API keys rotatable without deploy

**Dependencies:**
- [ ] Dependencies audited for vulnerabilities (npm audit)
- [ ] Lock file committed (package-lock.json)
- [ ] Automated security updates (Dependabot, Renovate)

### 10. Error Handling
Graceful failures, logging, recovery.

**Checklist:**
- [ ] Try/catch on async operations
- [ ] User-friendly error messages
- [ ] Errors logged with context
- [ ] No sensitive data in error responses
- [ ] Recovery actions available

---

## Mastery Ingredients (11-12)

These separate hobby projects from professional software.

### 11. Version Control
Git, tracking changes, collaboration.

**Checklist:**
- [ ] Meaningful commit messages
- [ ] Feature branches for development
- [ ] No secrets committed (ever)
- [ ] .gitignore comprehensive
- [ ] PR reviews before merge

### 12. Deployment
CI/CD, hosting, getting it to users.

**Checklist:**
- [ ] Automated deployment pipeline
- [ ] Staging environment for testing
- [ ] Rollback capability
- [ ] Environment variables managed
- [ ] Health checks configured

---

## Audit Scoring

When Midas audits a project:

| Score | Meaning |
|-------|---------|
| 1-4 complete | Functional - it works |
| 5-7 complete | Integrated - it connects |
| 8-10 complete | Protected - it's safe |
| 11-12 complete | Professional - it ships |

**All 12 = Production Ready**

---

## Quick Audit Questions

For each ingredient, ask:

1. **Does it exist?** (binary)
2. **Does it work correctly?** (functional)
3. **Is it complete?** (coverage)
4. **Is it maintainable?** (quality)
