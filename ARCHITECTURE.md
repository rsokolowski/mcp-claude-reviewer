# Architecture

## Overview

MCP Claude Reviewer is a Model Context Protocol (MCP) server that provides code review capabilities using Claude. The architecture is designed to support multi-project environments and concurrent operations while maintaining proper isolation between different working directories.

## Core Design Principles

### 1. Stateless Request Handlers

All MCP tool handlers (`RequestReviewHandler`, `GetReviewHistoryHandler`, `MarkReviewCompleteHandler`) are implemented as stateless classes. This means:

- **No instance variables** for configuration, storage, or logging
- **Per-request initialization** of all dependencies
- **Working directory detection** happens at request time

**Rationale**: This design enables:
- Proper multi-project support where each request can operate on a different project
- Thread-safe concurrent request handling
- Better testability through dependency injection at the method level
- No shared state between requests that could cause cross-contamination

**Implementation Pattern**:
```typescript
export class RequestReviewHandler {
  // No instance variables - stateless design
  
  constructor() {
    // Empty constructor - no initialization
  }
  
  async handle(params: ReviewRequest & { workingDirectory?: string }): Promise<ReviewResult> {
    // Detect working directory for this request
    const workingDir = this.detectWorkingDirectory(params.workingDirectory);
    
    // Load configuration specific to this directory
    const config = loadConfig(workingDir);
    
    // Create logger instance for this request
    const logger = createLogger('request-review', config.logging, workingDir);
    
    // Create storage manager for this working directory
    const storage = new ReviewStorageManager(join(workingDir, config.reviewStoragePath));
    
    // ... rest of implementation
  }
}
```

### 2. Working Directory Detection

The system uses a three-tier priority system for determining the working directory:

1. **Explicit parameter** - `workingDirectory` passed in request params (highest priority)
2. **Environment variable** - `MCP_CLIENT_CWD` set by the MCP client
3. **Process CWD** - Falls back to `process.cwd()` (lowest priority)

This allows flexibility in how the tool is invoked while maintaining backward compatibility.

### 3. Storage Architecture

Each project maintains its own isolated storage structure:
```
project-root/
├── .reviews/              # Default storage location (configurable)
│   ├── sessions/         # Individual review sessions
│   │   ├── 2024-01-01-001/
│   │   │   ├── session.json
│   │   │   ├── request.json
│   │   │   ├── changes.diff
│   │   │   ├── round-1/
│   │   │   │   └── review.json
│   │   │   └── final-notes.txt
│   │   └── 2024-01-01-002/
│   └── latest.json       # Pointer to most recent review
└── .claude-reviewer.json  # Project-specific configuration
```

### 4. Configuration Loading

Configuration is loaded per-request from the working directory, allowing:
- Project-specific settings
- Environment variable overrides
- Default fallbacks

The configuration loading order:
1. Default configuration
2. Project-specific `.claude-reviewer.json`
3. Environment variable overrides

### 5. Review Session Management

Review sessions are identified by date-based IDs (e.g., `2024-01-15-001`) that:
- Are human-readable
- Sort naturally by date
- Avoid collisions within a project
- Reset daily

## Concurrency and Isolation

The stateless architecture ensures proper handling of concurrent requests:

- Each request gets its own configuration, logger, and storage manager
- No shared state between requests
- File system operations are atomic where possible
- Review IDs include incrementing numbers to avoid collisions

## Testing Strategy

The architecture supports comprehensive testing:

- **Unit tests** can easily mock dependencies since they're injected per-request
- **Integration tests** can simulate multi-project scenarios
- **No cleanup of singleton state** required between tests

## Future Considerations

- **Distributed locking** might be needed for high-concurrency scenarios
- **Caching layer** could improve performance for repeated configuration loads
- **Plugin architecture** could allow custom reviewers beyond Claude