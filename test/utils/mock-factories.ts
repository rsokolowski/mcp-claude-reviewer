import { ReviewRequest, ReviewResult, ReviewSession } from '../../src/types';

export function createMockReviewRequest(): ReviewRequest {
  return {
    summary: 'Test review request',
    focus_areas: ['security', 'performance'],
    relevant_docs: ['README.md'],
    test_command: 'npm test',
  };
}

export function createMockReviewResponse(): ReviewResult {
  return {
    overall_assessment: 'needs_changes' as const,
    comments: [
      {
        type: 'specific' as const,
        file: 'src/index.ts',
        line: 10,
        severity: 'critical' as const,
        category: 'security',
        comment: 'Potential XSS vulnerability',
        suggested_fix: 'Sanitize user input',
      },
    ],
    summary: {
      design_violations: 0,
      critical_issues: 1,
      major_issues: 0,
      minor_issues: 0,
      suggestions: 0,
    },
    design_compliance: {
      follows_architecture: true,
      major_violations: [],
    },
    missing_requirements: [],
    test_results: {
      passed: true,
      summary: 'All tests passed',
    },
    review_id: 'test-review-123',
    timestamp: new Date().toISOString(),
    status: 'needs_changes' as const,
    round: 1,
  };
}

export function createMockGitDiff(): string {
  return `diff --git a/src/example.ts b/src/example.ts
index 123..456 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,5 +1,6 @@
 export function example() {
-  console.log('old');
+  console.log('new');
+  return true;
 }`;
}

export function createMockReviewSession(): ReviewSession {
  return {
    review_id: 'test-session-123',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: 'in_progress' as const,
    rounds: [createMockReviewResponse()],
    request: createMockReviewRequest(),
    git_diff: createMockGitDiff(),
    branch: 'feature/test',
  };
}