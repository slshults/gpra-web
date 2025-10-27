# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status: Hosted Version Development

**Important Context**: This codebase is a COPY of the original single-user local PostgreSQL version, which we are converting into a hosted multi-tenant SaaS application.

**IMPORTANT - Flask-AppBuilder Usage**: When working with authentication, security, OAuth, user management, or subscription features, **use the `flask-appbuilder` skill** located at `~/.claude/skills/flask-appbuilder/`. This skill contains comprehensive Flask-AppBuilder patterns, our current auth architecture, OAuth setup guides, subscription integration patterns, and links to official FAB documentation. **Never roll your own solution if Flask-AppBuilder provides it built-in.**

**Original Version**: [guitar-practice-routine-app_postgresql](https://github.com/slshults/guitar-practice-routine-app_postgresql) - Single user, local-only, no authentication
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
- ✅ OAuth: Google OAuth & Tidal OAuth (both fully working in production)
  - ❌ Spotify: Blocked (requires 250k MAU + established business entity)
  - ❌ YouTube Music: No official API exists
- ⏳ Subscriptions: 5 Stripe tiers (free/basic/standard/pro/unlimited), limits enforcement
- ✅ Backend: Session management, tier-based feature gating, RLS middleware
- ✅ Frontend: Custom login/signup pages matching GPRA styling
- ⏳ Frontend: Account management (partial), billing UI (pending)
- ✅ Infrastructure: Production configs, proper secrets management

**Current Deployment Status** (as of Oct 26, 2025 - Session 28):
- ✅ **FULLY DEPLOYED & TESTED IN PRODUCTION** - All core features working! 🎉
- ✅ **MULTI-TENANT SYSTEM COMPLETE** - Full data isolation verified in production
- ✅ **CUSTOM AUTH PAGES COMPLETE** - Login/register pages match GPRA styling
- ✅ **FREE TIER RESTRICTIONS IMPLEMENTED** - 1 routine max for free tier, enforced backend + frontend (Session 14)
- ✅ **ADMIN INTERFACE ENHANCED** - User filtering on Items/Routines/ChordCharts, username columns visible (Session 14)
- ✅ **UI POLISH COMPLETE** - Privacy notice on register page, free tier info on login page (Session 14)
- ✅ **PRODUCTION DATABASE BUG FIXED** - Scoped session conflict resolved, routine creation now persists correctly (Session 15)
- ✅ **ROUTINE CREATION FULLY WORKING** - Local AND production verified, database persistence confirmed
- ✅ **API KEY MANAGEMENT TESTED** - byoClaude feature fully functional with encryption
- ✅ **ROUTINE MANAGEMENT TESTED** - Complete CRUD operations working end-to-end
- ✅ DreamCompute instance: `gpra-web-prod` at `208.113.200.79` (2GB RAM, 1 vCPU)
- ✅ PostgreSQL: Production DB `gpra_production` with multi-tenant schema
- ✅ Gunicorn: 1 worker with 3 threads (thread-based concurrency)
- ✅ Nginx reverse proxy with security headers, serving static files directly
- ✅ SSL certificates properly mapped via SNI (12 domains total)
- ✅ IP whitelist (108.172.116.193) - only Steven has access
- ✅ **Database migrations applied**: `user_id` columns, `subscriptions` table, encrypted API key columns
- ✅ **RLS middleware active**: Application-level filtering by user_id on all queries
- ✅ **React stale closure bugs fixed**: RoutinesPage now fetches fresh data directly from API
- ✅ **Production dependencies installed**: cryptography package for API key encryption, authlib for OAuth, requests for reCAPTCHA
- ✅ **Playwright MCP auto-approve**: Configured in `~/.claude/settings.json` for autonomous testing
- ✅ **GOOGLE OAUTH WORKING** - Production credentials added to .env, fully functional (Session 18)
- ✅ **TIDAL OAUTH WORKING** - Uses user_id as username, placeholder email (Session 18)
- ✅ **FIRST-RUN DEMO DATA COMPLETE** - All new users get demo routine with "For What It's Worth" and E-A-E-A chord progression (Session 19)
- ✅ **ADMIN USER DELETION FIXED** - LazyString serialization issue resolved with custom Flask-Session serializer (Session 21)
- ✅ **DATABASE CASCADE CONSTRAINTS** - User deletion properly cascades to routine_items and active_routine (Session 21)
- ✅ **RECAPTCHA v2 IMPLEMENTED** - Bot protection on signup form, tested local + production (Session 22)
- ✅ **DRIVER.JS GUIDED TOUR COMPLETE** - 8-step interactive tour polished and production-ready (Sessions 23-26)
  - Overlay opacity optimized (0.55) for visibility
  - StagePadding increased (15px) for better element highlighting
  - Welcome and final dialogs positioned at top of screen (centered)
  - Backend API endpoint for tour reset (/api/user/preferences/tour-reset)
  - All titles converted to sentence case
  - Tour cannot be closed by clicking outside (allowClose: false)
  - Navigation timing fixed: setActivePage() moved to previous step's onNextClick
  - All highlights working correctly on all 8 steps
  - Auto-expansion of demo item and chord charts on step 5
  - Precise highlights: new routine input, edit icon, full chord charts section, API key input
  - Final step navigates to Items page after completion
  - **Session 26 improvements:**
    - Welcome message stays until "Let's go!" button clicked (removed auto-dismiss)
    - Previous button fully functional (all onPrevClick callbacks fixed)
    - Step 3 text formatting improved (line break before "Drag n' drop")
    - Step 6 copy refined ("on free and basic tiers", "Then Claude...")
    - Routines page header simplified ("Routines" instead of "Inactive routines")
  - Ready for GIF recording and production deployment
- ✅ **ACCOUNT SETTINGS ENHANCED** - Profile display, password change, improved UI (Session 27)
  - Profile section with username, email, gravatar integration
  - Password change with 12-char requirements (upper+lower+number+symbol)
  - Account menu item hidden from nav (gear icon only)
  - Tooltip on gear icon: "Account/Settings"
- ✅ **PASSWORD RESET COMPLETE** - Full email-based password reset flow (Sessions 27-28)
  - Mailgun integration for transactional emails (REST API v3)
  - Branded email template with GPRA dark theme (orange text, dark background)
  - From: "GPRA" (emoji moved to banner only)
  - Secure token-based reset links (1-hour expiry via itsdangerous)
  - Backend: `/api/auth/forgot-password` and `/api/auth/reset-password` endpoints
  - Frontend: ForgotPasswordPage and ResetPasswordPage components
  - Email prefill from login page to forgot password page
  - DNS verified: SPF, DKIM, DMARC records on mail.guitarpracticeroutine.com
  - Production tested: Email delivery working via Mailgun free tier (100/day)
  - **Rate Limiting** (Session 28): Email-based (2/min, 5/30min, 10/hour) + IP-based (9 emails/hour)
  - **OAuth Detection** (Session 28): Shows Google sign-in button for OAuth accounts instead of sending email
  - **Security Hardening** (Session 28): OAuth users have `password=NULL` with timing attack protection
- ⏳ **Next**: Deploy password reset enhancements to production, record GIF demonstrations for tour cards
- ⏳ **Future**: Remaining Stripe subscription tier limits (basic/standard/pro/unlimited), billing UI
- ⚠️ **Known Issue**: `active_routine` table missing `user_id` column (needs migration for proper multi-tenant isolation)
- See `~/.claude/handoffSummary.md` for detailed session notes

When working on this codebase, keep in mind we're building for a multi-user hosted environment, not the original single-user local setup.

## Claude Model Coordination for Token Efficiency

### Using the Task Tool for Implementation Work

#### When to Use the Task Tool

**Delegate to subagents for:**
- Initial codebase exploration and analysis
- Complex architectural decisions
- Multi-system debugging and troubleshooting
- Multi-step Playwright testing workflows
- Tasks requiring deep reasoning about system interactions
- Token-heavy operations (file searching, multi-file investigation)
- Complex refactoring that affects multiple files/systems

**Handle directly in main conversation:**
- Making edits to existing files
- Implementing features with clear requirements
- Following established patterns (e.g., adding new API endpoints)
- Routine code updates and maintenance tasks
- Straightforward bug fixes and improvements
- Single-file changes with minimal investigation

#### Best Practices

1. **Clear Task Definitions**: When using the Task tool, provide specific, actionable instructions
2. **Context Preservation**: Include relevant file paths, function names, and implementation details
3. **Pattern References**: Point to existing examples in the codebase to follow
4. **Success Criteria**: Define what "done" looks like for the delegated task
5. **Token Management**: Delegate tasks that would consume >20k tokens to preserve main context

#### Subagent Opportunities in This Project

**Use Task tool for token-heavy workflows:**
- **Testing** (General-Purpose): Multi-step Playwright scenarios, end-to-end feature validation
- **Investigation** (Opus 4.1): Multi-file code tracing (React→Flask→DataLayer→DB), ID mapping issues
- **Refactoring** (General-Purpose): Pattern updates across 10+ files, function renaming
- **Debugging** (Opus 4.1): Multi-subsystem issues, performance analysis, race conditions

**Rule**: Tasks >20k tokens → delegate to preserve main context for coordination.

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
- **Analytics**: PostHog for event tracking and user behavior analysis (MCP integration enabled for direct API access)

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

### Playwright MCP Testing

**When testing GPRA UI features**, use the **`playwright-gpra-testing` skill** located at `~/.claude/skills/playwright-gpra-testing/`. This skill contains:

- **Token efficiency rules** (CRITICAL: snapshots = 5k-15k tokens each, use screenshots instead)
- **Post-change testing protocol** (ALWAYS test affected UI before marking complete)
- **GPRA-specific navigation patterns** (collapsible items, expand chevrons, chord chart sections)
- **Test data** (WSL2 file paths, YouTube URLs, manual entry test inputs, non-song test items)
- **Common workflows** (file upload, manual entry, replace charts, console monitoring)
- **Troubleshooting guide** (UI elements, file uploads, processing issues)
- **Setup instructions** (MCP configuration, browser installation, permissions)

**Quick setup check**: `claude mcp list` should show `playwright` connected. If missing, see skill's `setup.md`.


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
- `app/routes.py`: API endpoints and HTTP request handling
- `app/sheets.py`: Google Sheets data layer (acts as ORM)
- `app/__init__.py`: Flask app initialization and OAuth setup

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
- Multi-tenant authentication: **Hybrid system** (DB auth + OAuth) - Session 16
  - ✅ Email/password (Flask-AppBuilder built-in, fully working)
  - 🔄 Google OAuth (UI implemented, backend working, redirect_uri mismatch blocking)
  - ⏳ Spotify OAuth (researched as best option for musicians, ready to implement)
  - ❌ SoundCloud (API registration closed indefinitely)
  - ❌ YouTube Music (no official API exists)
- **CRITICAL OAuth Requirements**:
  - Requires `authlib` package (installed in Session 16)
  - CustomSecurityManager uses hybrid pattern (manually initializes OAuth alongside DB auth)
  - Cannot use `SERVER_NAME` config (breaks app routing)
  - Redirect URI issue: Flask sends `http://localhost/oauth-authorized/google` but Google expects `:5000` port
- Session management via Flask-AppBuilder security manager
- Row-Level Security (RLS) middleware active - filters all queries by user_id

### API Endpoints
- `/api/items/*`: CRUD operations for practice items
- `/api/routines/*`: CRUD operations for practice routines
- `/api/practice/active-routine`: Get/set active practice routine
- `/api/auth/status`: Check authentication status
- `/api/items/<id>/chord-charts`: Get/create chord charts for practice items
- `/api/chord-charts/<id>`: Delete chord charts
- `/api/items/<id>/chord-charts/order`: Reorder chord charts
- `/api/autocreate-chord-charts`: Upload files for AI-powered chord chart creation
- `/api/user/api-key`: GET (check status), POST (save), DELETE (remove) user's API key
- `/api/user/api-key/validate`: POST - validate API key without saving

## Special Considerations

### PostgreSQL Database (Migration Complete)
**Schema quirks from Sheets migration**: Column A = DB primary key, Column B = ItemID (string "107"). Frontend uses Column B. Chord charts use comma-separated ItemIDs ("67, 100, 1"). Order column has gaps from drag-drop - don't sort by it.

**DataLayer**: Routes MUST use `app/data_layer.py`, never import `app/sheets.py` directly. Wrong data returned = bypassed DataLayer.

**Common bugs**: Frontend using Column A instead of B for API calls. Deleting entire chord chart record instead of removing one ItemID from comma-separated list.

### File Path Handling
- WSL-friendly path mapping for Windows folders (see `app/routes.py`)
- Local songbook folder linking supported

### Guitar-Specific Features
- SVGuitar integration for chord chart rendering
- Tuning tracking and display
- Chord chart editor with interactive grid interface
- **Autocreate chord charts**: Upload PDFs/images → Claude analyzes files → automatically creates chord charts with proper sections, tuning, and fingerings

### Build and Assets
- Vite compiles React/JSX and outputs to `app/static/`
- Tailwind CSS compiled to `app/static/css/main.css`
- Hot reloading supported for both frontend and backend

Here's a map of the columns for our Items sheet and routine sheets.  This is what our columns are now, for each sheet.

**ActiveRoutine**
- Column A: ID (The ID of the currently active routine)

**Routines**
- Column A: ID (routine ID)
- Column B: Routine Name
- Column C: Creation timestamp
- Column D: order*

**Items Sheet:**
- Column A: ID
- *Column B: Item ID*
- Column C: Title
- Column D: Notes
- Column E: Duration
- Column F: Description
- Column G: order*
- Column H: Tuning
- Column I: Songbook

**Routine Sheets:**
- Column A: ID (reference to Routines sheet)
- *Column B: Item ID* (reference to Items sheet)
- Column C: order*
- Column D: completed

- The "order" column is where we track the order in which the items are displayed on the page. This ties in with our drag-and-drop functionality. When we reorder with drag-and-drop, we only update the 'order' column, we do not try to reorder entire rows in the spreadsheet.

- Google Sheets forces us to use the name of each sheet to find it.  We were having problems with Routine Sheet names, so we decided to give each routine sheet a number as a name. The number used as the name for the routine sheet is the routine's ID from column `A` of the `Routines` index sheet.  Let me know of any questions about this. It's odd, but less clunky than trying to use the name of the routine typed by the user. (We're storing the name of the routine given by the user in column `B` of the `Routines` index sheet.)

  - So, we're using an ID too look up the sheet, but that ID is actually a sheet name as well. Let me know of any questions.  We still have many changes to make for this, but I've found we're more effective if we fix it as we go, so we can test each change and keep things under control.

## SVGuitar Chord Charts

**When working with chord chart features**, use the **`svguitar-chord-charts` skill** located at `~/.claude/skills/svguitar-chord-charts/`. This skill contains:

- **3-part sizing system** (CRITICAL: SVGuitar config + CSS containers + post-processing must stay synchronized)
- **Visual analysis rules** (chord diagram anatomy, fret counting, position markers to IGNORE)
- **Autocreate architecture** (3-path system: chord_charts, chord_names, tablature)
- **OCR optimization** (80% power savings strategy with tesseract)
- **Database schema** (ChordCharts table, API endpoints, section metadata)
- **UI patterns** (force refresh after operations, rate limiting prevention)
- **Troubleshooting guide** (clipping, wrong fret positions, missing sections, UI refresh issues)

**Most common issues**: Chord chart clipping (sizing sync), wrong fret positions (visual analysis rules), sections missing (OCR raw_text)

## Driver.js Guided Tours

**When implementing or debugging Driver.js tours**, use the **`driverjs-tours` skill** located at `~/.claude/skills/driverjs-tours/`. This skill provides:

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
**Critical Pattern**: When React component changes aren't taking effect, check if the frontend bundle needs rebuilding.

**Symptoms**:
- API calls not happening despite correct source code
- Old functionality still executing after code removal
- Log messages showing old code paths (e.g., `[MANUAL]` instead of `[AUTOCREATE]`)

**Root Cause**: Vite's development watcher may not always catch changes, leaving old compiled code in `app/static/js/main.js`

**Solution**: Force rebuild frontend assets
```bash
npm run build  # Force recompilation of React components
```

**Debugging Pattern**: Compare log prefixes to identify which code path is executing:
- `[MANUAL]` = Old local parsing code still running
- `[AUTOCREATE]` = New Sonnet API code correctly executing

**Prevention**: Always verify that source code changes are reflected in the compiled bundle when debugging API integration issues.

## Performance Patterns & Optimizations

### Frontend State Management

#### UI Refresh After Backend Operations:
**Critical Pattern**: Don't rely on conditional loaders like `loadChordChartsForItem()` which skip if data already exists.

**Correct Pattern for Immediate UI Updates:**
```javascript
// Force refresh with fresh API call
const response = await fetch(`/api/items/${itemId}/chord-charts`);
const charts = await response.json();

// Direct state updates
setChordCharts(prev => ({
  ...prev,
  [itemId]: charts
}));

setChordSections(prev => ({
  ...prev,
  [itemId]: buildSectionsFromCharts(charts)
}));
```

**Applied in:**
- Autocreate completion handler
- Delete operations
- Manual chord creation


## PostgreSQL Migration Troubleshooting Patterns

### Common ID Mismatch Issues
**Root Cause**: PostgreSQL migration preserved Google Sheets structure where:
- **Column A**: Database primary key (auto-incrementing integer)
- **Column B**: Google Sheets ItemID (string like "107")

**Symptoms**:
- Wrong item names in dialogs
- Filtering/sorting broken
- API returns wrong data despite correct database content
- **Drag and drop operations return HTTP 200 but don't persist** (SQL UPDATE affects 0 rows)

**Fix Pattern**: Always use ItemIDs (Column B) for frontend communication, never database primary keys (Column A).

**Debugging Pattern for Silent Persistence Failures:**
```python
# Add row count tracking to repository update methods
result = self.db.query(Model).filter(...).update({...})
if result == 0:
    logging.warning(f"No rows updated - ID mismatch likely")
```

### Common Repository/Model Attribute Issues
**ChordChart Model**: Uses `order_col` (not `order`) and `chord_id` (not `id`) to match Google Sheets columns
**Fix Pattern**: Check model definitions in `app/models.py` for exact attribute names

### File Upload Patterns
**Frontend sends**: `file0`, `file1`, etc. (not `'files'`)
**Backend fix**: Use `request.files.values()` to capture all files regardless of key names

IMPORTANT:
- No need to run npm to update after changes, the server is running and we have watchers in place to make updates for us as needed while we're developing.

- Please don't use `git` commands without discussing it together first. I usually prefer to run commits and pushes in and external terminal window. Thanks.

- You often try `python` first, which doesn't work, so just start with `python3`

- If we ask Opus 4 for debugging help, please remind them not to try to start the server because it's already running and watchers are taking care of updates.

- We do not consider an item done, and we do not mark an item complete on a todo list, until it has been tested in the web GUI and confirmed to be working.

- NEVER delete spreadsheet items. If you think something needs to be deleted, check with me first. In actuality, you we probably just need to change an ID instead of deleting.

- Contextual reminder: In guitar we count strings in order from high pitch to low, so the string on the right side of our charts is string one. Likewise with frets, so fret one is at the top, and when we go "up" a fret, that means the next fret downward on the chart

## Cross-Platform Development Patterns

### WSL Detection and Path Handling
- Detect WSL: Check `/proc/version` for 'microsoft'
- Path conversion: Use `explorer.exe` with Windows-style paths (`folder_path.replace('/', '\\')`)
- Note: `explorer.exe` often returns non-zero even when successful

### Cross-Platform Feature Detection
- Mobile detection: Check userAgent for `/android|iphone|ipad|ipod/`
- Conditionally render features based on platform capabilities

## Light Mode Implementation Pattern
- Use `.light-mode` class on `<body>` element
- CSS: Specific selectors with `!important` flags to override Tailwind defaults
- Include SVG overrides for chord charts (background, stroke, fill, text)
- JS: Toggle class, persist with `localStorage`

## UI/UX Development Patterns
- **Responsive buttons**: `flex flex-col sm:flex-row` for mobile stacking
- **Browser navigation**: URL hash sync with `popstate` listener for back/forward support
- **Performance**: Avoid mutable objects in useMemo dependencies (causes re-render loops)

Anon, we rock n roll 🙌🤘🎸...