# MCP Claude Code Reviewer

An MCP (Model Context Protocol) server that enables automated code review using Claude. It facilitates iterative review cycles between Claude implementations and Claude reviewers, storing review history for audit purposes.

**Key Feature**: Works seamlessly across multiple projects from a single installation. The reviewer automatically detects and operates in the directory where Claude Code is running.

## Features

- **Synchronous code reviews** - Request and receive reviews immediately via MCP tools
- **Review chains** - Support for multi-round reviews with history tracking
- **Git integration** - Automatically captures diffs and changed files
- **Persistent storage** - All reviews stored in `.reviews/` directory for audit trail
- **Design compliance focus** - Reviews prioritize architectural alignment with design docs
- **Claude CLI integration** - Uses Claude CLI for actual code reviews (with mock fallback)

## Installation

### Single Installation for Multiple Projects

1. Install in a central location:
```bash
cd ~
git clone <repository-url> mcp-claude-reviewer
cd mcp-claude-reviewer
npm install
npm run build
chmod +x mcp-wrapper.sh
```

2. Configure Claude Desktop to use the wrapper script:
```bash
# Using Claude Code CLI (recommended)
claude mcp add --scope user claude-reviewer /home/$USER/mcp-claude-reviewer/mcp-wrapper.sh
```

3. Use in any project:
```bash
cd ~/projects/my-project
claude  # Reviewer will operate in this directory
```

See [SETUP_GUIDE.md](SETUP_GUIDE.md) for detailed multi-project setup instructions.

## Configuration

The server is configured via a `.claude-reviewer.json` file:

Create `.claude-reviewer.json` in your project root (you can copy `.claude-reviewer.example.json` as a starting point):

```json
{
  "reviewStoragePath": ".reviews",
  "logging": {
    "level": "INFO",
    "toFile": false,
    "toConsole": true,
    "filePath": "/custom/path/to/logfile.log"
  },
  "persistReviewPrompts": false,
  "reviewer": {
    "type": "claude",
    "cliPath": "claude",
    "model": "claude-opus-4-20250514",
    "timeout": 120000,
    "enableResume": true
  }
}
```

### Multi-Reviewer Support

The reviewer now supports multiple AI review agents. You can configure which reviewer to use via the `reviewer` configuration:

#### Claude Reviewer (Default)
```json
{
  "reviewer": {
    "type": "claude",
    "cliPath": "claude",        // Path to Claude CLI
    "model": "claude-opus-4-20250514",  // Model to use (null for default)
    "timeout": 120000          // Timeout in milliseconds
  }
}
```

#### Gemini Reviewer
```json
{
  "reviewer": {
    "type": "gemini",
    "cliPath": "gemini",        // Path to Gemini CLI
    "model": "gemini-2.5-pro",  // Gemini model to use (default: gemini-2.5-pro)
    "timeout": 120000           // Timeout in milliseconds
  }
}
```

**Note:** The Gemini reviewer is fully functional and has been tested with Gemini CLI. Gemini reliably returns JSON-formatted reviews when prompted. The "experimental" designation indicates that while the implementation works correctly, it has not yet been extensively tested in production environments with large-scale usage.

#### Mock Reviewer (for testing)
```json
{
  "reviewer": {
    "type": "mock"              // No additional config needed
  }
}
```

**Notes**: 
- Test execution is now handled by providing a `test_command` parameter when requesting a review, rather than using a hardcoded test command in configuration.
- By default, no `--model` flag is passed to Claude CLI, allowing it to use its default model. You can specify a model by setting `reviewer.model` to a specific model name in the configuration file.
- The `filePath` option in logging configuration allows you to specify a custom log file path. If not provided, logs will be written to `logs/mcp-reviewer-YYYY-MM-DD.log` in your working directory.
- When `persistReviewPrompts` is set to `true`, review prompt files will be saved in `$MCP_INSTALL_DIR/review-prompts/` instead of being deleted after use. This is useful for debugging and auditing review requests.
  - **Security Note**: Review prompts may contain sensitive code. The directory is created with restrictive permissions (750).
  - **Maintenance**: Persisted prompts are not automatically cleaned up. Consider implementing a manual cleanup process to prevent disk space issues.
