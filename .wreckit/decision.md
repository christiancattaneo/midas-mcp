# wreckit-ralph AUDIT — midas-mcp

**Date:** 2026-02-17T14:55:00-06:00
**Mode:** AUDIT (installed skill v1.0.0 + patched scripts)
**Target:** `~/Projects/midas-mcp` — MCP server (TypeScript, 56K LOC, 399 test files)
**Focus:** security.ts + auth.ts (critical modules)
**Verdict:** 🚫 BLOCKED

## Gate Results

| Gate | Result | Details |
|------|--------|---------|
| Slop Scan | ✅ PASS | All deps real. 1 real TODO in pilot.ts. Others are legitimate (tool that scans for TODOs). |
| Type Check | ✅ PASS | `tsc --noEmit` zero errors |
| Test Quality | ⚠️ CAUTION | 17 tests on security.ts (good). **auth.ts (364 LOC) has ZERO tests.** |
| Mutation Kill | 🚫 FAIL (37.5%) | 3/8 killed on security.ts. Null byte stripping, unicode stripping, URL-encoded traversal, isAbsolute guard, sanitizeForGit throw — all survive. |
| SAST | ⚠️ CAUTION | Auth file written with default perms. Client ID hardcoded (acceptable for OAuth). |

## Mutation Kill Details (security.ts)

| # | Mutation | Result |
|---|---------|--------|
| M1 | Remove null byte stripping | SURVIVED ❌ |
| M2 | Remove path traversal check (`startsWith('..')`) | KILLED ✅ |
| M3 | Remove unicode control char stripping | SURVIVED ❌ |
| M4 | Flip isShellSafe return value | KILLED ✅ |
| M5 | Remove URL-encoded null byte strip | SURVIVED ❌ |
| M6 | Remove isAbsolute guard in traversal check | SURVIVED ❌ |
| M7 | Remove truncation marker `[truncated]` | KILLED ✅ |
| M8 | Remove sanitizeForGit exception throw | SURVIVED ❌ |

**Kill rate: 37.5%** (target: ≥95%)

## Key Findings

### 1. auth.ts completely untested (BLOCKER)
364 lines of GitHub OAuth device flow + token polling + auth file I/O — zero tests.
Auth file (`~/.midas/auth.json`) written with default permissions (world-readable on most systems).

### 2. Security stripping functions have weak test coverage
Tests verify path traversal (`../`) and shell metacharacters work. But:
- No test for null byte injection (`\x00`)
- No test for unicode control chars
- No test for URL-encoded traversal (`%2e%2e`)
- No test for sanitizeForGit throwing on unsafe input

### 3. detect-stack.sh missed `node --test` runner (SKILL BUG — FIXED)

## SAST Findings

| Severity | Finding |
|----------|---------|
| MEDIUM | `auth.json` written with `writeFileSync` — no explicit `mode: 0o600` — token readable by other users |
| LOW | GitHub client ID hardcoded (acceptable for public OAuth apps) |
| INFO | 1 real TODO in `src/pilot.ts:334` |

## Recommendations

1. **Add null byte / unicode / URL-encoded traversal tests** to security.test.ts
2. **Write auth.ts tests** — at minimum: loadAuth, saveAuth, isAuthenticated, clearAuth
3. **Set file permissions** on auth.json: `writeFileSync(AUTH_FILE, data, { mode: 0o600 })`
4. **Add sanitizeForGit tests** — verify it throws on unsafe paths

## wreckit-ralph Skill Issues Found

1. **`detect-stack.sh` missed `node --test`** — FIXED in dev copy
2. **`slop-scan.sh` and `mutation-test.sh` not in published v1.0.0** — need v1.0.1
3. **`mutation-test.sh` sed issues** — pipe chars in mutated lines break sed replacements, awk approach still fragile
4. **Mutation script subshell problem** — `echo | while` loses counter variables; need process substitution or temp file counters
