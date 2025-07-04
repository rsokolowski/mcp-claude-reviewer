# MCP Claude Code Reviewer

An MCP (Model Context Protocol) server that enables automated code review using Claude. It facilitates iterative review cycles between Claude implementations and Claude reviewers, storing review history for audit purposes.

## Features

- **Synchronous code reviews** - Request and receive reviews immediately via MCP tools
- **Review chains** - Support for multi-round reviews with history tracking
- **Git integration** - Automatically captures diffs and changed files
- **Persistent storage** - All reviews stored in `.reviews/` directory for audit trail
- **Design compliance focus** - Reviews prioritize architectural alignment with design docs

## Installation

```bash
npm install
npm run build
```

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
│   │   └── session.json       # Session metadata
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
```

## Current Status

- ✅ Phase 1: Basic MCP server infrastructure
- ✅ Phase 2: Git integration and file storage  
- ✅ Phase 3: Review request tool with mock reviewer
- 🚧 Phase 4: Claude CLI integration (next)
- ⏳ Phase 5: Review chains support
- ⏳ Phase 6: Production readiness

## Architecture

See [DESIGN.md](DESIGN.md) for complete architecture documentation and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the phased implementation approach.