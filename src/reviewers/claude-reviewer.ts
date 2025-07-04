import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { IReviewer } from './base.js';
import { ReviewRequest, ReviewResult, ReviewSummary } from '../types.js';
import { generateReviewPrompt } from '../prompts/review-prompt.js';
import { config } from '../config.js';
import { GitUtils } from '../git-utils.js';

const execAsync = promisify(exec);

export class ClaudeReviewer implements IReviewer {
  private git: GitUtils;
  private useMockFallback: boolean = false;
  
  constructor() {
    this.git = new GitUtils();
  }
  
  async review(
    request: ReviewRequest, 
    gitDiff: string, 
    previousRounds?: ReviewResult[]
  ): Promise<ReviewResult> {
    try {
      // Check if Claude CLI is available
      await this.checkClaudeCLI();
      
      // Get changed files for the prompt
      const changedFiles = await this.git.getChangedFiles();
      
      // Generate the review prompt
      const prompt = generateReviewPrompt(request, gitDiff, changedFiles, previousRounds);
      
      // Save prompt to temporary file
      const promptFile = join(tmpdir(), `claude-review-${Date.now()}.md`);
      writeFileSync(promptFile, prompt);
      
      try {
        // Run Claude CLI with the prompt
        // Use --allowedTools to limit tools to only those needed for code exploration and tests
        const allowedTools = 'Read(**/*),Grep(**/*),Bash(npm:*),Bash(node:*),Bash(test:*),LS(**)';
        const command = `${config.claudeCliPath} --model ${config.reviewModel} --allowedTools "${allowedTools}" < "${promptFile}"`;
        const { stdout, stderr } = await execAsync(command, {
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          timeout: 60000 // 60 second timeout to prevent hanging
        });
        
        if (stderr && !stderr.includes('Warning')) {
          console.error('Claude CLI stderr:', stderr);
        }
        
        // Parse the response
        const review = this.parseResponse(stdout);
        
        // Run tests if configured
        if (config.autoRunTests && config.testCommand) {
          const testResults = await this.runTests();
          review.test_results = testResults;
        }
        
        // Calculate summary
        review.summary = this.calculateSummary(review);
        
        return review;
        
      } finally {
        // Clean up temp file
        if (existsSync(promptFile)) {
          unlinkSync(promptFile);
        }
      }
      
    } catch (error) {
      console.error('Claude CLI review failed:', error);
      
      // Fall back to mock reviewer if Claude CLI fails
      if (this.useMockFallback) {
        console.log('Falling back to mock reviewer');
        const { MockReviewer } = await import('./mock-reviewer.js');
        const mockReviewer = new MockReviewer();
        return mockReviewer.review(request, gitDiff, previousRounds);
      }
      
      throw error;
    }
  }
  
  private async checkClaudeCLI(): Promise<void> {
    try {
      await execAsync(`${config.claudeCliPath} --version`);
    } catch (error) {
      throw new Error(`Claude CLI not found at ${config.claudeCliPath}. Please install it or update CLAUDE_CLI_PATH environment variable.`);
    }
  }
  
  private parseResponse(response: string): ReviewResult {
    try {
      // Extract JSON from the response
      // Claude might include explanation before/after the JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in Claude response');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Ensure all required fields are present
      const review: ReviewResult = {
        review_id: '', // Will be set by handler
        timestamp: new Date().toISOString(),
        status: parsed.overall_assessment === 'lgtm' ? 'approved' : 'needs_changes',
        round: 1, // Will be set by handler
        design_compliance: parsed.design_compliance || {
          follows_architecture: true,
          major_violations: []
        },
        comments: parsed.comments || [],
        missing_requirements: parsed.missing_requirements || [],
        summary: {} as ReviewSummary, // Will be calculated
        test_results: parsed.test_results || {
          passed: true,
          summary: 'No tests run'
        },
        overall_assessment: parsed.overall_assessment || 'needs_changes'
      };
      
      return review;
      
    } catch (error) {
      console.error('Failed to parse Claude response:', error);
      console.error('Raw response:', response);
      
      // Return a generic review if parsing fails
      return {
        review_id: '',
        timestamp: new Date().toISOString(),
        status: 'needs_changes',
        round: 1,
        design_compliance: {
          follows_architecture: false,
          major_violations: [{
            issue: 'Review Parse Error',
            description: 'Failed to parse Claude review response',
            impact: 'major',
            recommendation: 'Check Claude CLI output format'
          }]
        },
        comments: [{
          type: 'general',
          severity: 'major',
          category: 'design',
          comment: 'Review could not be parsed. Raw response logged to console.',
          suggested_fix: 'Ensure Claude outputs valid JSON format'
        }],
        missing_requirements: [],
        summary: {
          design_violations: 1,
          critical_issues: 0,
          major_issues: 1,
          minor_issues: 0,
          suggestions: 0
        },
        test_results: {
          passed: false,
          summary: 'Review parsing failed'
        },
        overall_assessment: 'needs_changes'
      };
    }
  }
  
  private async runTests(): Promise<ReviewResult['test_results']> {
    try {
      const { stdout, stderr } = await execAsync(config.testCommand);
      
      // Simple heuristic to determine if tests passed
      const passed = !stderr || stderr.toLowerCase().includes('warning');
      
      return {
        passed,
        summary: stdout.substring(0, 500),
        failing_tests: passed ? undefined : ['See test output for details']
      };
      
    } catch (error) {
      return {
        passed: false,
        summary: `Test command failed: ${error}`,
        failing_tests: ['Test execution failed']
      };
    }
  }
  
  private calculateSummary(review: ReviewResult): ReviewSummary {
    const summary: ReviewSummary = {
      design_violations: review.design_compliance.major_violations.length,
      critical_issues: 0,
      major_issues: 0,
      minor_issues: 0,
      suggestions: 0
    };
    
    for (const comment of review.comments) {
      switch (comment.severity) {
        case 'critical':
          summary.critical_issues++;
          break;
        case 'major':
          summary.major_issues++;
          break;
        case 'minor':
          summary.minor_issues++;
          break;
        case 'suggestion':
          summary.suggestions++;
          break;
      }
    }
    
    return summary;
  }
}