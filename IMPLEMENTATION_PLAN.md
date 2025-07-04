# MCP Claude Reviewer Implementation Plan

## Overview

This document outlines the incremental implementation of the MCP Claude Reviewer server. Each phase builds on the previous one and includes specific success criteria to ensure correctness before proceeding.

## Phase 1: Basic MCP Server Infrastructure

### Goals
- Set up minimal MCP server that can be connected to
- Implement basic tool registration
- Create project structure

### Tasks
1. Initialize TypeScript project with dependencies
   ```bash
   npm init -y
   npm install @modelcontextprotocol/sdk
   npm install -D typescript @types/node tsx
   ```

2. Create basic MCP server structure
   ```
   src/
   ├── index.ts          # MCP server entry point
   ├── types.ts          # TypeScript interfaces
   └── config.ts         # Configuration management
   ```

3. Implement minimal MCP server with one test tool
   ```typescript
   // src/index.ts
   import { Server } from '@modelcontextprotocol/sdk/server/index.js';
   
   const server = new Server({
     name: 'claude-reviewer',
     version: '0.1.0'
   });
   
   server.setRequestHandler(ListToolsRequestSchema, async () => ({
     tools: [{
       name: 'test_connection',
       description: 'Test that MCP server is working',
       inputSchema: { type: 'object', properties: {} }
     }]
   }));
   ```

### Success Criteria
- [ ] Server starts without errors
- [ ] Can connect via MCP client
- [ ] `test_connection` tool appears in tool list
- [ ] Tool can be called and returns success

### Testing
```bash
# Start server
npm run dev

# In another terminal, test with MCP client
npx @modelcontextprotocol/cli client stdio "node dist/index.js"
```

## Phase 2: Git Integration and File Storage

### Goals
- Detect git changes in current repository
- Capture and store diffs
- Set up review storage structure

### Tasks
1. Add git utilities
   ```bash
   npm install simple-git
   ```

2. Create git integration module
   ```typescript
   // src/git-utils.ts
   export async function getChangedFiles(): Promise<string[]>
   export async function getGitDiff(): Promise<string>
   export async function getCurrentBranch(): Promise<string>
   ```

3. Create review storage manager
   ```typescript
   // src/storage-manager.ts
   export class ReviewStorageManager {
     async createReviewSession(request: ReviewRequest): Promise<string>
     async saveReviewResult(reviewId: string, review: Review): Promise<void>
     async getReviewSession(reviewId: string): Promise<ReviewSession>
   }
   ```

4. Implement `.reviews/` directory structure creation

### Success Criteria
- [ ] Can detect changed files via git
- [ ] Can capture git diff of changes
- [ ] Review sessions saved to `.reviews/sessions/` with correct structure
- [ ] Can retrieve saved review sessions by ID
- [ ] Latest review tracked in `.reviews/latest.json`

### Testing
```typescript
// test/storage.test.ts
describe('ReviewStorageManager', () => {
  it('creates review session with unique ID');
  it('saves review with correct directory structure');
  it('updates latest.json pointer');
  it('retrieves review session by ID');
});
```

## Phase 3: Review Request Tool Implementation

### Goals
- Implement synchronous `request_review` tool
- Create mock reviewer for testing
- Return properly formatted review results

### Tasks
1. Define review data structures
   ```typescript
   // src/types.ts
   interface ReviewRequest { ... }
   interface ReviewResult { ... }
   interface DesignViolation { ... }
   ```

2. Implement `request_review` tool handler
   ```typescript
   // src/tools/request-review.ts
   export async function handleRequestReview(params: ReviewRequest): Promise<ReviewResult>
   ```

3. Create mock reviewer for testing
   ```typescript
   // src/reviewers/mock-reviewer.ts
   export class MockReviewer implements IReviewer {
     async review(request: ReviewRequest): Promise<ReviewResult>
   }
   ```

4. Wire up tool in MCP server

### Success Criteria
- [ ] `request_review` tool available in tool list
- [ ] Tool accepts correct parameters (summary, relevant_docs, etc.)
- [ ] Returns mock review with proper format
- [ ] Review includes design_compliance section
- [ ] Review saved to storage automatically
- [ ] Tool completes synchronously (no polling needed)

### Testing
```bash
# Call tool via MCP
{
  "tool": "request_review",
  "parameters": {
    "summary": "Implemented user authentication",
    "relevant_docs": ["docs/auth-design.md"]
  }
}
# Should return complete review immediately
```

## Phase 4: Claude CLI Integration

### Goals
- Integrate with actual Claude CLI for reviews
- Generate proper review prompts
- Parse Claude responses into structured format

