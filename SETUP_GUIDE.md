# MCP Claude Reviewer - Multi-Project Setup Guide

This guide explains how to set up the MCP Claude Reviewer to work across multiple projects from a single installation.

## Quick Start

```bash
# 1. Clone and install
cd ~
git clone <your-repo-url> mcp-claude-reviewer
cd mcp-claude-reviewer
npm install

# 2. Add to Claude Code
claude mcp add --scope user claude-reviewer ~/mcp-claude-reviewer/mcp-wrapper.sh

# 3. Use in any project
cd ~/projects/my-project
claude  # Reviewer will work in this directory
```

## Detailed Installation

1. Clone the reviewer to a central location in your home directory:
```bash
cd ~
git clone <your-repo-url> mcp-claude-reviewer
cd mcp-claude-reviewer
npm install
npm run build
```

2. Make the wrapper script executable:
```bash
chmod +x ~/mcp-claude-reviewer/mcp-wrapper.sh
```

## Claude Desktop Configuration

You can configure the MCP server in two ways:

### Option 1: Using Claude Code CLI (Recommended)

```bash
# Add the MCP server globally (available in all projects)
claude mcp add --scope user claude-reviewer /home/YOUR_USERNAME/mcp-claude-reviewer/mcp-wrapper.sh

# Or add it only for the current project
claude mcp add --scope project claude-reviewer /home/YOUR_USERNAME/mcp-claude-reviewer/mcp-wrapper.sh
```

### Option 2: Manual Configuration

Edit your Claude configuration file (usually `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or similar location on other platforms):

```json
{
  "mcpServers": {
    "claude-reviewer": {
      "command": "/home/YOUR_USERNAME/mcp-claude-reviewer/mcp-wrapper.sh",
      "args": []
    }
  }
}
```

**Important**: Use the wrapper script (`mcp-wrapper.sh`) instead of directly calling the Node script. This wrapper captures the current working directory.

## Usage

1. Navigate to any project directory:
```bash
cd ~/projects/projectA
```

2. Start Claude Code in that directory:
```bash
claude
```

3. The reviewer will automatically detect your project directory and run reviews in the correct context.

## Project Configuration

Each project can have its own `.claude-reviewer.json` configuration file:

```json
{
  "claudeCliPath": "claude",
  "maxReviewRounds": 5,
  "reviewModel": null,
  "useMockReviewer": false,
  "reviewStoragePath": ".reviews",
  "reviewTimeout": 120000,
  "ignoredFiles": ["*.generated.ts", "*.test.ts"],
  "severityThresholds": {
    "blockOn": ["critical", "major"],
    "warnOn": ["minor"]
  },
  "logging": {
    "level": "INFO",
    "toFile": false,
    "toConsole": true,
    "filePath": "./logs/reviewer.log"
  },
  "persistReviewPrompts": false
}
```

The reviewer will look for this file in:
1. The current project directory (where Claude Code is running)
2. The reviewer installation directory (as a fallback)

## How It Works

1. The `mcp-wrapper.sh` script captures the current working directory when Claude starts the MCP server
2. This directory is passed to the reviewer via the `MCP_CLIENT_CWD` environment variable
3. The reviewer uses this directory for:
   - Running git commands
   - Loading project-specific configuration
   - Accessing project files

## Troubleshooting

### Reviewer runs in wrong directory
- Ensure you're using the wrapper script in your Claude configuration
- Check that the `MCP_CLIENT_CWD` environment variable is being set correctly
- Look at the reviewer logs for directory detection information

### Configuration not loaded
- Verify `.claude-reviewer.json` exists in your project root
- Check file permissions
- Look for error messages in the console

### Git commands fail
- Ensure you're in a git repository
- Check that you have uncommitted changes to review
- Verify git is accessible from the detected working directory

## Environment Variables

The following environment variables are automatically set by the system:
- `MCP_CLIENT_CWD`: Set by the wrapper script to indicate the client's working directory
- `MCP_INSTALL_DIR`: Set by the wrapper script to indicate the installation directory

Note: All configuration options should be set via the `.claude-reviewer.json` file rather than environment variables.