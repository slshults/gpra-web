# Guitar Practice Routine Assistant

A web app for beginner and intermediate guitar players to manage practice routines, create chord charts, and track practice progress. (Originally inspired by the ['My Practice Assistant' on justinguitar.com](https://www.justinguitar.com/guitar-lessons/using-my-practice-assistant-b1-117))

This is a hobby/passion project. (It's pretty niche, so if it makes more than enough to cover the hosting costs then I'll be pleasantly surprised.)

This repo is for the [gpra.app](https://guitarpracticeroutine.com/). 

If you're looking for the free, single-user version to run on your own local machine, it is [here](https://github.com/slshults/guitar-practice-routine-app_postgresql).

## Feature Highlights

### Practice Session Management
- **Timer-based practice sessions** with customizable durations for each item
- **Progress tracking** - mark items as complete during practice
- **Organized routines** with drag-and-drop reordering
- **Visual progress indicators** showing completion status
- **Drag n drop** to rearrange items in a routine

### Chord Chart System
- **[SVGuitar](https://github.com/omnibrain/svguitar) integration** for chord diagram rendering
- **Interactive chord chart editor** with click-to-place finger positions, to create or edit chord charts
- **Section organization** - organize chords by song sections (Verse, Chorus, etc.)
- **Autocreate feature** - upload PDFs or images, paste the URL for a YouTube guitar lesson video, or type chord names to automatically generate chord charts using Claude AI
- **CommonChords database** using 12,700+ pre-defined chord patterns from [SVGuitar-ChordCollection](https://github.com/TormodKv/SVGuitar-ChordCollection)
- **Shared chord charts** - charts can be used on multiple instances of the same song (e.g. for different focus during different practice routines)

### Data Management
- **PostgreSQL database** - reliable, fast local storage
- **Complete CRUD operations** for routines, items, and chord charts
- **Section metadata** stored within chord data for organization

### Optional auto-creation of chord charts with help from Claude AI
- **Autocreate chord charts** from lyrics sheets with chord names, existing chord charts, YouTube lesson URLs, or by typing chord names (charts created using Opus 4.5)
- **Three processing paths**: Visual chord diagrams, chord names above lyrics, and tablature notation
- **It's not all AI** - To reduce consumption, I'm using simple OCR to pull section names and chord names from lyrics sheets with chord names, then sending that to Claude for chord chart creation. (The more challenging visual analysis of uploaded chord charts is handled by Claude though) 
- **Autocreate is Optional** - Hate AI? Then use free or basic tiers and don't enter an Anthropic API key. Then the app won't use AI at all.

# Getting Started

Go here: [guitarpracticeroutine.com/register](https://guitarpracticeroutine.com/register)

The free tier does not require you to enter a credit card. Includes 15 items and 1 routine (an item is a song, exercise, break reminder, etc.)

## Usage Tips

### Start with items
- **Create items**: on the [Items page](https://guitarpracticeroutine.com/#Items). Create some of your own, or start with the included "For What It's Worth" example (demo includes only chords for the intro/chorus)
- **Create a routine**: on the [Routines page](https://guitarpracticeroutine.com/#Routines), or start with the include demo routine. Add items to your routine, drag and drop to reorder
- **Set an active routine**: Click the little green `+` on a routine to make it the active routine, then it'll show up on the [Practice page](https://guitarpracticeroutine.com/#Practice)

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

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

Originally inspired by the ['My Practice Assistant' on justinguitar.com](https://www.justinguitar.com/guitar-lessons/using-my-practice-assistant-b1-117) 

### Open Source Projects
This project would not have been possible without these open source libraries:

**Frontend:**
- [React](https://reactjs.org/) - UI library
- [Vite](https://vitejs.dev/) - Build tool and development server  
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework
- [SVGuitar](https://github.com/omnibrain/svguitar) by [@omnibrain](https://github.com/omnibrain) - Guitar chord diagram rendering

**Backend:**
- [Flask](https://flask.palletsprojects.com/) - Web framework
- [SQLAlchemy](https://www.sqlalchemy.org/) - ORM and database toolkit
- [PostgreSQL](https://www.postgresql.org/) - Database system
- [SVGuitar-ChordCollection](https://github.com/TormodKv/SVGuitar-ChordCollection) by [@TormodKv](https://github.com/TormodKv) - Monsterous chord database


**AI Integration:**
- [Anthropic Claude](https://platform.claude.com) - Claude Sonnet and Opus (both 4.5 as of this writing) are working together like little digital guitar elves, building autocreated chord charts via the Anthropic API. (Simple OCR is handles simple visual analytics, to reduce power consumption)

### Development Tools
- [Claude Code](https://claude.ai/code) - AI pair programming assistant
- [PostHog](https://posthog.com/) - for product engineers
- [VS Code](https://code.visualstudio.com) - IDE
- [WSL](https://learn.microsoft.com/en-us/windows/wsl/) - Windows Subsystem for Linux
- [Ubuntu](https://ubuntu.com/download/desktop) - Linux

Thanks to the entire open source community for building the tools and libraries that make projects like this possible. 🤘 

---

*Don't just practice it until you get it right. Practice it until you can't get it wrong.* --Source unknown 

**Hey:** If you think this doesn't suck, please consider clicking the starry thingy, sharing it with other players, yada yada, blah blah blah 
#guitar-practice-routine-app #gpra
