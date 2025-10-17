#!/bin/bash

# Set up colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  GPRA Development Environment Shutdown${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Function to check if a process is running
check_process() {
    local name=$1
    local pattern=$2

    if pgrep -f "$pattern" > /dev/null 2>&1; then
        echo -e "${YELLOW}✓ $name is running${NC}"
        return 0
    else
        echo -e "${GREEN}✗ $name is not running${NC}"
        return 1
    fi
}

# Function to stop a process gracefully
stop_process() {
    local name=$1
    local pattern=$2
    local wait_time=${3:-3}

    echo -e "${BLUE}Stopping $name...${NC}"

    # Try graceful shutdown first (SIGTERM)
    pkill -TERM -f "$pattern" 2>/dev/null

    # Wait for process to stop
    local count=0
    while pgrep -f "$pattern" > /dev/null 2>&1 && [ $count -lt $wait_time ]; do
        sleep 1
        ((count++))
    done

    # Force kill if still running (SIGKILL)
    if pgrep -f "$pattern" > /dev/null 2>&1; then
        echo -e "${YELLOW}  Force stopping $name...${NC}"
        pkill -KILL -f "$pattern" 2>/dev/null
        sleep 1
    fi

    if pgrep -f "$pattern" > /dev/null 2>&1; then
        echo -e "${RED}  ✗ Failed to stop $name${NC}"
        return 1
    else
        echo -e "${GREEN}  ✓ $name stopped${NC}"
        return 0
    fi
}

# Check what's running
echo -e "${BLUE}Checking running services...${NC}"
echo ""

check_process "Flask server" "flask run"
FLASK_RUNNING=$?

check_process "Vite watcher" "npm run watch"
VITE_RUNNING=$?

check_process "Python file watcher" "inotifywait.*\.py"
WATCHER_RUNNING=$?

check_process "PostgreSQL" "postgres"
PG_RUNNING=$?

check_process "Redis" "redis-server"
REDIS_RUNNING=$?

check_process "Chrome/Playwright" "chrome.*playwright"
CHROME_RUNNING=$?

echo ""
echo -e "${BLUE}Shutting down services...${NC}"
echo ""

# 1. Stop Flask and related processes (from gpr.sh)
if [ $FLASK_RUNNING -eq 0 ] || [ $VITE_RUNNING -eq 0 ] || [ $WATCHER_RUNNING -eq 0 ]; then
    echo -e "${BLUE}Stopping development server processes...${NC}"

    # Stop Flask server
    stop_process "Flask server" "flask run" 3

    # Stop Vite watcher
    stop_process "Vite watcher" "npm run watch" 2

    # Stop file watcher
    stop_process "Python file watcher" "inotifywait.*\.py" 2

    # Cleanup any remaining Python processes related to run.py
    stop_process "Run.py processes" "python.*run\.py" 2

    echo ""
fi

# 2. Stop Chrome/Playwright processes
if [ $CHROME_RUNNING -eq 0 ]; then
    echo -e "${BLUE}Stopping Playwright/Chrome processes...${NC}"

    # Kill all Chrome processes spawned by Playwright
    pkill -f "chrome.*playwright" 2>/dev/null
    pkill -f "chrome.*mcp-chrome" 2>/dev/null

    # Wait a moment
    sleep 2

    # Force kill any remaining Chrome processes from Playwright
    pkill -9 -f "chrome.*playwright" 2>/dev/null
    pkill -9 -f "chrome.*mcp-chrome" 2>/dev/null

    if pgrep -f "chrome.*playwright" > /dev/null 2>&1 || pgrep -f "chrome.*mcp-chrome" > /dev/null 2>&1; then
        echo -e "${RED}  ✗ Some Chrome processes may still be running${NC}"
    else
        echo -e "${GREEN}  ✓ Chrome/Playwright stopped${NC}"
    fi

    echo ""
fi

# 3. Stop Redis
if [ $REDIS_RUNNING -eq 0 ]; then
    echo -e "${BLUE}Stopping Redis...${NC}"

    # Try graceful shutdown via redis-cli
    if command -v redis-cli &> /dev/null; then
        redis-cli shutdown 2>/dev/null
        sleep 1
    fi

    # Force stop if still running
    stop_process "Redis" "redis-server" 2

    echo ""
fi

# 4. Stop PostgreSQL
if [ $PG_RUNNING -eq 0 ]; then
    echo -e "${BLUE}Stopping PostgreSQL...${NC}"

    # Try pg_ctlcluster first
    if sudo pg_ctlcluster 14 main stop 2>/dev/null; then
        echo -e "${GREEN}  ✓ PostgreSQL stopped via pg_ctlcluster${NC}"
    else
        # Try service stop
        if sudo service postgresql stop 2>/dev/null; then
            echo -e "${GREEN}  ✓ PostgreSQL stopped via service${NC}"
        else
            # Last resort: direct kill
            stop_process "PostgreSQL" "postgres" 3
        fi
    fi

    echo ""
fi

# Final status check
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Final Status Check${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

ALL_STOPPED=0

if pgrep -f "flask run" > /dev/null 2>&1; then
    echo -e "${RED}✗ Flask is still running${NC}"
    ALL_STOPPED=1
else
    echo -e "${GREEN}✓ Flask stopped${NC}"
fi

if pgrep -f "npm run watch" > /dev/null 2>&1; then
    echo -e "${RED}✗ Vite is still running${NC}"
    ALL_STOPPED=1
else
    echo -e "${GREEN}✓ Vite stopped${NC}"
fi

if pgrep -f "redis-server" > /dev/null 2>&1; then
    echo -e "${RED}✗ Redis is still running${NC}"
    ALL_STOPPED=1
else
    echo -e "${GREEN}✓ Redis stopped${NC}"
fi

if pgrep -f "postgres" > /dev/null 2>&1; then
    echo -e "${RED}✗ PostgreSQL is still running${NC}"
    ALL_STOPPED=1
else
    echo -e "${GREEN}✓ PostgreSQL stopped${NC}"
fi

if pgrep -f "chrome.*playwright" > /dev/null 2>&1 || pgrep -f "chrome.*mcp-chrome" > /dev/null 2>&1; then
    echo -e "${RED}✗ Chrome/Playwright is still running${NC}"
    ALL_STOPPED=1
else
    echo -e "${GREEN}✓ Chrome/Playwright stopped${NC}"
fi

echo ""

if [ $ALL_STOPPED -eq 0 ]; then
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  All services stopped successfully! 🎸${NC}"
    echo -e "${GREEN}========================================${NC}"
    exit 0
else
    echo -e "${YELLOW}========================================${NC}"
    echo -e "${YELLOW}  Some services may still be running${NC}"
    echo -e "${YELLOW}========================================${NC}"
    exit 1
fi
