# MCP Claude Code Reviewer

An MCP (Model Context Protocol) server that enables automated code review using Claude. It facilitates iterative review cycles between Claude implementations and Claude reviewers, storing review history for audit purposes.

## Features

- **Synchronous code reviews** - Request and receive reviews immediately via MCP tools
- **Review chains** - Support for multi-round reviews with history tracking
- **Git integration** - Automatically captures diffs and changed files
- **Persistent storage** - All reviews stored in `.reviews/` directory for audit trail
- **Design compliance focus** - Reviews prioritize architectural alignment with design docs
- **Claude CLI integration** - Uses Claude CLI for actual code reviews (with mock fallback)

## Installation

```bash
npm install
npm run build
```

## Configuration

The server can be configured via environment variables or a `.claude-reviewer.json` file:

### Environment Variables

- `CLAUDE_CLI_PATH` - Path to Claude CLI (default: `claude`)
- `MAX_REVIEW_ROUNDS` - Maximum review rounds (default: `5`)
- `REVIEW_MODEL` - Claude model to use (default: `claude-3-opus-20240229`)
- `AUTO_RUN_TESTS` - Run tests during review (default: `false`)
- `USE_MOCK_REVIEWER` - Use mock reviewer instead of Claude CLI (default: `false`)
- `LOG_LEVEL` - Logging level: DEBUG|INFO|WARN|ERROR (default: `INFO`)
- `LOG_TO_FILE` - Enable file logging (default: `false`)
- `LOG_TO_CONSOLE` - Enable console logging (default: `true`)

### Configuration File

Create `.claude-reviewer.json` in your project root:

```json
{
  "claudeCliPath": "claude",
  "maxReviewRounds": 5,
  "reviewModel": "claude-3-opus-20240229",
  "autoRunTests": true,
  "reviewStoragePath": ".reviews",
  "ignoredFiles": ["*.generated.ts", "*.test.ts"],
  "testCommand": "npm test",
  "severityThresholds": {
    "blockOn": ["critical", "major"],
    "warnOn": ["minor"]
  }
}
```

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
  "previous_review_id": "2024-01-15-001"  // Optional, for follow-up reviews
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

# Test with mock reviewer
USE_MOCK_REVIEWER=true npm start

# Enable debug logging
LOG_LEVEL=DEBUG npm start
```

## Review Output Format

Reviews follow a structured format focusing on:

1. **Design Compliance** - Architecture and specification alignment
2. **Missing Requirements** - Features or fields not implemented
3. **Code Issues** - Bugs, security, performance problems
4. **Test Results** - Automated test execution outcomes

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