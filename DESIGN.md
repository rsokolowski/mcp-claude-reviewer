# MCP Claude Code Reviewer Design

## Overview

The MCP Claude Code Reviewer is a Model Context Protocol server that enables automated code review using Claude. It facilitates iterative review cycles between Claude implementations and Claude reviewers, storing review history for audit purposes.

## Architecture

### Components

1. **MCP Server** (`src/index.ts`)
   - Implements MCP protocol
   - Exposes review tools
   - Manages review sessions
   - Handles git operations

2. **Review Manager** (`src/review-manager.ts`)
   - Tracks review sessions
   - Manages review state
   - Handles file storage
   - Coordinates review rounds

3. **Git Integration** (`src/git-utils.ts`)
   - Detects changed files
   - Provides diff context
   - Manages review branches

4. **Claude CLI Interface** (`src/claude-interface.ts`)
   - Invokes Claude CLI for reviews
   - Manages review prompts
   - Handles response parsing

## MCP Protocol Design

### Tools Exposed

1. **request_review**
   ```typescript
   {
     name: "request_review",
     description: "Request code review for current changes - returns review immediately",
     inputSchema: {
       type: "object",
       properties: {
         summary: {
           type: "string",
           description: "Summary of work attempted and completed"
         },
         relevant_docs: {
           type: "array",
           items: { type: "string" },
           description: "List of relevant design docs/specs"
         },
         focus_areas: {
           type: "array",
           items: { type: "string" },
           description: "Specific areas to focus review on"
         },
         previous_review_id: {
           type: "string",
           description: "ID of previous review if this is a follow-up"
         }
       },
       required: ["summary"]
     }
   }
   ```
   Returns: Complete review object with comments and assessment

2. **get_review_history**
   ```typescript
   {
     name: "get_review_history",
     description: "Get historical reviews for audit/reference",
     inputSchema: {
       type: "object",
       properties: {
         limit: {
           type: "number",
           description: "Number of recent reviews to return (default: 5)"
         },
         review_id: {
           type: "string",
           description: "Specific review session to retrieve"
         }
       }
     }
   }
   ```

3. **mark_review_complete**
   ```typescript
   {
     name: "mark_review_complete",
     description: "Mark a review session as complete with final status",
     inputSchema: {
       type: "object",
       properties: {
         review_id: {
           type: "string",
           description: "Review session ID"
         },
         final_status: {
           type: "string",
           enum: ["approved", "abandoned", "merged"],
           description: "Final status of the review"
         },
         notes: {
           type: "string",
           description: "Final notes or summary"
         }
       },
       required: ["review_id", "final_status"]
     }
   }
   ```

## Review Storage Format

### Directory Structure
```
.reviews/
├── sessions/
│   ├── 2024-01-15-001/
│   │   ├── request.json       # Initial review request
│   │   ├── changes.diff       # Git diff at time of request
│   │   ├── round-1/
│   │   │   ├── review.json    # Review comments
│   │   │   └── response.json  # Coder's response
│   │   └── round-2/
│   │       ├── review.json
│   │       └── response.json
│   └── 2024-01-15-002/
│       └── ...
└── latest.json                # Points to latest session
```

### Review Format
```json
{
  "review_id": "2024-01-15-001",
  "timestamp": "2024-01-15T10:30:00Z",
  "status": "in_progress|approved|needs_changes",
  "round": 1,
  "design_compliance": {
    "follows_architecture": true|false,
    "major_violations": [
      {
        "issue": "Schema misalignment with design document",
        "description": "CasePoolSchema has exercise_id field, violating the case-centric architecture",
        "impact": "critical",
        "recommendation": "Remove exercise_id field and ensure pools are independent entities"
      }
    ]
  },
  "comments": [
    {
      "type": "specific|general",
      "file": "src/utils.ts",  // Optional for specific comments
      "line": 42,              // Optional for specific comments
      "severity": "critical|major|minor|suggestion",
      "category": "architecture|design|bug|performance|style|security|missing_feature",
      "comment": "Detailed review comment",
      "suggested_fix": "Optional code suggestion or architectural guidance"
    }
  ],
  "missing_requirements": [
    {
      "requirement": "Case pools should have display_name field",
      "design_doc_reference": "exercise-system-design.md#case-pool-schema",
      "severity": "major"
    }
  ],
  "summary": {
    "design_violations": 3,
    "critical_issues": 1,
    "major_issues": 2,
    "minor_issues": 3,
    "suggestions": 1
  },
  "test_results": {
    "passed": true,
    "summary": "87 tests passed, 0 failed, 3 skipped",
    "failing_tests": [],  // List of test names if any failed
    "coverage": "92%"
  },
  "overall_assessment": "needs_changes|lgtm_with_suggestions|lgtm"
}
```

## Review Prompts

