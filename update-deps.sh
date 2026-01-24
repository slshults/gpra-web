#!/bin/bash
# update-deps.sh - Keep local dependencies up-to-date
# Usage: ./update-deps.sh [--check|--update|--all]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  GPRA Dependency Update Tool${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

check_pip() {
    echo -e "${YELLOW}Checking Python (pip) packages...${NC}"
    echo -e "(Note: Shows all outdated packages; --update only touches project deps)"
    echo ""
    if pip list --outdated 2>/dev/null | grep -v "^Package" | grep -v "^---"; then
        return 0
    else
        echo -e "${GREEN}All pip packages are up-to-date!${NC}"
        return 1
    fi
}

check_npm() {
    echo ""
    echo -e "${YELLOW}Checking npm packages...${NC}"
    if npm outdated 2>/dev/null; then
        return 0
    else
        echo -e "${GREEN}All npm packages are up-to-date!${NC}"
        return 1
    fi
}

update_pip() {
    echo ""
    echo -e "${YELLOW}Updating pip packages from pyproject.toml...${NC}"
    # Only update project dependencies, not all system packages
    pip install --upgrade -e . 2>/dev/null || pip install --upgrade .
    echo -e "${GREEN}Pip packages updated!${NC}"
}

update_npm() {
    echo ""
    echo -e "${YELLOW}Updating npm packages...${NC}"
    npm update
    echo -e "${GREEN}npm packages updated!${NC}"
}

pull_latest() {
    echo ""
    echo -e "${YELLOW}Pulling latest from git (includes Dependabot merges)...${NC}"
    git pull --rebase
    echo -e "${GREEN}Git pull complete!${NC}"
}

case "${1:-}" in
    --check)
        echo "Checking for outdated packages (no changes will be made)..."
        echo ""
        check_pip || true
        check_npm || true
        ;;
    --update)
        echo "Updating all packages..."
        update_pip
        update_npm
        echo ""
        echo -e "${GREEN}Done! You may want to run 'npm run build' to rebuild frontend.${NC}"
        ;;
    --pull)
        pull_latest
        echo ""
        echo -e "${YELLOW}Tip: Run './update-deps.sh --update' if new deps were added.${NC}"
        ;;
    --all)
        update_pip
        update_npm
        echo ""
        echo -e "${GREEN}All done! Run 'npm run build' if frontend deps changed.${NC}"
        ;;
    *)
        echo "Usage: ./update-deps.sh [OPTION]"
        echo ""
        echo "Options:"
        echo "  --check   Show outdated packages (no changes)"
        echo "  --update  Update pip and npm packages"
        echo "  --all     Same as --update (update pip + npm)"
        echo "  --pull    Git pull latest (use from VS Code terminal)"
        echo ""
        echo "Examples:"
        echo "  ./update-deps.sh --check   # See what's outdated"
        echo "  ./update-deps.sh --all     # Update all deps"
        ;;
esac
