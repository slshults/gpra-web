# Guitar Practice Routine Assistant

A web app for guitar players to manage practice routines, create chord charts, and track practice progress. This is the web app. 

Free single-user version to run on your local machine is [here](https://github.com/slshults/guitar-practice-routine-app_postgresql).

## Feature Highlights

### Practice Session Management
- **Timer-based practice sessions** with customizable durations for each item
- **Progress tracking** - mark items as complete during practice
- **Organized routines** with drag-and-drop reordering
- **Visual progress indicators** showing completion status
- **Drag n drop** to rearrange items in a routine

### Chord Chart System
- **Interactive chord chart editor** with click-to-place finger positions
- **Section organization** - organize chords by song sections (Verse, Chorus, etc.)
- **SVGuitar integration** for professional chord diagram rendering
- **Autocreate feature** - upload PDFs or images, or paste the URL for a YouTube lesson video, to automatically generate chord charts using Claude AI
- **Shared chord charts** - charts can be used on multiple instances of the same song (for different focus during different practice routines)
- **CommonChords database** 12,700+ pre-defined chord patterns, and/or create your own

### Data Management
- **PostgreSQL database** - reliable, fast local storage
- **Complete CRUD operations** for routines, items, and chord charts
- **Section metadata** stored within chord data for organization
- **Cross-platform support** - works on Windows (WSL2), macOS, and Linux
- **Local songbook folder links** - quick access to files on your local from links in the app

### Optional auto-creation of chord charts with help from Claude AI
- **Autocreate chord charts** from lyrics sheets with chord names, existing chord charts, or YouTube lesson URLs (using Opus 4.5)
- **Three processing paths**: Visual chord diagrams, chord names above lyrics, and tablature notation
- **It's not all AI** - Using local OCR to pull section names and chord names from lyrics sheets with chord names, sending that to Claude for chord chart creation. (Visual analysis of uploaded chord charts is handled by Claude though) 
- **Autocreate is Optional** - Hate AI? Then don't enter an Anthropic API key, and the app won't use AI at all.

### Track your practice time, in-depth
- **PostHog analytics built-in** - Optional practice history tracking via PostHog. Works with the free level, project API key required. 

# Getting Started

### Prerequisites

- Comfort using a CLI (e.g. bash shell)
- **PostgreSQL 12+** installed and running
- **Python 3.8+**
- **Node.js 16+** and npm

Install PostgreSQL:
- **Official docs**: https://www.postgresql.org/docs/current/installation.html
- **Windows**: https://www.postgresql.org/download/windows/
- **macOS**: https://www.postgresql.org/download/macosx/
- **Linux**: https://www.postgresql.org/download/linux/

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/slshults/guitar-practice-routine-app_postgresql.git
   cd guitar-practice-routine-app_postgresql
   ```

2. **Set up Python environment**
   ```bash
   # Create virtual environment
   python -m venv venv
   
   # Activate virtual environment
   # Windows:
   venv\Scripts\activate
   # macOS/Linux:
   source venv/bin/activate
   
   # Install Python dependencies
   pip install -r requirements.txt
   ```

3. **Install Node.js dependencies**
   ```bash
   npm install
   ```

4. **Database Setup**
   ```bash
   # Create database and user
   sudo -u postgres psql
   CREATE DATABASE guitar_practice;
   CREATE USER guitar_user WITH PASSWORD 'your_password';
   GRANT ALL PRIVILEGES ON DATABASE guitar_practice TO guitar_user;
   \q

   # Set environment variables
   cp .env.template .env
   # Edit .env and set:
   DATABASE_URL=postgresql://guitar_user:your_password@localhost/guitar_practice
   ```

5. **Initialize Database**
   ```bash
   # Create tables and load demo data
   psql -d guitar_practice -f schema.sql
   psql -d guitar_practice -f demo_data.sql
   ```

6. **Configure Optional Features**
   ```bash
   # Optional: For autocreate chord charts feature
   ANTHROPIC_API_KEY=your_anthropic_api_key

   # Optional: For practice history analytics
   POSTHOG_API_KEY=your_posthog_key
   ```

### Running the Application

```bash
# Start both Flask server and Vite watcher
./gpr.sh

# Or run components separately:
# Backend only:
python run.py
# Frontend build watcher:
npm run watch
```

Open your browser to `http://localhost:5000`

Leave a comment if you run into errors. (Can't guarantee any support though, this is a hobby project.)

## Database Schema

The application uses PostgreSQL with the following main tables:

- **`items`** - Practice items (songs, exercises, techniques)
- **`routines`** - Practice routine collections, made up of items
- **`routine_items`** - Junction table linking routines to items
- **`chord_charts`** - Chord diagrams with section organization
- **`active_routine`** - Tracks currently selected routine
- **`common_chords`** - Database of 12,700+ predefined chord patterns

### Demo Data

The application includes demo data to get you started:

- **Sample routine**: "Songs" with one practice item
- **Sample song**: "For What It's Worth" with E, D, A, A7 chord charts
- **Organized sections**: Chords grouped by song section (Chorus)
- **Local folder path**: Example songbook folder path structure

The complete schema and demo data are provided in `schema.sql` and `demo_data.sql` files.

## Architecture

### Backend (Flask + PostgreSQL)
- **Flask application** with RESTful API endpoints
- **SQLAlchemy ORM** with PostgreSQL database
- **Service layer** for logic (ItemService, ChordChartService, etc.)
- **Repository layer** for data access and management

### Frontend (React + Vite)
- **React 18.2.0** with functional components and hooks
- **Vite 4.x** for fast development and building
- **Tailwind CSS** for styling
- **SVGuitar integration** for chord diagram rendering
- **Path aliases** (`@components`, `@hooks`, `@ui`, etc.)

### Key Components
- `PracticePage.jsx` - Main practice session interface
- `ChordChartEditor.jsx` - Interactive chord diagram editor
- `ChordGrid.jsx` - Chord chart display component
- `DataLayer` - Database abstraction and service layer

## API Endpoints

### Items
- `GET /api/items` - List all practice items
- `POST /api/items` - Create new item
- `GET /api/items/<id>` - Get item details
- `PUT /api/items/<id>` - Update item
- `DELETE /api/items/<id>` - Delete item

### Routines  
- `GET /api/routines` - List all routines
- `POST /api/routines` - Create new routine
- `GET /api/routines/<id>` - Get routine with items
- `PUT /api/routines/<id>` - Update routine
- `DELETE /api/routines/<id>` - Delete routine

### Chord Charts
- `GET /api/items/<id>/chord-charts` - Get chord charts for item
- `POST /api/items/<id>/chord-charts` - Create chord chart
- `PUT /api/chord-charts/<id>` - Update chord chart
- `DELETE /api/chord-charts/<id>` - Delete chord chart
- `POST /api/autocreate-chord-charts` - AI-powered chord chart creation

## Usage Tips

### Start with items
- **Create items**: on the `Items` page. Create some of your own, or start with the included "For What It's Worth" example (Chorus only included, to avoid copyright complaints)
  - **Local folders**: optional: set songbook paths to link to your guitar files
- **Create a routine**: on the Routines page, or start with the include demo routine. Add items to your routine, drag and drop to reorder
- **Set an active routine**: It'll show up on the `Practice` page

### Practice
- **Use timers** to track practice duration for each item
- **Mark items complete** as you finish them
- **Chord charts** Create or view by expanding the chord chart section in an item

### Chord Chart Management
1. **Toggle "Add New Chord"** to open the interactive editor
2. **Click on fret positions** to place fingers
3. **Organize chords by sections** (Verse, Chorus, etc.)
4. **Use autocreate** to generate charts from PDFs or images
5. **Copy chord charts** between songs (useful if you focus on different aspects of a song in different routines. Just create multiple items for that song, for use in different routines) 

## Development

### Project Structure
```
app/
├── static/js/components/     # React components
├── static/js/hooks/         # Custom React hooks
├── static/js/utils/         # Utility functions
├── static/css/              # Compiled CSS
├── templates/               # Jinja2 templates
├── models.py               # SQLAlchemy models
├── data_layer.py           # Database abstraction layer
├── services/               # Business logic layer
├── repositories/           # Data access layer
└── routes.py               # Flask API endpoints

schema.sql                   # Database schema
demo_data.sql               # Sample data for new installations
```
CLAUDE.md file included (useful if you like to work with Claude Code)

### Common Commands
```bash
# Development server with watchers
./gpr.sh

# Build production assets
npm run build

# Database setup (for new installations)
psql -d guitar_practice -f schema.sql
psql -d guitar_practice -f demo_data.sql

# Linting and formatting
npm run lint
python -m flake8 app/
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests for new functionality  
5. Ensure all tests pass
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request
9. Wait for review (could be awhile. this is a hobby project)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

Originally inspired by the ['My Practice Assistant' on justinguitar.com](https://www.justinguitar.com/guitar-lessons/using-my-practice-assistant-b1-117) 

### Open Source Projects
This project would not have been possible without these open source libraries:

**Backend:**
- [Flask](https://flask.palletsprojects.com/) - Web framework
- [SQLAlchemy](https://www.sqlalchemy.org/) - ORM and database toolkit
- [PostgreSQL](https://www.postgresql.org/) - Database system

**Frontend:**
- [React](https://reactjs.org/) - UI library
- [Vite](https://vitejs.dev/) - Build tool and development server  
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework
- [SVGuitar](https://github.com/omnibrain/svguitar) by [@omnibrain](https://github.com/omnibrain) - Guitar chord diagram rendering

**Guitar Data:**
- [SVGuitar-ChordCollection](https://github.com/TormodKv/SVGuitar-ChordCollection) by [@TormodKv](https://github.com/TormodKv) - Monsterous chord database

**AI Integration:**
- [Anthropic Claude](https://www.anthropic.com/) - Claude Sonnet and Opus are working together like little digital guitar elves, building autocreated chord charts via the Anthropic API. (Simple OCR is handled locally to reduce power consumption)

### Development Tools
- [Claude Code](https://claude.ai/code) - AI pair programming assistant
- [PostHog](https://posthog.com/) - for product engineers

Thanks to the entire open source community for building the tools and libraries that make projects like this possible. 🤘 

---

**Don't just practice it until you get it right. Practice it until you can't get it wrong.** --Source unknown 

*If you think this doesn't suck, please consider clicking the starry thingy, share it with other players, yada yada, blah blah blah* #guitar-practice-routine-app_postgresql