### Reviewer Prompt Template
```markdown
You are a senior software engineer conducting a code review. Your primary goal is to ensure the implementation correctly follows the design documents and architectural decisions.

## Review Request
{request_summary}

## Relevant Documentation
{relevant_docs}

## Changed Files
{file_list}

## Focus Areas
{focus_areas}

## Review Priorities (in order of importance)

1. **Design Compliance** (MOST CRITICAL)
   - Does the implementation follow the architecture described in design docs?
   - Are data models and schemas aligned with specifications?
   - Are the relationships between entities correct?
   - Does the code respect the intended boundaries and abstractions?

2. **Missing Requirements**
   - What required fields, methods, or features are missing?
   - Are all specified behaviors implemented?
   - Do data structures contain all necessary properties?

3. **Structural Issues**
   - Are interfaces and contracts properly defined?
   - Is the code organized according to the architectural patterns?
   - Are dependencies flowing in the right direction?

4. **Implementation Quality**
   - Bugs, security issues, and performance problems
   - Code modularity and SOLID principles
   - Test coverage and quality
   - Error handling and edge cases

## Previous Review Rounds
{previous_rounds}

## Review Output Format

Focus on high-level architectural issues first. Line-by-line nitpicks are less important than design compliance.

Provide:
1. Design compliance assessment with specific violations
2. List of missing requirements from the design docs
3. Critical implementation issues (if any)
4. Overall assessment (needs_changes/lgtm_with_suggestions/lgtm)

Example feedback style:
- "CasePoolSchema has exercise_id field, but the design specifies pools are independent entities"
- "Import format expects flat array, but case generators produce nested structure with pool_info"
- "Missing required fields: display_name, created_at, updated_at from the design spec"

Before giving LGTM, run the test suite and verify the implementation works as designed.
```

### Response Format for Coder
```markdown
## Review Response - Round {round}

### Issues Addressed
{list_of_addressed_issues}

### Explanations
{explanations_for_unaddressed_items}

### Modified Files
{list_of_modified_files}

### Questions/Clarifications
{any_questions}
```

## Integration Flow

### CLAUDE.md Instructions for Coder
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

Example:
```

### Review Workflow (Synchronous)

1. **Coder completes work**
   - Stages/commits changes
   - Calls `request_review` with summary
   - Receives review results immediately

2. **MCP Server processes request synchronously**
   - Captures git diff
   - Creates review session
   - Invokes Claude CLI with reviewer prompt
   - Waits for review completion
   - Returns full review to coder

3. **Reviewer (via Claude CLI)**
   - Reads relevant docs
   - Reviews changes
   - Runs tests
   - Provides structured feedback
   - Returns complete review

4. **Coder addresses feedback**
   - Receives review in same call
   - Makes fixes based on feedback
   - Calls `request_review` again with `previous_review_id`
   - Links reviews in a chain

5. **Review completion**
   - When satisfied, coder calls `mark_review_complete`
   - Review chain is finalized for audit

## Implementation

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the detailed, incremental implementation plan with testable milestones and success criteria.

## Example Design-Focused Review

Here's an example of the type of high-value review feedback the system should produce:

```markdown
# Review Results for Admin Console Implementation

## Design Compliance Assessment: ❌ MAJOR VIOLATIONS

### 1. Schema Misalignment - CasePoolSchema
**File**: backend/app/schemas/admin.py
**Issue**: CasePoolSchema includes `exercise_id` field
**Design Violation**: According to the design document, case pools are independent entities. Exercises reference pools via `pool_id`, not the other way around.
**Impact**: CRITICAL - This breaks the entire case-centric architecture
**Fix**: Remove `exercise_id` from CasePoolSchema

### 2. Missing Required Fields
The CasePoolSchema is missing several fields specified in the design:
- `display_name` - Human-readable name
- `created_at` and `updated_at` - Required timestamps
- Pool metadata structure is incomplete

### 3. Import Format Mismatch
**Current Implementation**: Expects flat array of cases
```json
[{"case_key": "2x3", "case_data": {...}, "grading_data": {...}}]
```

**Design Specification**: Nested structure with pool info
```json
{
  "pool_info": {"name": "multiplication_facts_5x5", ...},
  "cases": [...]
}
```

### 4. Data Type Inconsistencies
- `correct_answer` is string in implementation but should be number for multiplication
- `grader_type` placed at case level instead of pool level

### 5. Missing Features
- No support for `filter_config` in exercise creation
- Missing `complexity_factors` critical for adaptive learning
- No `category` field implementation
- `source` field not tracked

## Recommendations
1. Immediate: Fix CasePoolSchema to remove exercise_id
2. High Priority: Align import format with case generator output
3. Required: Add all missing fields from design specification
4. Enhancement: Support both manual case selection and filter_config

## Test Results
✅ Tests: 87 passed, 0 failed, 3 skipped (92% coverage)
Note: Tests don't validate design compliance

## Overall Assessment: needs_changes
The implementation fundamentally misunderstands the case-centric architecture and requires significant updates to align with the design document.
```

## Configuration

### Environment Variables
```bash
CLAUDE_CLI_PATH=/usr/local/bin/claude
MAX_REVIEW_ROUNDS=5
REVIEW_MODEL=claude-3-opus-20240229
AUTO_RUN_TESTS=true
```

### Config File (.claude-reviewer.json)
```json
{
  "review_storage_path": ".reviews",
  "ignored_files": ["*.generated.ts", "*.test.ts"],
  "test_command": "npm test",
  "severity_thresholds": {
    "block_on": ["critical", "major"],
    "warn_on": ["minor"]
  }
}
```