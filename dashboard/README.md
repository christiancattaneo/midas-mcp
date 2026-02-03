# Midas Dashboard

Web dashboard for tracking development progress across all your Midas projects.

## Features

- **GitHub OAuth**: Login with your GitHub account
- **Project Overview**: See all synced projects at a glance
- **Phase Tracking**: Monitor progress through PLAN → BUILD → SHIP → GROW
- **Gate Status**: View build/test/lint verification status
- **Activity Feed**: Recent tool calls and events

## Setup

### 1. Prerequisites

- [Turso](https://turso.tech) database account
- [GitHub OAuth App](https://github.com/settings/developers)

### 2. Create Turso Database

```bash
# Install Turso CLI
npm install -g turso

# Sign up / Login
turso auth signup  # or: turso auth login

# Create database
turso db create midas

# Get connection info
turso db show midas --url
turso db tokens create midas
```

### 3. Create GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in:
   - **Application name**: Midas Dashboard
   - **Homepage URL**: `https://dashboard.midasmcp.com` (or your URL)
   - **Authorization callback URL**: `https://dashboard.midasmcp.com/api/auth/callback/github`
4. Save the Client ID and generate a Client Secret

### 4. Configure Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```bash
# Generate a random secret: openssl rand -base64 32
AUTH_SECRET="your-random-secret"

# From GitHub OAuth App
AUTH_GITHUB_ID="your-client-id"
AUTH_GITHUB_SECRET="your-client-secret"

# From Turso
TURSO_DATABASE_URL="libsql://midas-your-org.turso.io"
TURSO_AUTH_TOKEN="your-turso-token"
```

### 5. Initialize Database Schema

The schema is automatically created when you first sync a project:

```bash
# In your project directory
npx midas-mcp login    # Authenticate with GitHub
npx midas-mcp sync     # Creates tables and syncs project
```

### 6. Run Locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

### 7. Deploy to Vercel

```bash
vercel --prod
```

Add environment variables in Vercel Dashboard → Settings → Environment Variables.

## CLI Integration

Users sync their projects from the command line:

```bash
# One-time setup
npx midas-mcp login

# Sync current project
cd your-project
npx midas-mcp sync
```

## Architecture

```
dashboard/
├── app/
│   ├── page.tsx              # Login page
│   ├── dashboard/
│   │   ├── page.tsx          # Projects list
│   │   └── [projectId]/
│   │       └── page.tsx      # Project detail
│   └── api/auth/
│       └── [...nextauth]/    # Auth.js routes
├── lib/
│   └── db.ts                 # Turso database client
└── auth.ts                   # Auth.js configuration
```

## Database Schema

```sql
-- Projects table
projects (
  id TEXT PRIMARY KEY,
  github_user_id INTEGER,
  github_username TEXT,
  name TEXT,
  local_path TEXT,
  current_phase TEXT,
  current_step TEXT,
  progress INTEGER,
  last_synced TEXT,
  created_at TEXT
)

-- Phase history
phase_history (
  id INTEGER PRIMARY KEY,
  project_id TEXT,
  phase TEXT,
  step TEXT,
  entered_at TEXT,
  exited_at TEXT,
  duration_minutes INTEGER
)

-- Events (activity feed)
events (
  id INTEGER PRIMARY KEY,
  project_id TEXT,
  event_type TEXT,
  event_data TEXT,
  created_at TEXT
)

-- Verification gates
gates (
  id INTEGER PRIMARY KEY,
  project_id TEXT,
  compiles INTEGER,
  tests_pass INTEGER,
  lints_pass INTEGER,
  checked_at TEXT
)

-- Suggestions
suggestions (
  id INTEGER PRIMARY KEY,
  project_id TEXT,
  suggestion TEXT,
  accepted INTEGER,
  user_prompt TEXT,
  rejection_reason TEXT,
  created_at TEXT
)
```
