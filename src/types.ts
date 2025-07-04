export interface ReviewRequest {
  summary: string;
  relevant_docs?: string[];
  focus_areas?: string[];
  previous_review_id?: string;
  test_command?: string;
}

export interface DesignViolation {
  issue: string;
  description: string;
  impact: 'critical' | 'major' | 'minor';
  recommendation: string;
}

export interface ReviewComment {
  type: 'specific' | 'general';
  file?: string;
  line?: number;
  severity: 'critical' | 'major' | 'minor' | 'suggestion';
  category: 'architecture' | 'design' | 'bug' | 'performance' | 'style' | 'security' | 'missing_feature';
  comment: string;
  suggested_fix?: string;
}

export interface MissingRequirement {
  requirement: string;
  design_doc_reference?: string;
  severity: 'critical' | 'major' | 'minor';
}

export interface TestResults {
  /**
   * Test execution status:
   * - true: All tests passed successfully
   * - false: One or more tests failed
   * - null: No test command was provided, tests were not run
   */
  passed: boolean | null;
  summary: string;
  failing_tests?: string[];
  coverage?: string;
}

export interface ReviewSummary {
  design_violations: number;
  critical_issues: number;
  major_issues: number;
  minor_issues: number;
  suggestions: number;
}

export interface ReviewResult {
  review_id: string;
  timestamp: string;
  status: 'in_progress' | 'approved' | 'needs_changes';
  round: number;
  design_compliance: {
    follows_architecture: boolean;
    major_violations: DesignViolation[];
  };
  comments: ReviewComment[];
  missing_requirements: MissingRequirement[];
  summary: ReviewSummary;
  test_results: TestResults;
  overall_assessment: 'needs_changes' | 'lgtm_with_suggestions' | 'lgtm';
}

export interface ReviewSession {
  review_id: string;
  created_at: string;
  updated_at: string;
  status: 'in_progress' | 'approved' | 'needs_changes' | 'abandoned' | 'merged';
  rounds: ReviewResult[];
  request: ReviewRequest;
  git_diff?: string;
  branch?: string;
}