- The reviewer configuration supports different types: `claude`, `gemini`, and `mock` for testing.
- Model selection is configured via `reviewer.model` within the reviewer configuration.
- Resume functionality can be enabled/disabled via `reviewer.enableResume`.

### Claude Session Resume

When `enableResume` is true (default), the Claude reviewer will use the `--resume` flag to maintain conversation context across follow-up reviews. This provides:

- **Better Context**: Claude remembers the entire conversation history
- **Token Efficiency**: Reduces input tokens by 50-80% for follow-up reviews
- **Improved Understanding**: Claude can reference earlier discussions naturally
- **Cost Reduction**: Lower API costs due to fewer tokens

The system automatically:
- Stores Claude session IDs per model
- Uses `--resume` for follow-up reviews when available
- Falls back gracefully if resume fails
- Maintains separate sessions for different models

To disable resume functionality, set `enableResume: false` in your configuration.

The old configuration fields will continue to work for backward compatibility, but we recommend migrating to the new format for clarity.

See `.claude-reviewer.example.json` for a complete example.

## Usage

The MCP server exposes three tools:

### 1. request_review
Request a code review for current git changes.

```json
{
  "summary": "Brief description of changes",
  "relevant_docs": ["DESIGN.md", "API.md"],
  "focus_areas": ["performance", "security"],
  "previous_review_id": "2024-01-15-001",  // Optional, for follow-up reviews
  "test_command": "npm test"  // Optional, command to run tests
}
```

### 2. get_review_history
Retrieve historical reviews.

```json
{
  "limit": 5,  // Optional, defaults to 5
  "review_id": "2024-01-15-001"  // Optional, get specific review
}
```

### 3. mark_review_complete
Mark a review session as complete.

```json
{
  "review_id": "2024-01-15-001",
  "final_status": "approved",  // approved|abandoned|merged
  "notes": "Optional final notes"
}
```

## Integration with Claude Code

Add to your Claude Code's `CLAUDE.md`:

```markdown
## Code Review Process

When you complete a significant piece of work:

1. Use the `request_review` tool from the MCP server to request review
2. Provide a clear summary of:
   - What you were asked to implement
   - What you actually implemented
   - Any design decisions or trade-offs
   - Relevant documentation that should be followed

3. Review results are returned immediately in the same call
4. Address any feedback by making fixes
5. Call `request_review` again with `previous_review_id` to link reviews
6. When approved, call `mark_review_complete` to finalize
```

## Review Storage Structure

Reviews are stored in the `.reviews/` directory:

```
.reviews/
├── sessions/
│   ├── 2024-01-15-001/
│   │   ├── request.json       # Initial review request
│   │   ├── changes.diff       # Git diff at time of request
│   │   ├── round-1/
│   │   │   └── review.json    # Review comments
│   │   ├── round-2/
│   │   │   └── review.json    # Follow-up review
│   │   ├── session.json       # Session metadata
│   │   └── final-notes.txt    # Final notes (if any)
└── latest.json                # Points to latest session
```

## Development

```bash
# Run in development mode
npm run dev

# Run tests
npm test

# Build TypeScript
npm run build

# Test with mock reviewer (configure in .claude-reviewer.json)
npm start
```

## Review Output Format

Reviews follow a structured format focusing on:

1. **Design Compliance** - Architecture and specification alignment
2. **Missing Requirements** - Features or fields not implemented
3. **Code Issues** - Bugs, security, performance problems
4. **Test Results** - Test execution outcomes (when test command provided)

Example review structure:
```json
{
  "review_id": "2024-01-15-001",
  "status": "needs_changes",
  "design_compliance": {
    "follows_architecture": false,
    "major_violations": [...]
  },
  "comments": [...],
  "missing_requirements": [...],
  "test_results": {
    "passed": true,  // or null if no test command provided
    "summary": "Test execution results"
  },
  "overall_assessment": "needs_changes"
}
```

## Current Status

- ✅ Phase 1: Basic MCP server infrastructure
- ✅ Phase 2: Git integration and file storage  
- ✅ Phase 3: Review request tool with mock reviewer
- ✅ Phase 4: Claude CLI integration
- ✅ Phase 5: Review chains support
- ✅ Phase 6: Production readiness (logging, config, error handling)

## Architecture

See [DESIGN.md](DESIGN.md) for complete architecture documentation and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the phased implementation approach.