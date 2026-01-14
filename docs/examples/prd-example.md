# PRD Example: Task Management CLI

This is an example PRD (Product Requirements Document) for the task management CLI.

---

## Overview

**Product**: `task` - A command-line task manager for developers
**Version**: 1.0 (MVP)
**Target**: Solo developers who work in the terminal

## Goals

1. **Replace my current sticky-note chaos** with structured task tracking
2. **Stay in terminal flow** - no browser tabs, no context switching
3. **Sub-second operations** - faster than any web app
4. **Offline-first** - works without internet

## Non-Goals (v1)

- Team collaboration
- Web or mobile interface
- Real-time sync
- Time tracking
- Integrations with external services
- Notifications/reminders (requires daemon)

## User Stories

### Must Have (P0)

**Add a task**
```
task add "Fix login bug" --priority high --due tomorrow --project midas
```
As a developer, I want to quickly add a task with metadata so I don't forget important work.

**List tasks**
```
task list
task list --due today
task list --project midas --priority high
```
As a developer, I want to see my tasks filtered by various criteria so I can focus on what matters.

**Complete a task**
```
task done 42
task done --id abc123
```
As a developer, I want to mark tasks complete so my list stays current.

**Edit a task**
```
task edit 42 --due friday --priority low
```
As a developer, I want to update task details without recreating them.

### Should Have (P1)

**Projects**
```
task project list
task project create mobile-app
```
As a developer working on multiple projects, I want to organize tasks by project.

**Tags**
```
task add "Review PR" --tags review,urgent
task list --tag urgent
```
As a developer, I want to tag tasks for cross-cutting concerns.

**Search**
```
task search "auth"
```
As a developer, I want to find tasks by keyword.

### Nice to Have (P2)

**Recurring tasks**
```
task add "Weekly review" --recur weekly
```
As a developer, I want tasks that automatically recreate on a schedule.

**Import/Export**
```
task import tasks.csv
task export --format json > backup.json
```
As a developer, I want to migrate from other tools and backup my data.

## Technical Requirements

### Performance
- All operations complete in < 100ms
- Startup time < 50ms
- Handle 10,000+ tasks without degradation

### Data
- Local SQLite database in `~/.local/share/task/tasks.db`
- TOML config in `~/.config/task/config.toml`
- Follow XDG Base Directory spec

### CLI
- Subcommand structure: `task <command> [options]`
- Short flags for common options (-p, -d, -t)
- Shell completions for bash, zsh, fish
- Colorized output with `--no-color` fallback
- JSON output with `--json` for scripting
- Exit codes: 0 (success), 1 (error), 2 (not found)

### Compatibility
- Linux x86_64 (primary)
- macOS (Intel + Apple Silicon)
- Windows via WSL

## Out of Scope

- GUI of any kind
- Server component
- User accounts or authentication
- Encryption (filesystem encryption is sufficient)
- Attachments or rich text

## Success Metrics

| Metric | Target |
|--------|--------|
| Daily usage | Use it every day for 2 weeks |
| Task add latency | < 50ms p99 |
| Abandoned tasks | < 10% |
| Return to old system | Never |

## Milestones

**Week 1**: Core CRUD
- add, list, done, edit commands
- SQLite storage
- Basic output formatting

**Week 2**: Polish
- Shell completions
- Filtering (--due, --priority, --project)
- JSON output

**Week 3**: Advanced
- Recurring tasks
- Import from CSV
- Search

---

## Why This Document Matters

Without this PRD:
- Scope would creep (sync, notifications, team features)
- No clear definition of "done"
- Would build features nobody asked for
- No measurable success criteria

With this PRD:
- Clear finish line for v1
- Explicit non-goals prevent distraction
- Milestones break work into achievable chunks
- AI can validate suggestions against requirements
