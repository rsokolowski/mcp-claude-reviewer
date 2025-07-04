import { IReviewer } from './base.js';
import { ReviewRequest, ReviewResult } from '../types.js';

export class MockReviewer implements IReviewer {
  async review(
    request: ReviewRequest, 
    gitDiff: string, 
    previousRounds?: ReviewResult[]
  ): Promise<ReviewResult> {
    const round = previousRounds ? previousRounds.length + 1 : 1;
    
    // Simulate some basic analysis
    const hasDesignViolations = gitDiff.includes('exercise_id') || Math.random() > 0.7;
    const hasCriticalIssues = Math.random() > 0.8;
    const hasMajorIssues = Math.random() > 0.6;
    
    const review: ReviewResult = {
      review_id: `mock-${Date.now()}`,
      timestamp: new Date().toISOString(),
      status: hasDesignViolations || hasCriticalIssues ? 'needs_changes' : 'approved',
      round,
      design_compliance: {
        follows_architecture: !hasDesignViolations,
        major_violations: hasDesignViolations ? [
          {
            issue: "Schema misalignment with design document",
            description: "CasePoolSchema has exercise_id field, violating the case-centric architecture",
            impact: "critical",
            recommendation: "Remove exercise_id field and ensure pools are independent entities"
          }
        ] : []
      },
      comments: [
        {
          type: 'general',
          severity: 'suggestion',
          category: 'design',
          comment: 'Consider adding more comprehensive error handling',
          suggested_fix: 'Wrap database operations in try-catch blocks'
        }
      ],
      missing_requirements: hasMajorIssues ? [
        {
          requirement: "Case pools should have display_name field",
          design_doc_reference: "exercise-system-design.md#case-pool-schema",
          severity: "major"
        }
      ] : [],
      summary: {
        design_violations: hasDesignViolations ? 1 : 0,
        critical_issues: hasCriticalIssues ? 1 : 0,
        major_issues: hasMajorIssues ? 1 : 0,
        minor_issues: 1,
        suggestions: 1
      },
      test_results: {
        passed: true,
        summary: "Mock test results: All tests passed",
        coverage: "95%"
      },
      overall_assessment: hasDesignViolations || hasCriticalIssues 
        ? 'needs_changes' 
        : hasMajorIssues 
          ? 'lgtm_with_suggestions' 
          : 'lgtm'
    };
    
    return review;
  }
}