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
        let allowedTools = 'Read(**/*),Grep(**/*),LS(**)';
        
        // Add test command to allowed tools if provided
        if (request.test_command) {
          // Validate test command to prevent injection attacks
          const validTestCommand = this.validateTestCommand(request.test_command);
          if (validTestCommand) {
            allowedTools += `,Bash(${validTestCommand})`;
          }
        }
        
        const command = `${config.claudeCliPath} --print --output-format json --model ${config.reviewModel} --allowedTools "${allowedTools}" < "${promptFile}"`;
        const { stdout, stderr } = await execAsync(command, {
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          timeout: config.reviewTimeout // Use configurable timeout
        });
        
        if (stderr && !stderr.includes('Warning')) {
          console.error('Claude CLI stderr:', stderr);
        }
        
        // Parse the response
        const review = this.parseResponse(stdout);
        
        // Tests are now run by the reviewer through the provided test_command
        // The review result should already contain test_results if tests were run
        
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
      // With --output-format json, the response should be pure JSON
      const parsed = JSON.parse(response);
      
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
      console.error('Failed to parse Claude response as JSON:', error);
      console.error('Raw response (first 500 chars):', response.substring(0, 500));
      
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
            description: 'Failed to parse Claude CLI JSON response. Ensure Claude CLI is properly configured.',
            impact: 'major',
            recommendation: 'Check that Claude CLI supports --output-format json option'
          }]
        },
        comments: [{
          type: 'general',
          severity: 'major',
          category: 'design',
          comment: 'Review could not be parsed. The Claude CLI did not return valid JSON.',
          suggested_fix: 'Verify Claude CLI version supports --output-format json flag'
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
  
  // Test execution is now handled by the reviewer via allowed tools
  
  private validateTestCommand(command: string): string | null {
    // Whitelist of allowed test command patterns
    const allowedPatterns = [
      /^npm\s+(test|run\s+test(:[a-zA-Z0-9_-]+)?)$/,
      /^yarn\s+(test|run\s+test(:[a-zA-Z0-9_-]+)?)$/,
      /^pnpm\s+(test|run\s+test(:[a-zA-Z0-9_-]+)?)$/,
      /^python\s+-m\s+(pytest|unittest)(\s+[a-zA-Z0-9_./\\-]+)?$/,
      /^pytest(\s+[a-zA-Z0-9_./\\-]+)?$/,
      /^go\s+test(\s+[a-zA-Z0-9_./\\-]+)?$/,
      /^cargo\s+test(\s+[a-zA-Z0-9_-]+)?$/,
      /^dotnet\s+test(\s+[a-zA-Z0-9_./\\-]+)?$/,
      /^gradle\s+test$/,
      /^mvn\s+test$/,
      /^make\s+test$/
    ];
    
    const trimmedCommand = command.trim();
    
    // Check if command matches any allowed pattern
    const isAllowed = allowedPatterns.some(pattern => pattern.test(trimmedCommand));
    
    if (!isAllowed) {
      console.warn(`Test command "${trimmedCommand}" does not match allowed patterns. Skipping test execution for security.`);
      return null;
    }
    
    return trimmedCommand;
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