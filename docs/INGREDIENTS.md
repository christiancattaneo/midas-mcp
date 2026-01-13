# The 12 Ingredients

Production readiness checklist for any application.

---

## Core Ingredients (1-4)

Every app needs these. Without them, nothing works.

### 1. Frontend
What users see and touch. UI, buttons, screens, interactions.

**Checklist:**
- [ ] Responsive design (mobile, tablet, desktop)
- [ ] Accessibility basics (labels, contrast, keyboard nav)
- [ ] Loading states for async operations
- [ ] Error states with recovery options
- [ ] Consistent component patterns

### 2. Backend
Server logic, APIs, business rules.

**Checklist:**
- [ ] RESTful or GraphQL API structure
- [ ] Input validation on all endpoints
- [ ] Proper HTTP status codes
- [ ] Rate limiting on public endpoints
- [ ] Graceful error responses

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

**Checklist:**
- [ ] Secure password hashing (bcrypt/argon2)
- [ ] Session/token management
- [ ] Password reset flow
- [ ] Account lockout after failed attempts
- [ ] Secure cookie settings (httpOnly, secure, sameSite)

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

**Checklist:**
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (output encoding)
- [ ] CSRF protection
- [ ] Secrets not in code or logs
- [ ] Dependencies audited for vulnerabilities

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
