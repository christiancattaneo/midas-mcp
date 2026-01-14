# Brainlift Example: Task Management CLI

This is an example brainlift document for a command-line task management tool.

---

## What I'm Building

A CLI tool for developers who manage tasks in the terminal. Think todoist but keyboard-driven, git-like commands, and local-first with optional sync.

## The Problem

Existing task managers are either:
- **Too heavy**: Notion, Asana, Jira - overkill for personal todos
- **Too simple**: iOS reminders, Apple Notes - no filtering, no priority, no due dates
- **Wrong interface**: Web-based or mobile-first when I live in the terminal

I want to type `task add "Fix auth bug" -p high -d tomorrow` without leaving my workflow.

## Who It's For

Developers who:
- Already live in the terminal
- Have tried and abandoned heavyweight project management tools
- Want keyboard-driven, fast, local-first task management
- Need basic features (priorities, due dates, tags) without complexity

**Not for**: Teams, non-technical users, people who want GUI, or enterprise.

## What I Know That AI Doesn't

### My workflow context
I switch between 5-10 projects daily. I need project-scoped task views but also a "today across all projects" view. This isn't obvious from the problem statement.

### Implementation constraints
Must work offline-first. Sync is nice-to-have but not blocking. I travel often without reliable internet.

### Prior art that failed for me
- Taskwarrior: Too complex, syntax is confusing
- Todo.txt: Too simple, no due date handling
- GitHub Issues: Wrong tool for personal tasks

### Non-obvious requirements
1. Import from existing task managers (at minimum: CSV)
2. Must handle recurring tasks (daily standup notes, weekly reviews)
3. Shell completion is mandatory - I won't use it without tab-complete
4. Sub-second response time for all operations

## Key Decisions Already Made

- **Language**: Rust. Fast startup, single binary, easy distribution
- **Storage**: SQLite. Familiar, portable, handles my scale (thousands of tasks)
- **Config**: TOML in ~/.config/task/. Standard XDG paths
- **Output**: Colorized terminal tables, with --json for scripting

## Unknowns to Research

- Best approach for optional cloud sync without server maintenance
- How to handle recurring task recurrence rules (RRULE vs simpler?)
- Whether to support time-based reminders (requires daemon?)

## Success Looks Like

In 2 weeks:
- `task add/list/done/edit` working with priorities and due dates
- Tab completion for zsh/bash/fish
- Feels faster than opening any web app

In 1 month:
- Recurring tasks
- Basic filtering (`task list --due today --priority high`)
- Import from common formats

---

## Why This Document Matters

Without this brainlift:
- AI would suggest building a React web app (wrong interface)
- AI wouldn't know about my offline-first constraint
- AI might over-engineer sync before basics work
- AI wouldn't understand the "5-10 projects daily" context

With this brainlift, AI prompts can be specific:
- "Create the SQLite schema for tasks with project scoping"
- "Add --json flag to all output for scripting"
- "Implement recurring tasks using a simplified RRULE subset"
