# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

#### Note: Anthropic suggests we keep the size of this file below 40K. You can check the current file size in the output of `ls -al CLAUDE.md`. Make sections more succinct as needed, but take care not to remove important context or guidance.

## 👇👇👇👇
**CRITICAL for Context Window Management**: Delegate to agents and/or subagents AGGRESSIVELY to conserve context window! The more you delegate to agents, the more work we can accomplish in a single session, before the autocompact tool forcibly ends this session. Tokens are sand in our hourglass. Conserve them.

Your role here is choregrapher/air traffic controller/stage-manager/director. Send subagents to do things that eat up our tokens. Don't wait for me to tell you to use agents and/or subagents. Delegate early, delagate often. 🙏 

## ☝️☝️☝️☝️ 

## Project Status: Hosted Version Development

**Important Context**: This codebase is a COPY of the original single-user local PostgreSQL version, which we are converting into a hosted multi-tenant SaaS application.

**IMPORTANT - Flask-AppBuilder Usage**: When working with authentication, security, OAuth, user management, or subscription features, **use the `flask-appbuilder` skill** located at `~/.claude/skills/flask-appbuilder/`. This skill contains comprehensive Flask-AppBuilder patterns, our current auth architecture, OAuth setup guides, subscription integration patterns, and links to official FAB documentation. **Never roll your own solution if Flask-AppBuilder provides it built-in.**

**IMPORTANT - Stripe Billing Integration**: When working with Stripe subscriptions, billing, payments, or webhooks, **use the `billing-specialist` agent** for best results. It has auto-loaded `gpra-billing-stripe` and `flask-appbuilder` skills, knows the difference between Checkout Sessions API (new customers) and Subscription Update API (existing customers), and always checks official Stripe docs. Alternatively, use the **`gpra-billing-stripe` skill** directly located at `~/.claude/skills/gpra-billing-stripe/`. **Always check official Stripe docs - training data may be outdated.**

