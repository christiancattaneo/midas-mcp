# Why Each Step Matters

The Golden Code methodology isn't arbitrary. Each phase and step exists because skipping it causes predictable failures.

---

## Plan Phase

**Why plan before building?** Because code without context is just syntax. The AI doesn't know your domain, your constraints, or your users. You do.

### IDEA
**Why define the core idea first?**
Most projects fail not from bad code but from solving the wrong problem. Spending 10 minutes clarifying "what problem, who for, why now" saves days of building the wrong thing.

*Skip this and you'll build something nobody needs.*

### RESEARCH
**Why scan the landscape?**
Whatever you're building, someone has probably solved 80% of it already. Libraries exist. Patterns exist. Anti-patterns exist. Knowing what's out there prevents reinventing wheels and repeating known mistakes.

*Skip this and you'll build from scratch what exists in a npm package.*

### PRD
**Why define requirements formally?**
"I'll know it when I see it" is the enemy of shipping. A PRD creates a contract with yourself: these features, these constraints, this scope. It's the difference between "done" and "endless tweaking."

*Skip this and you'll never finish because the finish line keeps moving.*

### GAMEPLAN
**Why plan the build order?**
Some things depend on other things. Authentication before protected routes. Database schema before queries. The gameplan sequences work so you're never blocked waiting for yourself.

*Skip this and you'll context-switch constantly, building things before their dependencies.*

---

## BUILD Phase

**Why follow a 7-step cycle?** Because jumping straight to code is how you end up debugging for hours. Each step reduces the blast radius of mistakes.

### RULES
**Why read project rules first?**
Every project has conventions: naming patterns, forbidden dependencies, required patterns. Reading rules before coding prevents "works but doesn't fit" code that has to be rewritten.

*Skip this and you'll write code that breaks project conventions.*

### INDEX
**Why index the codebase?**
You can't extend what you don't understand. Indexing gives you the mental map: where things live, how they connect, what patterns are used. This prevents duplicate implementations and inconsistent patterns.

*Skip this and you'll add a new auth system when one already exists.*

### READ
**Why read specific files?**
Indexing shows structure. Reading shows implementation. Before touching a file, understand what's already there. This prevents breaking existing functionality and reveals extension points.

*Skip this and you'll overwrite working code or duplicate logic.*

### RESEARCH
**Why research before implementing?**
The right library or pattern can turn 200 lines into 5. Documentation reveals edge cases you'd otherwise discover in production. Research is cheap; debugging is expensive.

*Skip this and you'll hand-roll what a library does better.*

### IMPLEMENT
**Why write tests first?**
The test defines what "working" means before you write the code. Test-first forces clear thinking about inputs, outputs, and edge cases. It's faster than test-after because you catch misunderstandings early.

*Skip this and you'll write code that "works" until it doesn't.*

### TEST
**Why run all tests after changes?**
Your change might break something unrelated. Running the full suite catches regressions before they escape to production. Fast feedback means small fixes; slow feedback means archaeology.

*Skip this and you'll ship bugs that worked yesterday.*

### DEBUG
**Why use the Tornado cycle?**
When stuck, random changes make things worse. The Tornado (Research + Logs + Tests) systematically narrows possibilities. Research finds known issues. Logs reveal actual behavior. Tests prove fixes work.

*Skip this and you'll thrash for hours making random changes.*

---

## SHIP Phase

**Why have a formal ship process?** Because "it works on my machine" is not deployment. Production has constraints, users, and consequences that dev doesn't.

### REVIEW
**Why review before deploying?**
Fresh eyes catch what tired eyes miss. Security flaws, performance issues, edge cases, unclear code. Review is cheaper than incident response.

*Skip this and you'll deploy vulnerabilities.*

### DEPLOY
**Why have a deploy process?**
Manual deployment is error-prone and unrepeatable. CI/CD ensures the same steps every time: build, test, stage, production. Rollback is possible because you know what changed.

*Skip this and you'll deploy differently each time, with different bugs.*

### MONITOR
**Why monitor after deploy?**
Users don't file bug reports. They leave. Monitoring reveals what's actually happening: errors, latency, usage patterns. You'll know about problems before users complain.

*Skip this and you'll find out about outages from angry tweets.*

---

## GROW Phase

**Why iterate formally?** Because version 1 is never right. Growth comes from learning what users actually do, not what you imagined they'd do.

### MONITOR
**Why track production health?**
Real load reveals real problems. Memory leaks, slow queries, race conditions—all appear under production load. Continuous monitoring catches degradation before failure.

*Skip this and you'll discover problems when everything crashes.*

### COLLECT
**Why gather feedback systematically?**
Users have needs they can't articulate. Analytics show what they actually do. Reviews reveal pain points. Bug reports expose edge cases. Collecting all signals gives the full picture.

*Skip this and you'll guess what users want instead of knowing.*

### TRIAGE
**Why prioritize formally?**
Everything can't be priority 1. Impact vs. effort analysis ensures you fix the right things first. Quick wins build momentum. Critical bugs get immediate attention.

*Skip this and you'll work on whatever's loudest, not what matters.*

### RETROSPECT
**Why review the cycle?**
Teams repeat mistakes they don't acknowledge. Retrospectives surface what worked, what broke, what surprised. This knowledge compounds across iterations.

*Skip this and you'll make the same mistakes next cycle.*

### PLAN_NEXT
**Why scope the next iteration?**
Unbounded work never ships. Defining the next iteration's scope—hypothesis, success metrics, boundaries—creates a finish line. You can always do more iterations.

*Skip this and you'll never ship version 2 because it keeps growing.*

### LOOP
**Why return to PLAN with context?**
Each cycle teaches you something. Carrying that context forward means version 2 builds on version 1's lessons. The PRD evolves. The gameplan improves.

*Skip this and every version starts from zero knowledge.*

---

## The Meta-Why

The Golden Code methodology exists because AI is powerful but directionless. It can generate infinite code, but code isn't the goal—working software that solves real problems is.

Every step in this process answers the same question: **"What does the AI need to know to help me effectively?"**

- PLAN answers: What are we building and why?
- BUILD answers: How do we build it correctly?
- SHIP answers: How do we get it to users safely?
- GROW answers: How do we make it better?

Skip any step and you're asking the AI to guess. It will guess wrong.
