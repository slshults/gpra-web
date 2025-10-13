# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status: Hosted Version Development

**Important Context**: This codebase is a COPY of the original single-user local PostgreSQL version, which we are converting into a hosted multi-tenant SaaS application.

**Original Version**: [guitar-practice-routine-app_postgresql](https://github.com/slshults/guitar-practice-routine-app_postgresql) - Single user, local-only, no authentication
**This Version**: `gpra-web` - Multi-tenant hosted version with user accounts, subscriptions, and security

**Transformation Goals**:
- Add user authentication (email/password + OAuth)
- Implement multi-tenant data isolation
- Add Stripe subscription tiers (free with ads, byoClaude, paid plans)
- Security hardening for public hosting
- Deploy to DreamCompute with multiple domains

**Key Architecture Changes in Progress**:
- Database: Row-Level Security (RLS) with `user_id` on Items/Routines/ChordCharts, new `subscriptions` table, extending Flask-AppBuilder's `ab_user` table
- Authentication: Flask-AppBuilder auth + OAuth (Google, SoundCloud), email/password signup
- Subscriptions: 5 Stripe tiers (free/basic/standard/pro/unlimited), limits enforcement
- Backend: Session management, tier-based feature gating, RLS middleware
- Frontend: Login/signup, account management, billing UI (future)
- Infrastructure: Production configs, proper secrets management (complete), Stripe integration (pending)

**Current Deployment Status** (as of Oct 12, 2025):
- ✅ **FULLY DEPLOYED** - App live on 10 domains with SSL (certificates fixed!)
- ✅ DreamCompute instance: `gpra-web-prod` at `208.113.200.79` (2GB RAM, 1 vCPU)
- ✅ PostgreSQL 14.19 with production data
- ✅ Gunicorn systemd service with auto-restart
- ✅ Nginx reverse proxy with security headers
- ✅ **SSL certificates properly mapped** - Each domain uses correct cert via SNI
- ✅ IP whitelist (108.172.116.193) - only Steven has access
- ✅ Security: Vulnerable `/api/open-folder` endpoint disabled
- ✅ **Flask-AppBuilder admin interface** - Installed and accessible at `/admin/`
- ✅ **Multi-tenant architecture designed** - Row-Level Security approach, schema planned
- ⏳ **Next**: Implement SQLAlchemy models, Alembic migrations, RLS middleware
- See `~/.claude/handoffSummary.md` for full details

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
- Set `ANTHROPIC_API_KEY` in `.env` file for autocreate chord charts feature
- API key can be obtained from [Anthropic Console](https://console.anthropic.com/)

### Frontend Build Commands
```bash
npm run build           # Build production assets
npm run watch           # Watch mode for development
```

### Backend Commands
```bash
python run.py           # Start Flask server only (port 5000)
```

### Test Content for Playwright MCP Testing

#### Test items for chord charts
When testing chord chart generation or editing, please select items which are not song titles. Examples of good test items are "Remember to stretch", "Basic warm up and down", "Take five", etc. (This will prevent us from accidentally deleting chord charts that I actually use during practice, which are on song items.)

#### File Upload Testing
When testing file upload features with Playwright, use these sample files (translate Windows paths to WSL2 paths):

- **Lyrics with chord names**: `D:\Users\Steven\Documents\Guitar\Songbook\AngelFromMontgomery\angel_from_montgomery-chords.pdf`
  - WSL2 path: `/mnt/d/Users/Steven/Documents/Guitar/Songbook/AngelFromMontgomery/angel_from_montgomery-chords.pdf`

- **Chord charts (standard tuning)**: `D:\Users\Steven\Documents\Guitar\Songbook\DontDreamItsOver\DontDreamItsOver-ChordCharts.pdf`
  - WSL2 path: `/mnt/d/Users/Steven/Documents/Guitar/Songbook/DontDreamItsOver/DontDreamItsOver-ChordCharts.pdf`

- **Chord charts (alternate tuning)**: `D:\Users\Steven\Documents\Guitar\Songbook\AlmostCutMyHair\AlmostCutMyHair-Chords.pdf`
  - WSL2 path: `/mnt/d/Users/Steven/Documents/Guitar/Songbook/AlmostCutMyHair/AlmostCutMyHair-Chords.pdf`

- **Mixed content (charts + lyrics)**: `D:\Users\Steven\Documents\Guitar\Songbook\BackInBlack\BackInBlack-Chords.pdf`
  - WSL2 path: `/mnt/d/Users/Steven/Documents/Guitar/Songbook/BackInBlack/BackInBlack-Chords.pdf`
  - Use this to test prompting user to choose which content type to process

#### YouTube Transcript Testing
For testing YouTube transcript generation:
- URL: `https://youtu.be/-IFmtOHecOg?si=KGJiRR7gV8u-hx_D`

#### Manual Entry Testing
For testing manual chord chart entry:
```
Verse
Ebsus2 Csus2 Ab G Gsus4
Chorus
Ab Bm Ebsus2 Cmin
```

### Playwright MCP Testing Guide

**Testing Philosophy**: When adding new functionality or fixing bugs, use Playwright MCP to test changes. Test after each testable change, because it's easier to fix bugs as we go than it is to find and fix bugs after a large number of changes.

#### Post-Change Testing Protocol

**CRITICAL**: After editing React components, ALWAYS test affected UI before marking task complete.

**Process**:
1. **Analyze**: Which pages/modals import this component? (Practice page, Items modal, Routines modal, etc.)
2. **Delegate**: Use Task tool + Playwright MCP (avoid token bloat in main conversation)
3. **Target**: Test only the functionality affected by your changes, not entire app
4. **Report**: Confirm working or identify specific issues found

**Example**: After editing `ChordChartEditor.jsx`:
- Affected areas: Practice page chord charts, Items modal, Routines modal
- Test focus: Chord editing, section management, autofill behavior
- Delegate: "Test chord editing on Practice page - verify [specific change] works correctly"

**Never mark a todo complete until UI testing confirms the change works.**

#### Token Efficiency Best Practices

**CRITICAL**: Playwright MCP snapshots consume 5k-15k tokens each. Pattern: Screenshot → ALL actions → ONE screenshot (verify). If the first screenshot doesn't reveal enough for navigation, then take ONE snapshot and repeat the pattern with only screenshots from there.

Delegate multi-step tests (3+ actions) to Task tool with general-purpose agent to preserve main conversation context window remaining.

#### Wait Time Expectations

- **UI updates** (button clicks, form inputs, navigation): Usually <100ms, no explicit waits needed
- **API responses** (autocreate, file upload, transcript fetch): 5-30 seconds depending on complexity
- Use `browser_wait_for` with `time` parameter only for API operations
- For UI verification after actions, take a screenshot - don't use additional snapshots

#### Environment Setup
- **WSLg**: WSL2 includes WSLg (WSL GUI support) which allows Chrome to display in a GUI window during testing
- **Browser Installation**: Run `npx playwright install chrome` to install Chrome browser binaries
- **System Dependencies**: Run `npx playwright install-deps` to install required system packages
- **Approval Configuration**:
  - Add `"mcp__playwright__*"` to the `permissions.allow` array in `.claude/settings.local.json` (project-level)
  - Alternatively, add to `~/.claude/settings.json` (user-level, applies to all projects)
  - Format: `"permissions": { "allow": ["mcp__playwright__*"], "deny": [] }`
  - Click "Always allow this tool" on first approval - subsequent actions run without prompts

#### Navigation Patterns

**Opening the App:**
1. Navigate to `http://localhost:5000`
2. Take snapshot to see current page state
3. Look for "Practice" link in navigation to access practice page

**Accessing Practice Items:**
1. On Practice page, items are collapsed by default
2. Look for expand chevrons (▸) next to item titles
3. Click chevron refs to expand items and reveal chord chart sections
4. Take screenshots to verify expanded state

**Collapsible Sections:**
- Items have multiple collapsible sections (Notes, Description, Chord Charts)
- Each section has its own expand/collapse button
- Use `browser_snapshot` to identify section refs before clicking

#### File Upload Testing

**Workflow:**
1. Expand a practice item that doesn't have chord charts yet
2. Look for "Autocreate from Files" or similar upload button
3. Click to open file upload dialog
4. Use `browser_file_upload` tool with WSL2 paths (e.g., `/mnt/d/Users/Steven/...`)
5. Wait for processing (may take 10-30 seconds depending on file complexity)
6. Take screenshot to verify chord charts were created

**Common Issues:**
- File upload requires exact WSL2 paths, not Windows paths
- Processing time varies by content type (chord diagrams take longer than lyrics)
- Check browser console for processing status messages

#### Manual Chord Entry Testing

**Workflow:**
1. Expand practice item's chord chart section
2. Look for "Add Chord Manually" or "Show me" button to open editor
3. Enter section label (e.g., "Verse", "Chorus")
4. Type chord progression in text area
5. Click "Create Chord Charts" or similar button
6. Wait for AI processing (~5-10 seconds)
7. Verify chord charts appear in the section

**Test Input Format:**
```
Verse
Ebsus2 Csus2 Ab G Gsus4
Chorus
Ab Bm Ebsus2 Cmin
```

#### Element Selection Tips

**Common Ref Patterns:**
- Buttons: Look for `button` elements with accessible names
- Expand/collapse: Look for chevron symbols (▸, ▾) or expand icons
- Sections: Look for headings like "Chord Charts", "Notes", "Description"
- Forms: Look for `textbox`, `combobox`, `button` roles

**Navigation Strategy:**
1. Always take snapshot first to see available elements
2. Use accessible names and roles for reliable element selection
3. Verify action results with screenshots
4. Check console logs for API responses and errors

#### Console Monitoring

**Key Log Patterns:**
- `[AUTOCREATE]`: Processing file uploads via AI
- `[MANUAL]`: Processing manual chord entry
- API responses show success/failure of backend operations
- Error messages help diagnose issues

**Accessing Console:**
```
# View console messages
mcp__playwright__browser_console_messages

# View only errors
mcp__playwright__browser_console_messages(onlyErrors=true)
```

#### Screenshot Best Practices

**When to Capture:**
- After navigation to verify correct page loaded
- Before clicking elements to document UI state
- After operations complete to verify results
- When debugging to understand what went wrong

**Screenshot Tools:**
- `browser_take_screenshot`: Captures current viewport or specific elements, much lower token use so prefer screenshots to snapshots
- `browser_snapshot`: Better for identifying interactive elements (includes accessibility tree). Massive token use, so use only when neccessary 
- Remember to delete screenshots and snapshots when you're done with them

#### Common Testing Scenarios

**Scenario 1: Test File Upload End-to-End**
1. Navigate to Practice page
2. Expand an item without chord charts
3. Click autocreate button
4. Upload test PDF file
5. Wait for processing
6. Verify chord charts appear
7. Verify tuning and section labels are correct

**Scenario 2: Test Manual Entry Workflow**
1. Navigate to Practice page
2. Expand item chord chart section
3. Open manual entry editor
4. Enter section + chord progression
5. Submit for processing
6. Verify AI-generated chord charts match input

**Scenario 3: Replace Existing Chord Charts**
1. Navigate to item that already has charts
2. Click "Replace" button
3. Choose file upload or manual entry
4. Complete workflow
5. Verify old charts replaced with new ones

#### Leave Browswer Open When Done
- Please leave the browser open when you're done testing (in case I want to review console logs, history, etc.)

#### Troubleshooting

**UI Element Not Found:**
- Take fresh snapshot to see current state
- Check if section needs to be expanded first
- Verify page loaded completely (check for loading spinners)

**File Upload Fails:**
- Verify WSL2 path format (`/mnt/d/...` not `D:\...`)
- Check file exists at specified path
- Ensure ANTHROPIC_API_KEY is set in backend `.env`

**Chord Charts Don't Appear:**
- Check console logs for API errors
- Verify processing completed (no loading state)
- Take screenshot to see if error message displayed
- Check browser network requests for failed API calls


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
- Legacy: OAuth2 flow for Google Sheets access (being removed)
- Multi-tenant authentication: Flask-AppBuilder base auth + custom OAuth providers
  - Email/password (Flask-AppBuilder built-in)
  - Google OAuth (existing credentials, ready to integrate)
  - SoundCloud OAuth 2.1 (musician-focused platform, planned)
- Session management via Flask-AppBuilder security manager

### API Endpoints
- `/api/items/*`: CRUD operations for practice items
- `/api/routines/*`: CRUD operations for practice routines
- `/api/practice/active-routine`: Get/set active practice routine
- `/api/auth/status`: Check authentication status
- `/api/items/<id>/chord-charts`: Get/create chord charts for practice items
- `/api/chord-charts/<id>`: Delete chord charts
- `/api/items/<id>/chord-charts/order`: Reorder chord charts  
- `/api/autocreate-chord-charts`: Upload files for AI-powered chord chart creation (requires ANTHROPIC_API_KEY)

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

## SVGuitar Chord Chart Sizing

**Critical**: Three-part sizing system must stay synchronized or charts will be clipped/distorted:
1. **SVGuitar Config** (`defaultChartConfig` in ChordChartEditor.jsx): width/height (Current: 220x310)
2. **CSS Containers**: Chart containers `w-52 h-80` (208px x 320px)
3. **Post-Processing** (`updateCharts`): maxWidth/maxHeight (208px x 320px)

**To resize**: Update all three proportionally. CSS container should be slightly smaller than SVGuitar config for proper scaling.

## Chord Chart System (NEW)

### Overview
The application includes a comprehensive chord chart management system with **section organization** for chord progressions. Users can create labeled sections (Verse, Chorus, etc.) with repeat counts and save chord diagrams within each section.

### Autocreate System Architecture (Updated)
The autocreate chord charts feature uses a **3-path architecture** for optimal processing:

1. **`chord_charts`** - Visual chord diagrams (processed by Opus 4.1)
   - Hand-drawn or printed chord reference sheets
   - Uses visual analysis to extract exact finger positions
   
2. **`chord_names`** - Chord symbols above lyrics (processed by Sonnet 4)  
   - Lyrics with chord names like G, C, Am, F7, etc.
   - Uses CommonChords database lookup for standard tuning (EADGBE)
   - Preserves actual chord names and song section structure
   
3. **`tablature`** - Actual guitar tablature notation (processed by Sonnet 4)
   - Fret numbers on horizontal string lines (e.g., E|--0--3--0--|)
   - Creates generic "Chord1", "Chord2" names when chord names unavailable

**Key Design Principles:**
- **Cost efficiency**: Strategic Opus/Sonnet usage prevents rate limiting
- **Complete file processing**: Reads entire file, doesn't stop after finding chord charts
- **Tuning awareness**: CommonChords for standard, direct patterns for alternate tunings

### Chord Chart Database Schema (PostgreSQL)
**ChordCharts Table** (mirrors Google Sheets structure for compatibility):
- ChordID, ItemID (string), Title, ChordData (JSON with section metadata), CreatedAt, Order
- Section metadata in JSON: sectionId, sectionLabel (e.g., "Verse"), sectionRepeatCount (e.g., "x4")

**Key Components**: `ChordChartEditor.jsx`, `PracticePage.jsx`, API endpoints in `routes.py`

**Features**: Real-time editing with 500ms debounce, automatic section grouping, 4-per-row grid display

**Note**: Database structure based on Google Sheets schema - refer to sheets version in `../gpr` for debugging reference

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

### Autocreate System Optimizations

#### Rate Limiting Prevention:
1. **Pre-load CommonChords**: Single API call at start
2. **Batch Creation**: All chords created in one operation
3. **Smart Blocking**: Prevent autocreate when charts already exist

#### User Experience:
- Clear warning when trying autocreate on items with existing charts
- Progress messages with rotating content during processing
- Immediate UI refresh after completion

#### OCR Power Optimization (NEW)
**80% Power Reduction Strategy**: Use local OCR extraction + lightweight Sonnet processing instead of heavy visual analysis.

**Implementation Pattern**:
```python
# 1. Try OCR first for PDFs/images in process_chord_names_with_lyrics()
from app.utils.chord_ocr import extract_chords_from_file, should_use_ocr_result

# 2. If OCR finds 2+ chords, pass complete raw text to preserve sectional structure
if ocr_result and should_use_ocr_result(ocr_result, minimum_chords=2):
    file_data['data'] = ocr_result['raw_text']  # CRITICAL: Use raw_text, not chord names
    file_data['type'] = 'chord_names'
    # Continue to existing Sonnet processing with full sectional context

# 3. Fallback to full LLM analysis if OCR insufficient
```

**Critical Fix Applied**: Previously sent only extracted chord names, losing sectional structure (Verse, Chorus, Bridge). Now sends complete OCR raw text to preserve song organization.

**Dependencies**:
- System: `sudo apt-get install tesseract-ocr poppler-utils`
- Python: `pip install pytesseract pdf2image pillow`

**Performance**:
- **Clean chord charts**: ~80% power savings (~4 seconds vs ~30 seconds)
- **Complex files**: Graceful fallback to full LLM processing
- **Quality**: Same output using proven Sonnet + CommonChords path

#### Visual Analysis Debugging Process (NEW)
**CRITICAL: Chord Diagram Reading Rules for Autocreate Feature**
- **Chord diagram anatomy**: Dots are positioned BETWEEN fret lines, not ON fret lines
- **Fret terminology**: "Fret 1" means the space between the top horizontal line (nut) and the 2nd horizontal line from the top
- **IGNORE position markers completely**: Position markers like "5fr", "3fr", etc. are completely irrelevant when recreating chord charts. They are just position indicators for guitarists and must be ignored during visual analysis
- **Fret counting**: ALWAYS count from the top - fret 1 = space between top line and 2nd line, fret 2 = space between 2nd and 3rd lines, etc.
- **Reference-first approach**: When reference files exist, recreate exactly as shown - ignore complex tablature integration, use tablature only for repeat counts
- **Exact recreation principle**: Preserve exact order (left-to-right, top-to-bottom), line breaks, and chord names from reference file
- **CRITICAL PROMPT FIX**: Visual analysis prompt must NOT assume alternate tuning - let Claude determine tuning naturally
- **Anti-knowledge instruction**: Explicitly tell Claude "NEVER use your knowledge of chord shapes - only extract what you visually observe"

#### Model Architecture (UPDATED)
**Unified Sonnet 4.5 approach** for all autocreate processing:
- **Sonnet 4.5**: Used for all visual analysis, chord chart processing, and text analysis
- **Superior vision**: Sonnet 4.5's improved vision capabilities handle all chord diagram analysis
- **Cost efficiency**: Single model for all processing paths simplifies architecture
- **Performance**: Faster and more cost-effective than previous multi-model approach

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