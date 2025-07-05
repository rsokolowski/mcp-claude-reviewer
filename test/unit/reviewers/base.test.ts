import { describe, it, expect } from '@jest/globals';
import { BaseReviewer, ReviewerConfig } from '../../../src/reviewers/base.js';
import { ReviewRequest, ReviewResult, ReviewSummary } from '../../../src/types.js';

// Create a concrete implementation for testing
class TestReviewer extends BaseReviewer {
  async review(
    request: ReviewRequest,
    gitDiff: string,
    previousRounds?: ReviewResult[]
  ): Promise<ReviewResult> {
    const review: ReviewResult = {
      review_id: 'test-review',
      timestamp: new Date().toISOString(),
      status: 'approved',
      round: 1,
      design_compliance: {
        follows_architecture: true,
        major_violations: []
      },
      comments: [
        {
          type: 'general',
          severity: 'major',
          category: 'bug',
          comment: 'Test comment 1'
        },
        {
          type: 'general',
          severity: 'critical',
          category: 'security',
          comment: 'Test comment 2'
        },
        {
          type: 'general',
          severity: 'minor',
          category: 'style',
          comment: 'Test comment 3'
        },
        {
          type: 'general',
          severity: 'suggestion',
          category: 'performance',
          comment: 'Test comment 4'
        }
      ],
      missing_requirements: [],
      summary: {} as ReviewSummary,
      test_results: {
        passed: true,
        summary: 'All tests passed'
      },
      overall_assessment: 'lgtm'
    };
    
    // Calculate summary using base class method
    review.summary = this.calculateSummary(review);
    
    return review;
  }
}

describe('BaseReviewer', () => {
  describe('calculateSummary', () => {
    it('should correctly count issues by severity', async () => {
      const config: ReviewerConfig = { type: 'claude' };
      const reviewer = new TestReviewer(config);
      
      const request: ReviewRequest = {
        summary: 'Test review'
      };
      
      const result = await reviewer.review(request, 'diff content');
      
      expect(result.summary).toEqual({
        design_violations: 0,
        critical_issues: 1,
        major_issues: 1,
        minor_issues: 1,
        suggestions: 1
      });
    });
    
    it('should count design violations', async () => {
      const config: ReviewerConfig = { type: 'claude' };
      const reviewer = new TestReviewer(config);
      
      // Override the review method to include design violations
      reviewer.review = async () => {
        const review: ReviewResult = {
          review_id: 'test-review',
          timestamp: new Date().toISOString(),
          status: 'needs_changes',
          round: 1,
          design_compliance: {
            follows_architecture: false,
            major_violations: [
              {
                issue: 'Violation 1',
                description: 'Test violation',
                impact: 'major',
                recommendation: 'Fix it'
              },
              {
                issue: 'Violation 2',
                description: 'Another violation',
                impact: 'critical',
                recommendation: 'Fix it now'
              }
            ]
          },
          comments: [],
          missing_requirements: [],
          summary: {} as ReviewSummary,
          test_results: {
            passed: false,
            summary: 'Tests failed'
          },
          overall_assessment: 'needs_changes'
        };
        
        review.summary = reviewer['calculateSummary'](review);
        return review;
      };
      
      const result = await reviewer.review({ summary: 'Test' }, 'diff');
      
      expect(result.summary.design_violations).toBe(2);
    });
  });
  
  describe('validateTestCommand', () => {
    it('should allow valid npm test commands', () => {
      const config: ReviewerConfig = { type: 'claude' };
      const reviewer = new TestReviewer(config);
      
      expect(reviewer['validateTestCommand']('npm test')).toBe('npm test');
      expect(reviewer['validateTestCommand']('npm run test')).toBe('npm run test');
      expect(reviewer['validateTestCommand']('npm run test:unit')).toBe('npm run test:unit');
    });
    
    it('should allow valid yarn test commands', () => {
      const config: ReviewerConfig = { type: 'claude' };
      const reviewer = new TestReviewer(config);
      
      expect(reviewer['validateTestCommand']('yarn test')).toBe('yarn test');
      expect(reviewer['validateTestCommand']('yarn run test:integration')).toBe('yarn run test:integration');
    });
    
    it('should allow valid python test commands', () => {
      const config: ReviewerConfig = { type: 'claude' };
      const reviewer = new TestReviewer(config);
      
      expect(reviewer['validateTestCommand']('pytest')).toBe('pytest');
      expect(reviewer['validateTestCommand']('pytest tests/')).toBe('pytest tests/');
      expect(reviewer['validateTestCommand']('python -m pytest')).toBe('python -m pytest');
      expect(reviewer['validateTestCommand']('python -m unittest')).toBe('python -m unittest');
    });
    
    it('should allow other valid test commands', () => {
      const config: ReviewerConfig = { type: 'claude' };
      const reviewer = new TestReviewer(config);
      
      expect(reviewer['validateTestCommand']('go test')).toBe('go test');
      expect(reviewer['validateTestCommand']('cargo test')).toBe('cargo test');
      expect(reviewer['validateTestCommand']('dotnet test')).toBe('dotnet test');
      expect(reviewer['validateTestCommand']('gradle test')).toBe('gradle test');
      expect(reviewer['validateTestCommand']('mvn test')).toBe('mvn test');
      expect(reviewer['validateTestCommand']('make test')).toBe('make test');
    });
    
    it('should reject invalid test commands', () => {
      const config: ReviewerConfig = { type: 'claude' };
      const reviewer = new TestReviewer(config);
      
      expect(reviewer['validateTestCommand']('rm -rf /')).toBeNull();
      expect(reviewer['validateTestCommand']('curl http://evil.com')).toBeNull();
      expect(reviewer['validateTestCommand']('npm install malware')).toBeNull();
      expect(reviewer['validateTestCommand']('echo "hacked" > /etc/passwd')).toBeNull();
    });
    
    it('should trim whitespace from commands', () => {
      const config: ReviewerConfig = { type: 'claude' };
      const reviewer = new TestReviewer(config);
      
      expect(reviewer['validateTestCommand']('  npm test  ')).toBe('npm test');
      expect(reviewer['validateTestCommand']('\tpytest\n')).toBe('pytest');
    });
  });
  
  describe('config access', () => {
    it('should store and provide access to config', () => {
      const config: ReviewerConfig = {
        type: 'gemini',
        cliPath: '/custom/path/gemini',
        model: 'gemini-pro',
        timeout: 300000,
        apiKey: 'test-key-123'
      };
      
      const reviewer = new TestReviewer(config);
      
      expect(reviewer['config']).toEqual(config);
      expect(reviewer['config'].type).toBe('gemini');
      expect(reviewer['config'].cliPath).toBe('/custom/path/gemini');
      expect(reviewer['config'].model).toBe('gemini-pro');
      expect(reviewer['config'].timeout).toBe(300000);
      expect(reviewer['config'].apiKey).toBe('test-key-123');
    });
  });
});