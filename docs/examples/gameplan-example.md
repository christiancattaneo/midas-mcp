# Gameplan Example: Task Management CLI

This is an example gameplan for building the task management CLI.

---

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | Rust | Fast startup, single binary, great CLI ecosystem |
| Database | SQLite + rusqlite | Embedded, zero config, handles my scale |
| CLI Framework | clap | Standard, derive macros, built-in completions |
| Output | tabled + colored | Clean tables, cross-platform color |
| Config | toml + directories | Standard config format, XDG paths |
| Testing | cargo test + assert_cmd | Built-in + CLI integration tests |

## Project Structure

```
task-cli/
├── src/
│   ├── main.rs           # Entry point, CLI routing
│   ├── cli.rs            # Clap command definitions
│   ├── commands/         # Command implementations
│   │   ├── add.rs
│   │   ├── list.rs
│   │   ├── done.rs
│   │   ├── edit.rs
│   │   └── mod.rs
│   ├── db/               # Database operations
│   │   ├── schema.rs     # SQL schema, migrations
│   │   ├── tasks.rs      # Task CRUD
│   │   └── mod.rs
│   ├── models/           # Data structures
│   │   ├── task.rs
│   │   ├── priority.rs
│   │   └── mod.rs
│   └── output/           # Display formatting
│       ├── table.rs
│       ├── json.rs
│       └── mod.rs
├── tests/                # Integration tests
├── Cargo.toml
└── README.md
```

## Implementation Order

Order is critical. Each phase builds on the previous.

### Phase 1: Foundation (Days 1-2)

**Goal**: Skeleton that compiles and stores data

1. **Project setup**
   - `cargo new task-cli`
   - Add dependencies (clap, rusqlite, serde, toml)
   - Create module structure
   
2. **Database schema**
   ```sql
   CREATE TABLE tasks (
     id INTEGER PRIMARY KEY,
     title TEXT NOT NULL,
     priority TEXT DEFAULT 'medium',
     due_date TEXT,
     project TEXT,
     tags TEXT,
     completed INTEGER DEFAULT 0,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   ```
   - Schema creation on first run
   - DB path resolution (XDG)

3. **Basic CLI structure**
   - Parse `task add "title"` 
   - Parse `task list`
   - No actual implementation yet

**Exit criteria**: `cargo run -- add "test"` creates a row in SQLite.

### Phase 2: Core CRUD (Days 3-5)

**Goal**: All four commands work with minimal options

4. **Add command**
   - Accept title, --priority, --due, --project
   - Parse relative dates ("tomorrow", "friday")
   - Insert into database
   - Return task ID

5. **List command**
   - Query all incomplete tasks
   - Basic table output
   - Sort by due date, then priority

6. **Done command**
   - Accept task ID
   - Mark as completed
   - Confirm with message

7. **Edit command**
   - Accept task ID
   - Update any field
   - Show before/after

**Exit criteria**: Full add → list → edit → done flow works.

### Phase 3: Filtering & Output (Days 6-8)

**Goal**: Useful queries, multiple output formats

8. **Filtering**
   - `--due today|tomorrow|week|overdue`
   - `--priority high|medium|low`
   - `--project <name>`
   - `--tag <name>`
   - Combine filters with AND logic

9. **Output formats**
   - Colorized table (default)
   - `--json` for scripting
   - `--no-color` for piping
   - `--quiet` for scripts (ID only)

10. **Sorting**
    - `--sort due|priority|created`
    - `--reverse` flag

**Exit criteria**: `task list --due today --priority high --json` works.

### Phase 4: Polish (Days 9-11)

**Goal**: Production-ready CLI UX

11. **Shell completions**
    - Generate for bash, zsh, fish
    - Include in build artifacts
    - Document installation

12. **Error handling**
    - Friendly error messages
    - Consistent exit codes
    - --debug flag for troubleshooting

13. **Help & docs**
    - Command help text
    - Man page generation
    - README with examples

**Exit criteria**: Someone else can install and use it.

### Phase 5: Advanced Features (Days 12-14)

**Goal**: Recurring tasks, import/export

14. **Recurring tasks**
    - `--recur daily|weekly|monthly`
    - Store recurrence rule
    - Create next instance on completion

15. **Import/Export**
    - Import from CSV (title, due, priority)
    - Export to JSON
    - Backup/restore workflow

**Exit criteria**: Can migrate from todo.txt or CSV.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Date parsing complexity | Medium | Use chrono-english, limit to common formats |
| Shell completion setup is confusing | Low | Document clearly, provide install script |
| SQLite concurrent access | Low | Single-user tool, use WAL mode |
| Scope creep (sync, teams) | High | Defer to v2, stick to PRD non-goals |

## Dependencies

```toml
[dependencies]
clap = { version = "4", features = ["derive", "env"] }
rusqlite = { version = "0.31", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
toml = "0.8"
chrono = "0.4"
chrono-english = "0.1"
tabled = "0.15"
colored = "2"
directories = "5"
thiserror = "1"

[dev-dependencies]
assert_cmd = "2"
predicates = "3"
tempfile = "3"
```

## Time Estimates

| Phase | Days | Cumulative |
|-------|------|------------|
| Foundation | 2 | 2 |
| Core CRUD | 3 | 5 |
| Filtering & Output | 3 | 8 |
| Polish | 3 | 11 |
| Advanced | 3 | 14 |

**Buffer**: 2 days for unexpected issues.
**Total**: ~2 weeks to v1.

---

## Why This Document Matters

Without this gameplan:
- Would build features in wrong order (polish before core works)
- No clear daily goals
- Dependencies would be ad-hoc, possibly wrong
- Time estimates would be guesses

With this gameplan:
- Clear sequence: foundation → CRUD → filtering → polish → advanced
- Each phase has exit criteria
- AI can suggest next task in sequence
- Risks are acknowledged upfront