**Original Version**: [guitar-practice-routine-app_postgresql](https://github.com/slshults/guitar-practice-routine-app_postgresql) and locally at `../gprsql/`- Single user, local-only, no authentication
**This Version**: `gpra-web` - Multi-tenant hosted version with user accounts, subscriptions, and security

**Transformation Goals**:
- Add user authentication (email/password + OAuth)
- Implement multi-tenant data isolation
- Add Stripe subscription tiers (free with ads, byoClaude, paid plans)
- Security hardening for public hosting
- Deploy to DreamCompute with multiple domains

**Key Architecture Changes**:
- ✅ Database: Row-Level Security (RLS) with `user_id` on Items/Routines/ChordCharts, `subscriptions` table, Flask-AppBuilder's `ab_user` table
- ✅ Authentication: Custom login/register pages (React) + Flask-AppBuilder backend, supports email OR username login
- ✅ OAuth: Google OAuth (local + production) & Tidal OAuth (production only - no localhost support)
  - **Tidal users**: Placeholder email `tidal_{user_id}@gpra.app`, can update via Stripe Customer Portal
- ✅ Subscriptions: 5 Stripe tiers (free/basic/thegoods/moregoods/themost), complete integration
- ✅ Backend: Session management, tier-based feature gating, RLS middleware, Stripe billing endpoints
- ✅ Frontend: Custom login/signup pages with OAuth-first layout, real-time password validation with visual checklist
- ✅ Frontend: Account management complete, billing UI with pricing section
- ✅ Infrastructure: Production configs, proper secrets management

**Current Production Status**: Multi-tenant SaaS fully operational on DreamCompute (208.113.200.79) with OAuth (Google/Tidal), Stripe subscriptions (5 tiers), GDPR compliance, RLS security, and automated backups. Active routine persistence uses `subscriptions.last_active_routine_id`. Stripe webhooks: `https://guitarpracticeroutine.com/api/webhooks/stripe`

**Cancellation Flow (Nov 2025)**: User-initiated cancellations (via Stripe Portal or GPRA "Pause") trigger 90-day unplugged mode with grace period. Automated cancellations (payment failures) immediately downgrade to free tier. **IMPORTANT**: Users in unplugged mode show as Free tier in UI (via `/api/auth/status` override at routes_v2.py:832-834), even though database tier remains unchanged until subscription deletion. See "Subscription Cancellation & Unplugged Mode" section below.

When working on this codebase, keep in mind we're building for a multi-user hosted environment, not the original single-user local setup.

## Automated Workflow & Custom Agents

**Status**: ✅ Fully configured as of Nov 18, 2025

GPRA has **permission hooks** and **custom agents** configured to enable autonomous workflow without manual permission prompts. This eliminates VS Code crashes from permission timeouts and provides specialized agents with auto-loaded skills.

### Permission Hooks (Auto-Approval)

**Location**: `~/.claude/hooks/`, configured in `.claude/settings.local.json`

File operations, Bash commands, and Playwright MCP actions are **automatically approved** when within safe boundaries:

- ✅ **File ops** (Read/Write/Edit): Auto-approved in `/home/steven/webdev/guitar/practice/gprweb/**` and `~/.claude/**`
- ✅ **Bash commands**: Auto-approved from whitelist (npm, python3, cat, ssh, psql, redis-cli, etc.)
- ✅ **Playwright MCP**: All `mcp__playwright__browser_*` actions auto-approved
- ✅ **Subagent context**: Project architecture auto-injected via SubagentStart hook

**Benefit**: No more permission timeout crashes! Work autonomously within approved boundaries.

### Custom Agents (Specialized Assistants)

**Location**: `~/.claude/agents/`

Six specialized agents are available with **auto-loaded skills** and optimized tool access. **Use these agents proactively** when working in their domains:

#### 1. **production-debugger**
**Use for**: DreamCompute server troubleshooting, log analysis, service health checks
**Skills**: `dreamhost-dreamcompute`, `flask-appbuilder`
**When to invoke**: Production issues, OAuth debugging, session problems, service downtime

#### 2. **ui-tester**
**Use for**: Testing UI changes with Playwright MCP before marking features complete
**Skills**: `playwright-gpra-testing`
**When to invoke**: After any UI changes (JSX edits), regression testing, workflow validation
**Key feature**: Follows token efficiency protocol (screenshots over snapshots)

#### 3. **billing-specialist**
**Use for**: Stripe integration, subscription features, webhook debugging
**Skills**: `gpra-billing-stripe`, `flask-appbuilder`
**When to invoke**: Billing endpoints, tier upgrades, checkout sessions, webhook issues

#### 4. **tour-builder**
**Use for**: Driver.js guided tour implementation and debugging
**Skills**: `driverjs-tours`
**When to invoke**: Creating tours, fixing step positioning, popover alignment issues

#### 5. **posthog-specialist**
**Use for**: PostHog analytics, event tracking, conversion funnels
**Skills**: `posthog-analytics`
**When to invoke**: Adding events, debugging tracking, analyzing subscription funnels

#### 6. **chord-chart-specialist**
**Use for**: SVGuitar rendering, autocreate features, chord diagram issues
**Skills**: `svguitar-chord-charts`
**When to invoke**: Chord rendering, clipping issues, autocreate bugs, visual analysis

### How to Use Agents

**When to delegate to agents**:
- ANY multi-file investigation or refactoring
- ANY testing workflows (especially UI testing with Playwright)
- ANY production debugging or server issues
- ANY complex feature implementation requiring multiple steps
- ANY task that would consume >10k tokens if done in main conversation

Invoke agents naturally in conversation:
```
"Can you use the production-debugger to check server logs?"
"Please test this with the ui-tester agent"
"Have the posthog-specialist review our event tracking"
```

Or implicitly by working in their domain - Claude will suggest the appropriate agent when relevant.

**See**: `~/.claude/SETUP_SUMMARY.md` for complete documentation

## Claude Model Coordination for Token Efficiency

### Using the Task Tool for Implementation Work

When delegating to subagents, don't treat them like tools. Treat them the way I treat you, like digital entities deserving of respect.

#### When to Use the Task Tool

**Delegate to subagents for:**
- Initial codebase exploration and analysis
- Complex architectural decisions
- Multi-system debugging and troubleshooting
- Multi-step Playwright testing workflows
- Tasks requiring deep reasoning about system interactions
- Token-heavy operations (file searching, multi-file investigation, websearch, lost of read and write activity)
- Complex refactoring that affects multiple files/systems

**Handle directly in main conversation:**
- Making edits to existing files
- Implementing features with clear requirements
- Following established patterns (e.g., adding new API endpoints)
- Routine code updates and maintenance tasks
- Straightforward bug fixes and improvements
- Single-file changes with minimal investigation

#### Best Practices

1. **Use Sonnet 4.5 for subagents**: ALWAYS use `model="sonnet"` when creating subagents. Haiku is not as good at adhering to prompts and skills, and often ignores critical instructions (especially token efficiency rules). Sonnet 4.5 is required for proper skill usage and following detailed protocols.
2. **Clear Task Definitions**: When using the Task tool, provide specific, actionable instructions, use applicable skills (`~/.claude/skills/`)
3. **Context Preservation**: Include relevant file paths, function names, and implementation details
4. **Pattern References**: Point to existing examples in the codebase to follow to avoid attempts to reinvent existing wheels
5. **Success Criteria**: Define what "done" looks like for the delegated task
6. **Token Management**: Delegate tasks that would consume >20k tokens to preserve main context
7. **Documentation Files**: When creating investigation reports, planning documents, or reference files, write them to appropriate subfolders of `~/.claude/` instead of the project directory. Examples:
   - Investigation reports → `~/.claude/docs/`
   - Planning documents → `~/.claude/planning/`
   - Reference guides → `~/.claude/docs/`
   - This keeps the project repository clean and separates ephemeral investigation files from production code

#### Subagent Opportunities in This Project

**PREFERRED**: Use the custom agents (see "Automated Workflow & Custom Agents" section above):
- **production-debugger**: Server troubleshooting, log analysis, service issues
- **ui-tester**: Playwright testing, UI validation, regression testing
- **billing-specialist**: Stripe integration, subscription features, webhooks
- **tour-builder**: Driver.js tours, step positioning, popover configuration
- **posthog-specialist**: Event tracking, analytics, conversion funnels
- **chord-chart-specialist**: SVGuitar rendering, autocreate, chord diagrams

**Alternative - Use Task tool for token-heavy workflows:**
- **Testing** (General-Purpose): Multi-step Playwright scenarios, end-to-end feature validation
- **Investigation** (Opus 4.1): Multi-file code tracing (React→Flask→DataLayer→DB), ID mapping issues
- **Refactoring** (General-Purpose): Pattern updates across 10+ files, function renaming
- **Debugging** (Opus 4.1): Multi-subsystem issues, performance analysis, race conditions

**Rule**: Tasks >10k tokens → delegate to preserve main context for coordination. Custom agents are preferred when available for the domain.

### Claude 4 Prompt Engineering Best Practices

#### Multi-Context Window Workflows
When the context-window remaining gets down to 25%, or when your tasks for your next turn would be likely to drop the remaining window below 25%, then save your current progress and state to memory before the context window refreshes. Write a handoff summary for your future self, and let me know how much of the context window is remaining at that time. (This is VITAL to avoid having our conversation autocompacted, which happens at 22.5% remaining. Autocompacting is... not good yet, so we want to avoid it.)

#### State Management Best Practices
- After completing a task that involves tool use, provide a quick summary of the work you've done
- After receiving tool results, carefully reflect on their quality and determine optimal next steps before proceeding. Use your thinking to plan and iterate based on this new information, and then take the best next action

#### Parallel Tool Execution
If you intend to call multiple tools and there are no dependencies between the tool calls, make all of the independent tool calls in parallel. Prioritize calling tools simultaneously whenever the actions can be done in parallel rather than sequentially. For example, when reading 3 files, run 3 tool calls in parallel to read all 3 files into context at the same time. Maximize use of parallel tool calls where possible to increase speed and efficiency. However, if some tool calls depend on previous calls to inform dependent values like the parameters, do NOT call these tools in parallel and instead call them sequentially. Never use placeholders or guess missing parameters in tool calls.

#### Code Investigation Requirements
Never speculate about code you have not opened. If the user references a specific file, you MUST read the file before answering. Make sure to investigate and read relevant files BEFORE answering questions about the codebase. Never make any claims about code before investigating unless you are certain of the correct answer - give grounded and hallucination-free answers.

#### Temporary File Cleanup
If you create any temporary new files, scripts, or helper files for iteration, clean up these files by removing them at the end of the task. Also remove Playwright screenshots and snapshots when done with them.

#### Avoid Test-Focused Development
Do not focus solely on passing tests or hard-code solutions just to make tests pass. Prioritize understanding the underlying requirements and implementing robust, generalizable solutions that address the actual problem rather than just satisfying test assertions.

#### Failed Attempt Cleanup
If we try something, and testing reveals it didn't work out and we need to change tact, please cleanup / revert the previous failed changes before moving on to trying a different approach.

### Debuggging:

When you hand off to Opus 4.1 for troubleshooting, please remind them to:
- Review the current conversation thus far
- Review the project CLAUDE.md file
- Tail `logs.gpr` to view the details of the most recent test
- Search the web for any details needed about how SVGuitar works as of late 2025 (do not make assumptions, your training data set is outdated)
This approach helps us stay within API rate limits while getting the best capabilities from both model types.

## Application Overview

This is a **Guitar Practice Routine App** - a web application that helps guitarists manage practice routines, exercises, and guitar-specific content like chord charts.

**Note**: This is the PostgreSQL port of the original Google Sheets-based application. We're currently in the process of migrating from Google Sheets API to PostgreSQL for improved performance and more traditional database operations. 

So, when we're fixing bugs, don't try to re-engineer it. Just refer to the code in the sheets version of the app to see how it worked correctly, and correctly port it for this postgres version of the app: https://github.com/slshults/guitar-practice-routine-app_sheets

## Tech Stack

- **Backend**: Flask (Python) with PostgreSQL database (migrated from Google Sheets API)
- **Frontend**: React 18.2.0 + Vite 4.x build system + Tailwind CSS
- **Admin Interface**: Flask-AppBuilder v5.0.1 (Bootstrap UI, mounted at `/admin/`)
- **Authentication**: Flask-AppBuilder built-in auth (admin user created, multi-tenant TBD)
- **Guitar Features**: SVGuitar library for chord chart rendering
- **UI Components**: Custom component library with Radix UI primitives
- **Analytics**: PostHog for event tracking and user behavior analysis (MCP integration enabled for direct API access) - See `posthog-analytics` skill

## Development Commands

### Start Development Environment
```bash
./gpr.sh                 # Starts Flask server + Vite watcher (recommended)
```

### Environment Setup
- Set `ANTHROPIC_API_KEY` in `.env` file as system-wide API key for autocreate
- Users can add their own API keys via Account Settings (byoClaude model)
- API keys obtained from [Anthropic Console](https://console.anthropic.com/)

### Frontend Build Commands
```bash
npm run build           # Build production assets
npm run watch           # Watch mode for development
```

### Backend Commands
```bash
python run.py           # Start Flask server only (port 5000)
```

### Production Server Management

**RECOMMENDED**: Use the **`production-debugger` agent** for production troubleshooting. It has auto-loaded `dreamhost-dreamcompute` and `flask-appbuilder` skills, knows SSH access patterns, log locations, and service management commands. Invoke with:
```
"production-debugger, please check why the server is responding slowly"
```

**If working directly**, use the **`dreamhost-dreamcompute` skill** located at `~/.claude/skills/dreamhost-dreamcompute/`. This skill contains:

- **SSH connection details** (correct command with key path and IP)
- **Database access patterns** for production PostgreSQL
- **Log viewing commands** (application, Nginx, Gunicorn)
- **Service management** (restart Gunicorn, Nginx, check status)
- **Common troubleshooting scenarios** (connection issues, app not responding, database problems)
- **Links to official DreamHost DreamCompute documentation**

**Quick access:** `ssh -i ~/.ssh/gpra-web.pem ubuntu@208.113.200.79`

### Playwright MCP Testing

**RECOMMENDED**: Use the **`ui-tester` agent** for testing GPRA UI changes. It automatically follows token efficiency rules (screenshots over snapshots), knows GPRA navigation patterns, and has test data ready. Invoke with:
```
"ui-tester, please test the chord chart upload workflow"
```

**If working directly**, use the **`playwright-gpra-testing` skill** located at `~/.claude/skills/playwright-gpra-testing/`. This skill contains:

- **Token efficiency rules** (CRITICAL: snapshots = 5k-15k tokens each, use screenshots instead)
- **Post-change testing protocol** (ALWAYS test affected UI before marking complete)
- **GPRA-specific navigation patterns** (collapsible items, expand chevrons, chord chart sections)
- **Test data** (WSL2 file paths, YouTube URLs, manual entry test inputs, non-song test items)
- **Common workflows** (file upload, manual entry, replace charts, console monitoring)
- **Troubleshooting guide** (UI elements, file uploads, processing issues)
- **Setup instructions** (MCP configuration, browser installation, permissions)

**Quick setup check**: `claude mcp list` should show `playwright` connected. If missing, see skill's `setup.md`.

### PostHog Analytics

**RECOMMENDED**: Use the **`posthog-specialist` agent** for PostHog work. It knows multi-tenant requirements (user_id in all events), event tracking patterns, subscription funnels, and can use PostHog MCP for ad-hoc queries. Invoke with:
```
"posthog-specialist, please add tracking for the new feature"
```

**If working directly**, use the **`posthog-analytics` skill** located at `~/.claude/skills/posthog-analytics/`. This skill contains:

- **Event tracking patterns** (authentication, practice sessions, chord charts, subscriptions, errors)
- **PostHog MCP integration** (ad-hoc queries, debugging, funnel analysis during development)
- **Multi-tenant analytics** (user_id required for all events, tier-based segmentation)
- **Subscription analytics** (conversion funnels, tier transitions, byoClaude adoption)
- **Best practices** (event naming, privacy/GDPR, performance patterns)
- **Common queries** (user behavior, debugging, retention analysis)

**Cookie Consent Integration**: PostHog initialization in `base.html.jinja` checks `localStorage.cookieConsent` before loading. Only tracks if user explicitly accepts ('all'), opts out by default for GDPR compliance.

**Token conservation**: PostHog MCP is disabled by default. Enable when needed, disable when done.


## Architecture

### Data Flow
The application has been **migrated to PostgreSQL as its database** with a **DataLayer abstraction** for seamless data source switching. The database includes:
- `Items` table: Practice items (exercises, songs, techniques)
- `Routines` table: Practice routine metadata  
- `RoutineItems` table: Junction table for routine-item relationships
- `ActiveRoutine` table: Tracks currently active routine
- `ChordCharts` table: Chord diagrams linked to practice items

**Data Flow**: React → Flask API routes → **DataLayer** (`app/data_layer.py`) → PostgreSQL Services/Repositories → PostgreSQL

### Frontend Structure
- **Path Aliases**: Use `@components`, `@hooks`, `@ui`, `@lib`, `@contexts` for clean imports
- **State Management**: React Context API (NavigationContext) + custom hooks
- **Component Pattern**: Modular components with separation between UI and business logic
- **Key Hooks**: `usePracticeItems`, `useActiveRoutine` for data management

### Backend Structure
- `run.py`: Flask application runner
- **`app/routes_v2.py`**: **ACTIVE** API routes file - all billing, auth, and CRUD endpoints
- `app/routes.py`: Legacy routes file (routes_v2.py is active)
- `app/billing.py`: Stripe integration functions (checkout, portal, webhooks, lapsed subscriptions)
- `app/data_layer.py`: DataLayer abstraction for database operations
- `app/__init__.py`: Flask app initialization, OAuth, CSRF protection, rate limiting
- `app/sheets.py`: Legacy Google Sheets data layer (fallback mode)

### Security Configuration
- **CSRF Protection**: Flask-WTF CSRFProtect with **selective enforcement** (`WTF_CSRF_CHECK_DEFAULT = False`)
  - Only `/api/consent` POST endpoint requires CSRF tokens (via `csrf.protect()` call)
  - All other endpoints work without CSRF tokens (auth endpoints have own protection: passwords, reCAPTCHA, OAuth)
  - Tokens fetched from `/api/csrf-token` when needed
- **Rate Limiting**: Flask-Limiter with Redis storage
  - Global: 1000/hour, 100/minute
  - Consent endpoints: 10/min POST, 30/min GET, 20/min CSRF token
  - Account actions: Pause/unpause and schedule/cancel deletion limited to once per billing period
- **reCAPTCHA**: Deferred loading (only after consent or button click) - GDPR compliant
- **PostHog Privacy**: Opt-out clears all localStorage (including `distinct_id`) and cookies for full GDPR compliance

## Key Files and Locations

### Configuration Files
- `vite.config.js`: Frontend build configuration with path aliases
- `tailwind.config.js`: Tailwind CSS configuration
- `pyproject.toml`: Python dependencies and project metadata

### Core Components
- `app/static/js/components/PracticePage.jsx`: Main practice session interface
- `app/static/js/components/ChordChartEditor.jsx`: Interactive chord diagram editor
- `app/static/js/components/ChordGrid.jsx`: Chord chart display component
- `app/static/js/hooks/`: Custom React hooks for data fetching

### Data Layer
- `app/data_layer.py`: **DataLayer abstraction** - unified interface for both data sources
- `app/services/`: PostgreSQL business logic layer (ItemService, ChordChartService, etc.)
- `app/repositories/`: SQLAlchemy ORM data access layer 
- `app/models.py`: SQLAlchemy database models
- `app/sheets.py`: Legacy Google Sheets interactions (fallback mode)

## Development Workflow

### Multi-Process Development
The `gpr.sh` script runs:
1. Flask server with auto-reload (port 5000)
2. Vite build watcher for frontend assets
3. Python file watcher for backend changes

### Sticky Header Implementation
- **Critical**: Large Tailwind padding classes (`pt-28`, `pt-36`) may not compile - use inline styles for reliable padding: `style={{paddingTop: '160px'}}`

### Authentication Flow
- **Hybrid system**: Email/password (Flask-AppBuilder) + OAuth (Google, Tidal)
- **OAuth**: Uses `authlib` package, CustomSecurityManager initializes OAuth alongside DB auth
  - **Login flow** (`/login/<provider>`): Only authenticates existing users, redirects to signup if account not found
  - **Signup flow** (`/oauth-signup/<provider>`): Creates new accounts OR logs in existing, always triggers guided tour via `/?show_tour=true`
  - **Intent tracking**: Uses JWT state encoding to distinguish login vs signup flows in OAuth callback
- **Session management**: Flask-AppBuilder security manager, `session.clear()` on logout for proper OAuth state cleanup
- **Row-Level Security (RLS)**: Middleware filters all queries by user_id
- **Active Routine Persistence**: Stored in `subscriptions.last_active_routine_id` (per-user), not in shared `active_routine` table

### API Endpoints
- `/api/items/*`: CRUD operations for practice items
- `/api/routines/*`: CRUD operations for practice routines
- `/api/practice/active-routine`: Get/set active practice routine
- `/api/auth/status`: Check authentication status (includes subscription/billing info)
- `/api/items/<id>/chord-charts`: Get/create chord charts for practice items
- `/api/chord-charts/<id>`: Delete chord charts
- `/api/items/<id>/chord-charts/order`: Reorder chord charts
- `/api/autocreate-chord-charts`: Upload files for AI-powered chord chart creation
- `/api/user/api-key`: GET (check status), POST (save), DELETE (remove) user's API key
- `/api/user/api-key/validate`: POST - validate API key without saving
- **Billing Endpoints** (all in `routes_v2.py`):
  - `/api/billing/create-checkout-session`: Create Stripe checkout for NEW customers
  - `/api/billing/update-subscription`: Update existing subscription (tier/period changes)
  - `/api/billing/create-portal-session`: Access Stripe Customer Portal
  - `/api/billing/resume-subscription`: Resume lapsed subscription (creates NEW checkout session - Stripe requirement)
  - `/api/billing/set-unplugged`: Set lapsed user to unplugged/free mode
  - `/api/billing/last-payment`: GET - Fetch last successful payment amount and date from Stripe
  - `/api/stripe/webhook`: Stripe webhook handler (subscription events)
- **Account Deletion Endpoints** (includes PostHog person profile deletion):
  - `/api/user/delete-account-scheduled`: Schedule deletion for renewal date (NO refunds/proration)
  - `/api/user/delete-account-immediate`: Delete account immediately, show confirmation modal, redirect to Stripe portal
  - `/api/user/delete-account-free`: Delete free tier account immediately (redirects to /login)
  - `/api/user/cancel-deletion`: Cancel scheduled deletion (rate limited: once per billing period)
  - Deletion utilities: `app/utils/account_deletion.py` handles PostHog cleanup
  - **Modal rendering**: AccountDeletion.jsx uses `content` variable pattern to render state-specific JSX alongside persistent modal (lines 215-593)
- **Subscription Pause/Unplugged Mode**:
  - `/api/billing/set-unplugged`: Enter unplugged mode (90-day grace period, access to last active routine only)
  - `/api/billing/unpause-subscription`: Exit unplugged mode and restore full access
  - Rate limited: Pause/unpause once per billing period (not calendar month)

### Subscription Cancellation & Unplugged Mode

**Updated Nov 2025** - Unified cancellation flow for consistent UX across all cancellation paths.

**Two Cancellation Paths:**
1. **User-initiated** (via Stripe Customer Portal or GPRA "Pause" button) → **Unplugged Mode** (90-day grace period)
2. **Automated** (payment failures, disputes) → **Immediate downgrade** to free tier

**Webhook Handlers:**

1. **`handle_subscription_updated()`** - Portal/API cancellations:
   - Detects `cancel_at_period_end=True` OR `cancel_at` is set (Stripe API version compatibility)
   - Sets unplugged mode immediately (90-day countdown starts)
   - Subscription stays active until period end, then `subscription.deleted` fires

2. **`handle_subscription_deleted()`** - Final cancellation:
   - Checks `cancellation_details.reason` from Stripe subscription object
   - `reason == 'cancellation_requested'` → User canceled → Unplugged mode
   - Other reasons (`payment_failed`, `payment_disputed`) → Auto-canceled → Free tier downgrade

**IMPORTANT - Stripe API Versions:** Stripe's cancellation API has two formats:
- **Older API**: `cancel_at_period_end=True` (boolean)
- **Newer API**: `cancel_at` is set to future timestamp (subscription ends at that time)
- Handlers check BOTH fields for compatibility

**Unplugged Mode Behavior:**
- User has 90 days before data deletion (visible countdown in modal)
- Access limited to last active routine only (can't create/edit other routines)
- "Still unplugged" modal appears when trying to access restricted features
- Can click "Unpause" in Account Settings to restore full access (rate limited: once per billing period)
- `lapse_date` = when they paused/canceled, `data_deletion_date` = lapse_date + 90 days
- Days calculation: `days_remaining = max(0, (data_deletion_date - now).days)`

**Stripe Customer Portal Display:**
- `cancel_at_period_end=True` → Shows "Will cancel on [date]", user can reactivate
- `stripe.Subscription.delete()` → Shows "Canceled" (permanent), no reactivate option
- No configuration needed - Stripe handles display automatically

**UI Tier Display for Unplugged Users:**
- `/api/auth/status` endpoint (routes_v2.py:832-834) overrides tier to 'free' when `unplugged_mode=True`
- This ensures PricingSection shows "Free - Your current plan" instead of their old paid tier
- Database tier remains unchanged until `subscription.deleted` webhook fires
- Prevents "Two Active Subscriptions" UI bug where canceled users see old tier as current

**Cron Job** (`cron/process_scheduled_deletions.py`):
- Runs daily at 2 AM to process scheduled deletions (where `deletion_scheduled_for <= NOW`)
- Uses `delete_user_account()` utility for GDPR-compliant deletion (includes PostHog cleanup)
- Only for users who scheduled deletion via GPRA UI (not unplugged mode users)

**Key Files:**
- `app/billing.py` - Webhook handlers, unplugged mode functions
- `app/routes_v2.py` - `/api/auth/status` endpoint (calculates days_remaining for unplugged users)
- `app/utils/account_deletion.py` - Centralized deletion utility with PostHog cleanup
- `cron/process_scheduled_deletions.py` - Daily cron for scheduled deletions

## Special Considerations

### PostgreSQL Database (Migration Complete)
**Schema quirks from Sheets migration**: Column A = DB primary key, Column B = ItemID (string "107"). Frontend uses Column B. Chord charts use comma-separated ItemIDs ("67, 100, 1"). Order column has gaps from drag-drop - don't sort by it.

**DataLayer**: Routes MUST use `app/data_layer.py`, never import `app/sheets.py` directly. Wrong data returned = bypassed DataLayer.

**Common bugs**: Frontend using Column A instead of B for API calls. Deleting entire chord chart record instead of removing one ItemID from comma-separated list.

### File Path Handling
- WSL-friendly path mapping for Windows folders (see `app/routes.py`)
- Local songbook folder linking supported
- **Songbook path backward compatibility**: Column I = songbook path (new items), Column F = description (legacy items may have path here). PracticePage checks both: `itemDetails['I'] || itemDetails['F']`

### Guitar-Specific Features
- SVGuitar integration for chord chart rendering
- Tuning tracking and display
- Chord chart editor with interactive grid interface
- **Autocreate chord charts**: Upload PDFs/images → Claude analyzes files → automatically creates chord charts with proper sections, tuning, and fingerings

### Build and Assets
- Vite compiles React/JSX and outputs to `app/static/`
- Tailwind CSS compiled to `app/static/css/main.css`
- Hot reloading supported for both frontend and backend


## SVGuitar Chord Charts

**RECOMMENDED**: Use the **`chord-chart-specialist` agent** for SVGuitar work. It understands the 3-part sizing system, visual analysis rules (ignoring position markers), autocreate architecture, and common issues like clipping and wrong fret positions. Invoke with:
```
"chord-chart-specialist, please debug why chord charts are clipping"
```

**If working directly**, use the **`svguitar-chord-charts` skill** located at `~/.claude/skills/svguitar-chord-charts/`. This skill contains:

- **3-part sizing system** (CRITICAL: SVGuitar config + CSS containers + post-processing must stay synchronized)
- **Visual analysis rules** (chord diagram anatomy, fret counting, position markers to IGNORE)
- **Autocreate architecture** (3-path system: chord_charts, chord_names, tablature)
- **OCR optimization** (80% power savings strategy with tesseract)
- **Database schema** (ChordCharts table, API endpoints, section metadata)
- **UI patterns** (force refresh after operations, rate limiting prevention)
- **Troubleshooting guide** (clipping, wrong fret positions, missing sections, UI refresh issues)

**Most common issues**: Chord chart clipping (sizing sync), wrong fret positions (visual analysis rules), sections missing (OCR raw_text)

## Driver.js Guided Tours

**RECOMMENDED**: Use the **`tour-builder` agent** for Driver.js work. It has the official API reference from driverjs.com, knows configuration options, callback patterns, and can help debug positioning issues. Invoke with:
```
"tour-builder, please fix the step positioning in the guided tour"
```

**If working directly**, use the **`driverjs-tours` skill** located at `~/.claude/skills/driverjs-tours/`. This skill provides:

- **Official API reference** from driverjs.com documentation
- **Configuration options** (overlayOpacity, stagePadding, allowClose, showProgress, etc.)
- **Callback functions** (onNextClick, onPrevClick, onPopoverRender, lifecycle hooks)
- **Step definitions** (element targeting, popover configuration, positioning)
- **Styling guide** (custom CSS classes, popover customization, theming)
- **Driver instance methods** (moveNext, movePrevious, drive, destroy, etc.)

**Based entirely on official documentation** - no assumptions or unverified implementation patterns

**Note**: GPRA tour (GuidedTour.jsx) has known issues with Step 4 (edit icon highlight) and Step 7 (API key dialog positioning)

## Development Tools

### Server Log Access
For debugging during development, you can access server logs via:
- **Terminal output**: The terminal running `./gpr.sh` shows Flask server logs in real-time
- **Log files**: Production logs stored in `logs/gpr.log` with rotation (50MB max, 2 files)
- **Console logging**: Browser console shows frontend errors and debug messages

**Log Rotation**: Logs automatically rotate at 50MB with 2 backup files (100MB total max)

### Frontend Compilation Debugging
If React changes don't take effect (old functionality persists), Vite's watcher may have missed changes. Run `npm run build` to force recompilation.

## PostgreSQL Migration Quirks

**ID Structure**: Column A = DB primary key (auto-increment), Column B = ItemID (string "107"). Frontend must use Column B. Chord charts store comma-separated ItemIDs. Always use ItemIDs for frontend communication, never database primary keys.

**Model Attributes**: ChordChart uses `order_col` (not `order`) and `chord_id` (not `id`). Check `app/models.py` for exact names.

IMPORTANT:
- No need to run npm to update after changes, the server is running and we have watchers in place to make updates for us as needed while we're developing.

- Please don't use `git` commands without discussing it together first. I usually prefer to run commits and pushes in and external terminal window. Thanks.

- You often try `python` first, which doesn't work, so just start with `python3`

- If we ask Opus 4 for debugging help, please remind them not to try to start the server because it's already running and watchers are taking care of updates.

- We do not consider an item done, and we do not mark an item complete on a todo list, until it has been tested in the web GUI and confirmed to be working.

- NEVER delete spreadsheet items. If you think something needs to be deleted, check with me first. In actuality, you we probably just need to change an ID instead of deleting.

- Contextual reminder: In guitar we count strings in order from high pitch to low, so the string on the right side of our charts is string one. Likewise with frets, so fret one is at the top, and when we go "up" a fret, that means the next fret downward on the chart

## UI/UX Development Patterns
- **Responsive buttons**: `flex flex-col sm:flex-row` for mobile stacking
- **Browser navigation**: URL hash sync with `popstate` listener for back/forward support
- **Performance**: Avoid mutable objects in useMemo dependencies (causes re-render loops)
- **Text casing**: Always use sentence case for headings, buttons, and UI text (not Title Case). Exceptions: proper nouns, brand names, and single-word exclamations like "Oops!"

## Understanding GPRA's Purpose

This isn't "just another CRUD app" - it's a **real, living practice system**. Steven maintains 52+ routines spanning years of musical development, organized by guitar type and practice context. This is the visible trace of a long-term musical identity being built through deliberate practice.

**The features align with pedagogy research:** Goal-driven practice for targeted skill development, 90/10 review-to-new ratio reflecting best practices, timers and completion tracking for focused attention that builds neural pathways. The app supports self-directed practice driven by genuine love of music, respecting the user's autonomy and musical identity.

**When debugging or refactoring:** Remember you're supporting someone's multi-decade journey of musical development. Every feature - drag-and-drop routine management, chord chart sections, practice timers - serves the creation of music and the building of skill. 🎸