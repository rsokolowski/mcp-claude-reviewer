#!/bin/bash

# MCP Claude Reviewer - Single User Installation Script
# This script installs the MCP Claude Reviewer for the current user

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Set up error trap
trap 'echo -e "${RED}Installation failed. Please check the error messages above.${NC}"' ERR

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]:-$0}" )" && pwd )"

echo -e "${GREEN}MCP Claude Reviewer - User Installation${NC}"
echo "========================================"
echo

# Check if we're in the right directory
if [ ! -f "$SCRIPT_DIR/package.json" ]; then
    echo -e "${RED}Error: This script must be run from the mcp-claude-reviewer directory${NC}"
    exit 1
fi

# Check prerequisites
echo "Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Please install Node.js (v18 or later) from https://nodejs.org/"
    exit 1
fi

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm is not installed${NC}"
    echo "Please install npm along with Node.js"
    exit 1
fi

# Check Claude CLI
if ! command -v claude &> /dev/null; then
    echo -e "${YELLOW}Warning: Claude CLI is not installed${NC}"
    echo "Installation will continue, but you'll need to manually configure Claude"
    echo "Install Claude CLI from: https://claude.ai/code"
    CLAUDE_CLI_AVAILABLE=false
else
    CLAUDE_CLI_AVAILABLE=true
fi

echo -e "${GREEN}✓ Prerequisites check passed${NC}"
echo

# Install npm dependencies
echo "Installing npm dependencies..."
cd "$SCRIPT_DIR"
npm install
echo -e "${GREEN}✓ npm dependencies installed${NC}"
echo

# Copy example config if it doesn't exist
CONFIG_FILE="$SCRIPT_DIR/.claude-reviewer.json"
CONFIG_EXAMPLE="$SCRIPT_DIR/.claude-reviewer.json.example"

if [ ! -f "$CONFIG_EXAMPLE" ]; then
    echo -e "${RED}Error: Configuration example file not found: $CONFIG_EXAMPLE${NC}"
    exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Creating configuration file..."
    cp "$CONFIG_EXAMPLE" "$CONFIG_FILE"
    echo -e "${GREEN}✓ Configuration file created${NC}"
else
    echo -e "${YELLOW}Configuration file already exists, skipping${NC}"
fi

# Make wrapper script executable
WRAPPER_SCRIPT="$SCRIPT_DIR/mcp-wrapper.sh"

if [ ! -f "$WRAPPER_SCRIPT" ]; then
    echo -e "${RED}Error: Wrapper script not found: $WRAPPER_SCRIPT${NC}"
    exit 1
fi

echo "Setting executable permissions..."
chmod +x "$WRAPPER_SCRIPT"
echo -e "${GREEN}✓ Wrapper script is executable${NC}"
echo

# Configure MCP server
if [ "$CLAUDE_CLI_AVAILABLE" = true ]; then
    echo "Checking MCP server configuration..."
    
    # Check if claude-reviewer is already installed
    if claude mcp list 2>/dev/null | grep -q "^claude-reviewer:"; then
        # Get the current path
        CURRENT_PATH=$(claude mcp list | grep "^claude-reviewer:" | cut -d' ' -f2)
        
        if [ "$CURRENT_PATH" = "$SCRIPT_DIR/mcp-wrapper.sh" ]; then
            echo -e "${GREEN}✓ MCP server already configured with correct path${NC}"
        else
            echo -e "${YELLOW}MCP server 'claude-reviewer' already exists with different path:${NC}"
            echo "  Current: $CURRENT_PATH"
            echo "  Expected: $SCRIPT_DIR/mcp-wrapper.sh"
            echo ""
            echo "To update, first remove the existing server:"
            echo "  claude mcp remove claude-reviewer"
            echo "Then re-run this installer"
        fi
    else
        echo "Adding MCP server to Claude configuration..."
        
        # Add the MCP server with user scope
        claude mcp add --scope user claude-reviewer "$SCRIPT_DIR/mcp-wrapper.sh"
        EXIT_CODE=$?
        
        if [ $EXIT_CODE -eq 0 ]; then
            echo -e "${GREEN}✓ MCP server added to Claude${NC}"
        else
            echo -e "${YELLOW}Warning: Failed to add MCP server automatically${NC}"
            echo "You may need to add it manually using:"
            echo "  claude mcp add --scope user claude-reviewer \"$SCRIPT_DIR/mcp-wrapper.sh\""
        fi
    fi
else
    echo -e "${YELLOW}Claude CLI not available - manual configuration required${NC}"
    echo "To configure manually, add the following to your Claude configuration:"
    echo "  Server name: claude-reviewer"
    echo "  Command: $SCRIPT_DIR/mcp-wrapper.sh"
fi
echo

# Handle CLAUDE.md appending
CLAUDE_MD_PATH="$HOME/.claude/CLAUDE.md"
CLAUDE_MD_EXAMPLE="$SCRIPT_DIR/CLAUDE.md.example"

if [ ! -f "$CLAUDE_MD_EXAMPLE" ]; then
    echo -e "${RED}Error: CLAUDE.md.example not found: $CLAUDE_MD_EXAMPLE${NC}"
    exit 1
fi

echo "Configuring CLAUDE.md instructions..."

# Create .claude directory if it doesn't exist
mkdir -p "$HOME/.claude"

# Define markers for duplicate detection
MARKER1="mcp__claude-reviewer__request_review"
MARKER2="Code Review Requirements"
MARKER3="Request review using the MCP tool"

# Check if CLAUDE.md exists and if it already contains the review instructions
if [ -f "$CLAUDE_MD_PATH" ]; then
    # Check for multiple unique strings to ensure robust duplicate detection
    if grep -q "$MARKER1" "$CLAUDE_MD_PATH" && grep -q "$MARKER2" "$CLAUDE_MD_PATH" && grep -q "$MARKER3" "$CLAUDE_MD_PATH"; then
        echo -e "${YELLOW}Review instructions already present in CLAUDE.md, skipping${NC}"
    else
        echo "Appending review instructions to existing CLAUDE.md..."
        echo "" >> "$CLAUDE_MD_PATH"
        echo "" >> "$CLAUDE_MD_PATH"
        cat "$CLAUDE_MD_EXAMPLE" >> "$CLAUDE_MD_PATH"
        echo -e "${GREEN}✓ Review instructions appended to CLAUDE.md${NC}"
    fi
else
    echo "Creating new CLAUDE.md with review instructions..."
    cp "$CLAUDE_MD_EXAMPLE" "$CLAUDE_MD_PATH"
    echo -e "${GREEN}✓ CLAUDE.md created with review instructions${NC}"
fi

echo
echo -e "${GREEN}Installation complete!${NC}"
echo
echo "Next steps:"
echo "1. Restart Claude for the changes to take effect"
echo "2. The reviewer will automatically request reviews when appropriate"
echo "3. You can customize settings in: $CONFIG_FILE"
echo
echo "For more information, see:"
echo "  - README.md"
echo "  - SETUP_GUIDE.md"
echo