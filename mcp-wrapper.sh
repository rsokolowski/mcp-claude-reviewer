#!/bin/bash
# MCP Claude Reviewer Wrapper Script
# This script captures the current working directory and passes it to the MCP server

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Export the client's current working directory
export MCP_CLIENT_CWD="$(pwd)"

# Export the installation directory for config loading
export MCP_INSTALL_DIR="$SCRIPT_DIR"

# Run the MCP server with all arguments passed through
exec node "$SCRIPT_DIR/dist/index.js" "$@"