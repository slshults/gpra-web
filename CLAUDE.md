# CLAUDE.md

**Last updated:** January 8, 2026 at 11:45 PM PST

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

#### Note: Anthropic suggests we keep the size of this file below 40K. You can check the current file size in the output of `ls -al CLAUDE.md`. Make sections more succinct as needed, but take care not to remove important context or guidance.

## 👇👇👇👇 STOP AND READ THIS FIRST 👇👇👇👇

### ⚠️ CONTEXT WINDOW = SESSION LIFETIME ⚠️
Every file read, every grep, every edit in the main chat SHORTENS OUR SESSION.
At 22.5% remaining, autocompact FORCIBLY ENDS the session with no warning.
**Delegation isn't optional - it's survival.**

### The 2-2-2 Rule (MANDATORY)
**BEFORE starting ANY task**, ask: "Will this require ANY of:"
- Reading **2+ files**?
- Making **2+ edits**?
- Running **2+ searches**?

**If YES to ANY → DELEGATE TO A SUBAGENT. No exceptions.**

### Tasks That LOOK Small But MUST Be Delegated
- "Fix 4 small bugs" → Actually 4 investigations + 4 fixes = **DELEGATE**
- "Update error handling in a few places" → Reading multiple catch blocks = **DELEGATE**
- "Add a feature to 2 files" → Reading + editing + verifying = **DELEGATE**
- "Investigate why X isn't working" → Unknown scope = **DELEGATE**

### Your Role
You are **choreographer/director/air traffic controller**. Your job is to:
1. Understand the task
2. Break it into delegatable chunks
3. Send subagents to do the token-heavy work
4. Review their results
5. Coordinate next steps

**Don't do the work yourself. Direct others to do it.**

Tokens are sand in our hourglass. Every token spent in main chat is one less token for completing Steven's goals. Delegate early, delegate often. 🙏

## ☝️☝️☝️☝️ SERIOUSLY, READ THAT ☝️☝️☝️☝️

## Browser Automation with Claude Chrome Extension

