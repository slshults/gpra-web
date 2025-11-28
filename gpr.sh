#!/bin/bash

# Set up colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Store PIDs for cleanup
declare -a PIDS=()

# Function to cleanup processes on exit
cleanup() {
    echo -e "\n${BLUE}Cleaning up processes...${NC}"

    # Kill all stored PIDs and their children
    for pid in "${PIDS[@]}"; do
        if kill -0 $pid 2>/dev/null; then
            echo -e "${BLUE}Stopping process $pid and children...${NC}"
            pkill -P $pid 2>/dev/null
            kill -TERM $pid 2>/dev/null
            sleep 1
            pkill -P $pid 2>/dev/null
            kill -KILL $pid 2>/dev/null
        fi
    done

    # Additional cleanup for any remaining processes
    for cmd in "flask run" "npm run watch" "inotifywait" "python.*run.py"; do
        pids=$(pgrep -f "$cmd" 2>/dev/null)
        if [ -n "$pids" ]; then
            echo -e "${BLUE}Stopping $cmd processes...${NC}"
            pkill -TERM -f "$cmd" 2>/dev/null
            sleep 1
            pkill -KILL -f "$cmd" 2>/dev/null
        fi
    done

    echo -e "${GREEN}Cleanup complete${NC}"
    exit 0
}

# Error handling function
handle_error() {
    echo -e "${RED}Error: $1${NC}"
    cleanup
}

# Function to check if a process is running
is_process_running() {
    local pid=$1
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        return 0
    else
        return 1
    fi
}

# Function to check PostgreSQL health
check_postgres_health() {
    echo -e "${BLUE}Checking PostgreSQL health...${NC}"

    # Check if PostgreSQL is accepting connections
    if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
        echo -e "${GREEN}PostgreSQL is healthy and accepting connections${NC}"
        return 0
    else
        echo -e "${YELLOW}PostgreSQL is not accepting connections${NC}"
        return 1
    fi
}

# Function to attempt PostgreSQL recovery
recover_postgres() {
    echo -e "${YELLOW}Attempting PostgreSQL recovery...${NC}"

    # Step 1: Try pg_ctlcluster (equivalent to pgfix)
    echo -e "${BLUE}Step 1: Starting PostgreSQL cluster...${NC}"
    if sudo pg_ctlcluster 14 main start >/dev/null 2>&1; then
        echo -e "${GREEN}PostgreSQL cluster started successfully${NC}"
        sleep 2
        if check_postgres_health; then
            return 0
        fi
    else
        echo -e "${YELLOW}PostgreSQL cluster start failed, trying service start...${NC}"
    fi

    # Step 2: Try service start (equivalent to pgstart)
    echo -e "${BLUE}Step 2: Starting PostgreSQL service...${NC}"
    if sudo -u postgres service postgresql start >/dev/null 2>&1; then
        echo -e "${GREEN}PostgreSQL service started successfully${NC}"
        sleep 3
        if check_postgres_health; then
            return 0
        fi
    else
        echo -e "${YELLOW}PostgreSQL service start failed${NC}"
    fi

    # Step 3: Last resort - try systemctl
    echo -e "${BLUE}Step 3: Trying systemctl start...${NC}"
    if sudo systemctl start postgresql >/dev/null 2>&1; then
        echo -e "${GREEN}PostgreSQL started via systemctl${NC}"
        sleep 3
        if check_postgres_health; then
            return 0
        fi
    fi

    echo -e "${RED}All PostgreSQL recovery attempts failed${NC}"
    return 1
}

# Function to ensure PostgreSQL is ready
ensure_postgres_ready() {
    if ! check_postgres_health; then
        echo -e "${YELLOW}PostgreSQL is not ready, attempting recovery...${NC}"
        if recover_postgres; then
            echo -e "${GREEN}PostgreSQL recovery successful!${NC}"
        else
            handle_error "Failed to start PostgreSQL. Please run 'pgfix' and 'pgstart' manually"
        fi
    fi
}

# Function to start a process and store its PID
start_process() {
    "$@" &
    local pid=$!
    PIDS+=($pid)
    return $pid
}

# Trap cleanup function for script termination
trap cleanup SIGINT SIGTERM EXIT

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Use Node.js 18
echo -e "${BLUE}Setting up Node.js environment...${NC}"
nvm use 22 || handle_error "Failed to set Node.js version"

# Initial build
echo -e "${GREEN}Building assets...${NC}"
npm run build || handle_error "Failed to build assets"

# Ensure PostgreSQL is ready before starting Flask
ensure_postgres_ready

# Start Redis server (required for Flask-Session)
echo -e "${BLUE}Starting Redis server...${NC}"
if pgrep -x redis-server > /dev/null; then
    echo -e "${GREEN}Redis is already running${NC}"
else
    redis-server --daemonize yes
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Redis started successfully${NC}"
    else
        handle_error "Failed to start Redis server"
    fi
fi

# Start Flask with auto-reloader enabled
echo -e "${GREEN}Starting Flask server...${NC}"
FLASK_APP=run.py flask run --host=0.0.0.0 --port=5000 &
FLASK_PID=$!
PIDS+=($FLASK_PID)

# Wait a moment to ensure Flask starts
sleep 2

# Check if Flask started successfully
if ! is_process_running $FLASK_PID; then
    handle_error "Flask server failed to start"
fi

# Start Vite with hot module replacement
echo -e "${GREEN}Starting Vite...${NC}"
npm run watch &
VITE_PID=$!
PIDS+=($VITE_PID)

# Wait a moment to ensure Vite starts
sleep 2

# Check if Vite started successfully
if ! is_process_running $VITE_PID; then
    handle_error "Vite watch failed to start"
fi

# Flask's built-in auto-reloader is now enabled (see --no-reload removed above)
# No custom Python file watcher needed

echo -e "${GREEN}Guitar Practice Routine App is ready!${NC}"
echo -e "${BLUE}Press Ctrl+C to stop all processes${NC}"

# Wait for all background processes
wait