### Tasks
1. Create Claude CLI interface
   ```typescript
   // src/claude-interface.ts
   export class ClaudeReviewer implements IReviewer {
     async review(request: ReviewRequest): Promise<ReviewResult>
     private generatePrompt(request: ReviewRequest): string
     private parseResponse(response: string): ReviewResult
   }
   ```

2. Implement prompt generation using template from design
   - Include git diff
   - Include relevant docs content
   - Format previous rounds if follow-up

3. Create response parser
   - Extract design violations
   - Parse review comments
   - Handle test results

4. Add configuration for Claude CLI path
   ```typescript
   // src/config.ts
   export const config = {
     claudeCliPath: process.env.CLAUDE_CLI_PATH || 'claude',
     reviewModel: process.env.REVIEW_MODEL || 'claude-3-opus-20240229'
   };
   ```

### Success Criteria
- [ ] Claude CLI successfully invoked
- [ ] Prompt includes all required sections
- [ ] Response parsed into structured format
- [ ] Design compliance issues properly categorized
- [ ] Test execution results included
- [ ] Handles Claude CLI errors gracefully

### Testing
```typescript
// test/claude-integration.test.ts
describe('ClaudeReviewer', () => {
  it('generates correct prompt with all sections');
  it('includes git diff in prompt');
  it('parses design violations from response');
  it('handles test results in response');
  it('falls back to mock on CLI errors');
});
```

## Phase 5: Review Chain Support

### Goals
- Support follow-up reviews with `previous_review_id`
- Link reviews in chains
- Include previous rounds in prompts

### Tasks
1. Update `request_review` to handle `previous_review_id`
   ```typescript
   if (params.previous_review_id) {
     const previousReview = await storage.getReviewSession(params.previous_review_id);
     // Include in prompt generation
   }
   ```

2. Create review chain in storage
   ```
   .reviews/sessions/2024-01-15-001/
   ├── round-1/
   ├── round-2/
   └── round-3/
   ```

3. Update prompt to include previous review rounds

4. Implement `mark_review_complete` tool

### Success Criteria
- [ ] Follow-up reviews reference previous review
- [ ] Review rounds stored in sequence
- [ ] Previous feedback included in new review prompts
- [ ] Can mark review chain as complete
- [ ] Review history browsable via `get_review_history`

### Testing
- Create initial review
- Submit follow-up with fixes
- Verify chain linkage
- Verify previous rounds in prompt

## Phase 6: Production Readiness

### Goals
- Add error handling and recovery
- Implement configuration file support
- Add logging and monitoring
- Create setup documentation

### Tasks
1. Add comprehensive error handling
   - Git operation failures
   - Storage errors
   - Claude CLI failures
   - Invalid review formats

2. Implement `.claude-reviewer.json` configuration
   ```json
   {
     "review_storage_path": ".reviews",
     "ignored_files": ["*.generated.ts"],
     "test_command": "npm test",
     "severity_thresholds": {
       "block_on": ["critical", "major"]
     }
   }
   ```

3. Add structured logging
   ```typescript
   // src/logger.ts
   export const logger = {
     info: (msg: string, meta?: any) => void,
     error: (msg: string, error?: Error) => void,
     debug: (msg: string, meta?: any) => void
   };
   ```

4. Create setup and usage documentation

### Success Criteria
- [ ] Graceful handling of all error cases
- [ ] Configuration file overrides defaults
- [ ] Logs provide debugging information
- [ ] README includes setup instructions
- [ ] Integration guide for CLAUDE.md

### Testing
- Test with missing git repository
- Test with read-only filesystem
- Test with missing Claude CLI
- Test with malformed configuration

## Phase 7: Advanced Features

### Goals
- Add review filtering and history browsing
- Support custom review prompts
- Add review metrics and analytics

### Tasks
1. Enhance `get_review_history` with filtering
   ```typescript
   interface HistoryFilters {
     status?: 'approved' | 'needs_changes';
     dateRange?: { from: Date; to: Date };
     author?: string;
   }
   ```

2. Support custom prompt templates
   ```
   .claude-reviewer/
   ├── prompts/
   │   ├── security-review.md
   │   └── performance-review.md
   ```

3. Add review metrics
   - Average review rounds to approval
   - Common violation types
   - Review turnaround time

### Success Criteria
- [ ] Can filter review history by various criteria
- [ ] Custom prompts used when specified
- [ ] Metrics dashboard available
- [ ] Export review data for analysis

## Validation Checklist

Before considering implementation complete:

- [ ] All synchronous operations (no waiting/polling)
- [ ] Design compliance is top review priority
- [ ] Review format matches specification exactly
- [ ] Storage structure follows design
- [ ] All tools match design document APIs
- [ ] Test coverage > 80%
- [ ] Documentation complete
- [ ] Example CLAUDE.md integration working
- [ ] Can handle multi-round reviews
- [ ] Production error scenarios handled