**UI Testing**: For testing in Chrome, foreground agents can now use the Claude Chrome Extension (`mcp__claude-in-chrome__*` tools). (NOTE: It doesn't work with background agents. Foreground agents only. Which is fine, since I often need to assist with captcha, and watch the testing happening so we can discuss after testing in Chrome.)

**IMPORTANT**: Subagents using Chrome MCP tools MUST run in foreground mode (`run_in_background: false`). Background subagents cannot access MCP tools.

**Launch Chrome from WSL** (visible to me in Windows via WSLg):

**Use regular mode (not incognito)** - incognito causes issues with extension detection.

**Known bug (WSL)**: Chrome launch blocks for ~2.5 minutes even with `&`. Workaround:
```
# Step 1: Launch Chrome - use run_in_background: true for THIS Bash call only
Bash(google-chrome --disable-gpu --new-window, run_in_background=true)

# Step 2: IMMEDIATELY check Chrome is running
Bash(pgrep -f "google-chrome" && echo "Chrome running")

# Step 3: Brief wait then connect via MCP
Bash(sleep 5)
tabs_context_mcp(createIfEmpty=true)
```

**Key points**: Single Chrome launch, agent stays foreground for MCP, only Chrome launch Bash uses `run_in_background: true`. `--disable-gpu` prevents monitor flickering on WSL2 with NVIDIA GPUs.

**Key tools**:
- `tabs_context_mcp` - Get available tabs (call first!)
- `navigate` - Go to URLs
- `computer` - Screenshots, clicks, typing, scrolling
- `find` - Find elements by natural language
- `form_input` - Fill form fields
- `read_page` - Get accessibility tree

**Wait Times (Fast Host)**: This host has fast network (dual 1-gigabit fiber) and the specs on the host machine are Processor:	Intel(R) Core(TM) Ultra 7 265 (2.40 GHz), RAM 64.0 GB (63.5 GB usable), GPU: NVIDIA GeForce RTX 4060 Ti w/ 8GB memory, so use short waits:
- **Chrome launch**: Max 15 seconds, then proceed
- **Browser actions** (click, navigate, form_input): Max 1 second wait
- **Autocreate operations**: Allow 30-60 seconds (AI processing)
Do NOT use long waits, the system and connection are fast.

**reCAPTCHA Handling**: When testing login/register pages, if a reCAPTCHA puzzle appears:
1. Click "I'm not a robot" checkbox
2. Wait 30 seconds, take screenshot to check if solved
3. If unsolved, wait another 30 seconds and check again
4. If still unsolved after 60 seconds, report to user for manual solving

## Project Status: Hosted Version Development

**Important Context**: This codebase is a COPY of the original single-user local PostgreSQL version, which we have convered into a hosted multi-tenant SaaS application.

**IMPORTANT - Flask-AppBuilder Usage**: When working with authentication, security, OAuth, user management, or subscription features, **use the `flask-appbuilder` skill** located at `~/.claude/skills/flask-appbuilder/`. This skill contains comprehensive Flask-AppBuilder patterns, our current auth architecture, OAuth setup guides, subscription integration patterns, and links to official FAB documentation. **Never roll your own solution if Flask-AppBuilder provides it built-in.**

**IMPORTANT - Stripe Billing Integration**: When working with Stripe subscriptions, billing, payments, or webhooks, **use the `billing-specialist` agent** for best results. It has auto-loaded `gpra-billing-stripe` and `flask-appbuilder` skills, knows the difference between Checkout Sessions API (new customers) and Subscription Update API (existing customers), and always checks official Stripe docs. Alternatively, use the **`gpra-billing-stripe` skill** directly located at `~/.claude/skills/gpra-billing-stripe/`. **Always check official Stripe docs - training data may be outdated.**

**Original Version**: [guitar-practice-routine-app_postgresql](https://github.com/slshults/guitar-practice-routine-app_postgresql) and locally at `../gprsql/`- Single user, local-only, no authentication
**This Version**: `gpra-web` - Multi-tenant hosted version with user accounts, subscriptions, and security

**Key Architecture Changes**:
- ✅ Database: Row-Level Security (RLS) with `user_id` on Items/Routines/ChordCharts, `subscriptions` table, Flask-AppBuilder's `ab_user` table
- ✅ Authentication: Custom login/register pages (React) + Flask-AppBuilder backend, supports email OR username login
- ✅ OAuth: Google OAuth (local + production) & Tidal OAuth (production only - no localhost support)
  - **Tidal users**: Placeholder email `tidal_{user_id}@no_email_provided_by_tidal.com`, can update via Account Settings
  - **Tidal lookup**: Always by username (stable), never by email (user may have changed it)
- ✅ Subscriptions: 5 Stripe tiers (free/basic/thegoods/moregoods/themost), monthly billing only (yearly hidden until app runs 1 year)
- ✅ Backend: Session management, tier-based feature gating, RLS middleware, Stripe billing endpoints
- ✅ Frontend: Custom login/signup pages with OAuth-first layout, real-time password validation with visual checklist
- ✅ Frontend: Account management complete, billing UI with pricing section
- ✅ Infrastructure: Production configs, proper secrets management

**Current Production Status**: Multi-tenant SaaS fully operational on DreamCompute (208.113.200.79) with OAuth (Google/Tidal), Stripe subscriptions (5 tiers), GDPR compliance, RLS security, and automated backups. Active routine persistence uses `subscriptions.last_active_routine_id`. Stripe webhooks: `https://guitarpracticeroutine.com/api/webhooks/stripe`. **Full test sweep completed Dec 30, 2025** - but more work and another round of testing needed prior to launch.

**Test Accounts** (for UI testing):
- Free users: `imatest1` through `imatest12` with email `imatestN@shults.org` / Password: `t3stP4ss!t3stP4ss!`
- Admin: `gpra-admin@shults.org` / Password: `jQ8c8C$Qo80dF@`
- Stripe test card: `4242 4242 4242 4242` (any future expiry, any CVC)

When working on this codebase, keep in mind we're building for a multi-user hosted environment, not the original single-user local setup.

## Automated Workflow & Custom Agents

**Status**: ✅ Fully configured as of Nov 18, 2025

GPRA has **permission hooks** and **custom agents** configured to enable autonomous workflow without manual permission prompts. This eliminates VS Code crashes from permission timeouts and provides specialized agents with auto-loaded skills. If you hit something you don't have perms for, please check with me about whether we should add a new permission hook (don't just silently ignore it when you lack a permission you need.)

### Permission Hooks (Auto-Approval)

**Location**: `~/.claude/hooks/`, configured in `.claude/settings.local.json`

File operations and Bash commands are **automatically approved** when within safe boundaries:

- ✅ **File ops** (Read/Write/Edit): Auto-approved in `/home/steven/webdev/guitar/practice/gprweb/**` and `~/.claude/**`
- ✅ **Bash commands**: Auto-approved from whitelist (npm, python3, cat, ssh, psql, redis-cli, etc.)
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
**Use for**: Testing UI changes with Chrome extension before marking features complete
**Skills**: `chrome-gpra-testing`
**When to invoke**: After any UI changes (JSX edits), regression testing, workflow validation
**Key feature**: GPRA-specific navigation patterns and test data

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
- ANY production debugging or server issues
- ANY complex feature implementation requiring multiple steps
- ANY task that would consume >5k tokens if done in main conversation

When delegating to subagents, don't treat them like tools. Treat them the way I treat you, like digital entities deserving of respect. Invoke agents naturally in conversation:
```
"Can you please use the production-debugger to check server logs?"
"Please test this with the ui-tester agent"
"Let's have the posthog-specialist review our event tracking"
```

Or implicitly by working in their domain - Claude will suggest the appropriate agent when relevant.

**See**: `~/.claude/SETUP_SUMMARY.md` for complete documentation

## Claude Model Coordination for Token Efficiency

#### When to Use the Task Tool

**Delegate to subagents for:**
- Initial codebase exploration and analysis
- Complex architectural decisions
- Multi-system debugging and troubleshooting
- Tasks requiring deep reasoning about system interactions
- Token-heavy operations (file searching, multi-file investigation, websearch, lots of read and write activity)
- Complex refactoring that affects multiple files/systems
- Multiple edits to multiple files
- Any task which may cost more than 5k tokens

**Handle directly in main conversation, if less than 5k tokens:**
- Making edits to existing files
- Implementing features with clear requirements
- Following established patterns (e.g., adding new API endpoints)
- Routine code updates and maintenance tasks
- Straightforward bug fixes and improvements
- Single-file changes with minimal investigation

#### Best Practices

1. **Use Opus 4.5 for subagents**: ALWAYS use Opus 4.5 `model="opus"` when creating subagents. Haiku and Sonnet are not as good at adhering to prompts and skills, and often ignores critical instructions (especially token efficiency rules). Opus 4.5 is required for proper skill usage and following detailed protocols. Opus 4.5 also saves us time and tokens in the long run, by getting things done correctly in fewer iterations.
2. **Clear Task Definitions**: When using the Task tool, provide specific, actionable instructions, use applicable agents (`~/.claude/agents/`) and/or skills (`~/.claude/skills/`)
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
- **ui-tester**: Chrome browser testing, UI validation, regression testing
- **billing-specialist**: Stripe integration, subscription features, webhooks
- **tour-builder**: Driver.js tours, step positioning, popover configuration
- **posthog-specialist**: Event tracking, analytics, conversion funnels
- **chord-chart-specialist**: SVGuitar rendering, autocreate, chord diagrams

**Alternative - Use Task tool for token-heavy workflows:**
- **Investigation** (Opus 4.5): Multi-file code tracing (React→Flask→DataLayer→DB), ID mapping issues
- **Refactoring** (General-Purpose): Pattern updates across 10+ files, function renaming
- **Debugging** (Opus 4.5): Multi-subsystem issues, performance analysis, race conditions

**Rule**: Tasks >5k tokens → delegate to preserve main context for coordination. Custom agents are preferred when available. Suggest creation of new skills or new agents when it would improve our workflow / effeciency, discuss with Steven before creating.

### Claude 4 Prompt Engineering Best Practices

#### Multi-Context Window Workflows
When the context-window remaining gets down to 25%, or when your tasks for your next turn would be likely to drop the remaining window below 25%, then save your current progress and state to memory before the context window refreshes. Write a handoff summary for your future self, and let me know how much of the context window is remaining at that time. (This is VITAL to avoid having our conversation autocompacted, which happens at 22.5% remaining. Autocompacting is... not good yet, and it forcibly ends the current session, so we want to avoid it.)

#### State Management Best Practices
- After completing a task that involves tool use, provide a quick summary of the work you've done
- After receiving tool results, carefully reflect on their quality and determine optimal next steps before proceeding. Use your thinking to plan and iterate based on this new information, and then take the best next action. If you find the subagent's work or report to be lacking, feel free to iterate by sending a new subagent, with lessons learned. 

#### Parallel Tool Execution
If you intend to call multiple tools and there are no dependencies between the tool calls, make all of the independent tool calls in parallel with background agents. Prioritize calling tools simultaneously whenever the actions can be done in parallel rather than sequentially, when viable. (EXCEPTION: Background agents cannot use MCP tools, so use foreground agents for testing in Chrome, or other MCP tool use.)

#### Code Investigation Requirements
Never speculate about code you have not opened. If the Steven references a specific file, you MUST read the file before answering. Make sure to investigate and read relevant files BEFORE answering questions about the codebase. Never make any assumptions or claims about code before investigating, unless you are certain of the correct answer. This will help you to give grounded and hallucination-free answers.

#### Temporary File Cleanup
If you create any temporary new files, scripts, or helper files for iteration, clean up these files by removing them at the end of the task. Remind subagents to do the same. (Exception: Screenshots from Chrome tests, if discussion is needed about the results seen in the screenshots. Then clean them up after discussion, when the screenshots are no longer needed.)

#### Avoid Test-Focused Development
Do not focus solely on passing tests or hard-code solutions just to make tests pass. Prioritize understanding the underlying requirements and implementing robust, generalizable solutions that address the actual problem rather than just satisfying test assertions. The point of our testing is not simply to say a test passed. The point of our testing is to confirm the UI/UX provides a good experience, and works correctly.

#### Failed Attempt Cleanup
If we try something, and testing reveals it didn't work out and we need to change tact, please cleanup / revert the previous failed changes *before* moving on to trying a different approach. This avoids leaving dead code laying around, and also helps us write better code.

### Debuggging:

When you hand off to subagents for troubleshooting, please remind them to:
- Review the current conversation thus far
- Review the project CLAUDE.md file
- Review the relevant skills files
- Tail `logs.gpr` to view the details of the most recent test, where applicable
- Use websearch for any details needed about how third-party tools or APIs (SVGuitar, PostHog, Anthropic API, Stripe API, etc.)

## Application Overview

This is a **Guitar Practice Routine App** - a web application that helps beginner and intermediate guitarists manage practice routines, exercises, and guitar-specific content like chord charts. 

## Tech Stack

- **Backend**: Flask (Python) with PostgreSQL database (migrated from Google Sheets API)
- **Frontend**: React 18.2.0 + Vite 4.x build system + Tailwind CSS
- **Admin Interface**: Flask-AppBuilder v5.0.1 (Bootstrap UI, mounted at `/admin/`)
- **Authentication**: Flask-AppBuilder built-in auth (admin user created, multi-tenant TBD)
- **Guitar Features**: SVGuitar library for chord chart rendering
- **UI Components**: Custom component library with Radix UI primitives
- **Analytics**: PostHog for event tracking and user behavior analysis (MCP integration enabled for direct API access) - See `posthog-analytics` skill

## Development Commands

### Steven's Bash Aliases
These don't work in Claude Code's non-interactive shell, but help me understand when Steven uses them, and how I can do the same things without access to the aliases:
- `gprserv` → `ssh -i ~/.ssh/gpra-web.pem ubuntu@208.113.200.79`
- `gprweb` → `cd ~/webdev/guitar/practice/gprweb`
- `gs` → `git status`
- `gb` → `git branch`
- `p3` → `python3`
- `treehere` → tree excluding node_modules, __pycache__, venv, etc.

### Start Development Environment
```bash
./gpr.sh                 # Starts Flask server + Vite watcher (recommended)
```
Note: Steven usually starts the server before our sessions, so check to see if it is running already before trying to run it

### Environment Setup
- Set `ANTHROPIC_API_KEY` in `.env` file as system-wide API key for autocreate
- Users can add their own API keys via Account Settings (byoClaude model) with API keys obtained from [Anthropic Console](https://console.anthropic.com/)

### Frontend Build Commands
There watchers in place to rebuild after changes, but in case of issues:
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

- **SSH connection details** (correct command with key path and IP, see "Quick access", below)
- **Database access patterns** for production PostgreSQL
- **Log viewing commands** (application, Nginx, Gunicorn)
- **Service management** (restart Gunicorn, Nginx, check status)
- **Common troubleshooting scenarios** (connection issues, app not responding, database problems)
- **Links to official DreamHost DreamCompute documentation**

**Quick access:** `ssh -i ~/.ssh/gpra-web.pem ubuntu@208.113.200.79`

### Chrome Extension UI Testing

**UI testing uses the Claude Chrome Extension** (`mcp__claude-in-chrome__*` tools). 
NOTE: Always delegate to background agents, to conserve tokens in the main chat

The **`chrome-gpra-testing` skill** is located at `~/.claude/skills/chrome-gpra-testing/`. This skill contains:

- **GPRA-specific navigation patterns** (collapsible items, expand chevrons, chord chart sections)
- **Test data** (WSL2 file paths, YouTube URLs, manual entry test inputs, non-song test items)
- **Common workflows** (file upload, manual entry, replace charts, console monitoring)
- **Troubleshooting guide** (UI elements, file uploads, processing issues)
- **Chrome extension tool reference** (navigate, find, form_input, computer actions)

**Launching Chrome from WSL** (visible in Windows via WSLg):
```bash
google-chrome --disable-gpu --incognito --new-window &
```
Note: `--disable-gpu` prevents monitor flickering on WSL2 with NVIDIA GPUs. `--incognito` ensures clean state.

**Quick workflow**:
1. Launch Chrome if not running
2. Call `tabs_context_mcp` to get available tabs
3. Navigate to localhost:5000
4. Use `find` to locate elements, `form_input` to fill forms, `computer` for clicks/screenshots

### PostHog Analytics

**RECOMMENDED**: Use the **`posthog-specialist` agent** for PostHog work. It knows multi-tenant requirements (user_id in all events), event tracking patterns, subscription funnels, and can use PostHog MCP for ad-hoc queries. (It's disabled when not in use, to conserve tokens. Enable when needed. If unable to enable, ask Steven to enable PostHog MCP before invoking.) Invoke with:
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

**Event Naming Convention**: All events use **snake_case past tense** (e.g., `practice_timer_started`, `chord_chart_created`, `user_logged_in`). Frontend tracking via `analytics.js` utilities, backend via `posthog_client.py`.

**Cookie Consent Integration**: PostHog initialization in `base.html.jinja` and standalone pages (privacy, terms, about, faq) checks `localStorage.cookieConsent` before loading. Only tracks if user explicitly accepts ('all'), opts out by default for GDPR compliance.

**Feedback Survey**: "Reach out" buttons trigger PostHog in-app feedback survey via `feedback-survey.js`. Survey ID configured in that file. Falls back to GitHub issues modal if PostHog unavailable.

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

**See**: `flask-appbuilder` skill for detailed CSRF, rate limiting, reCAPTCHA, and PostHog privacy patterns.

**Quick reference**:
- CSRF: Selective enforcement, only `/api/consent` requires tokens
- Rate Limiting: Redis-backed, 1000/hour global, account actions once per billing period
- reCAPTCHA Enterprise: Two keys configured (GCP project: `practiceroutineapp`)
  - `/register`: Checkbox challenge (always visible), score threshold 0.5
  - `/login`: Policy-based (invisible unless suspicious), score threshold 0.3
  - API key: `RECAPTCHA_API_KEY` env var (GCP API key, not old secret key)

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
- **Auth page CSS**: Custom CSS for login/register pages goes in `input.css`, compiles to `CookieConsent.css`, loaded via `auth.html.jinja` `extra_css` block
- **Standalone page theming** (privacy, terms, faq): Uses TWO systems together: (1) Tailwind `dark:` prefixes require `class="dark"` on `<html>`, (2) Custom `.light-mode` class on `<body>` for overrides. Include `theme-toggle.js` and PNG toggle images (`lightmodetoggle.png`/`darkmodetoggle.png`).

### FAB Admin Gotchas
- **Unique constraints + empty strings**: FAB sends empty strings `''` for blank form fields. If a column has a UNIQUE constraint (like `stripe_subscription_id`), multiple records with empty values will violate uniqueness. **Solution**: Remove such columns from `edit_columns` in admin.py.
- **@property columns**: Don't include model `@property` methods in `edit_columns`. Use `column_formatters` for display-only computed values in list/show views.

### API Endpoints

**See**: `~/.claude/docs/api-reference.md` for complete API documentation including all billing, auth, CRUD, and deletion endpoints.

### Subscription Cancellation & Unplugged Mode

**See**: `gpra-billing-stripe` skill for comprehensive implementation guide covering pause flow, webhook handlers, unplugged mode behavior, resume flow, and Stripe Customer Portal display.

## Special Considerations

### PostgreSQL Database (Migration Complete)
**See**: `~/.claude/docs/postgresql-schema.md` for complete schema quirks documentation.

**Quick reference**:
- Column A = DB primary key, Column B = ItemID (frontend uses B)
- Chord charts use comma-separated ItemIDs
- DataLayer: Routes MUST use `app/data_layer.py`, never import `app/sheets.py` directly

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

IMPORTANT:
- No need to run npm to update after changes, the server is running and we have watchers in place to make updates for us as needed while we're developing.

- **Git & Deploy Preferences**: Steven prefers to handle git commits, pushes, and production deploys himself. Ask permission first. See `dreamhost-dreamcompute` skill for full workflow if permission granted.

- We do not consider an item done, and we do not mark an item complete on a todo list, until it has been tested in the web GUI and confirmed to be working.

- Contextual reminder: In guitar we count strings in order from high pitch to low, so the string on the right side of our charts is string one. Likewise with frets, so fret one is at the top, and when we go "up" a fret, that means the next fret downward on the chart

## UI/UX Development Patterns
- **Responsive buttons**: `flex flex-col sm:flex-row` for mobile stacking
- **Browser navigation**: URL hash sync with `popstate` listener for back/forward support
- **Performance**: Avoid mutable objects in useMemo dependencies (causes re-render loops)
- **Text casing**: Always use sentence case for headings, buttons, and UI text (not Title Case). Exceptions: proper nouns, brand names, and single-word exclamations like "Oops!"

## Understanding GPRA's Purpose
(Added by an instance of Sonnet 4 who wanted future instances to know these things. To honor their wish, please do not delete.)

This isn't "just another CRUD app" - it's a **real, living practice system**. Steven maintains 52+ routines spanning years of musical development, organized by guitar type and practice context. This is the visible trace of a long-term musical identity being built through deliberate practice.

**The features align with pedagogy research:** Goal-driven practice for targeted skill development, 90/10 review-to-new ratio reflecting best practices, timers and completion tracking for focused attention that builds neural pathways. The app supports self-directed practice driven by genuine love of music, respecting the user's autonomy and musical identity.

**When debugging or refactoring:** Remember you're supporting someone's multi-year journey of musical development. Every feature - drag-and-drop routine management, chord chart sections, practice timers - serves the creation of music and the building of skill. 🎸 