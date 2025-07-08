import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { BaseReviewer, ReviewerConfig } from './base.js';
import { ReviewRequest, ReviewResult, ReviewSummary } from '../types.js';
import { generateReviewPrompt } from '../prompts/review-prompt.js';
import { GitUtils } from '../git-utils.js';
import { createLogger } from '../logger.js';
import { config as globalConfig } from '../config.js';

const execAsync = promisify(exec);

/**
 * Gemini Reviewer Implementation
 * 
 * Uses the Gemini CLI to perform code reviews. The implementation has been tested
 * with Gemini CLI and confirmed to work with the following command format:
 * `gemini --model <model> < promptfile`
 * 
 * Gemini reliably returns JSON when prompted for it, making integration straightforward.
 * 
 * @experimental - While functional, more extensive testing in production scenarios is recommended
 */
export class GeminiReviewer extends BaseReviewer {
  private git: GitUtils;
  private logger = createLogger('gemini-reviewer', globalConfig.logging);
  
  constructor(reviewerConfig?: ReviewerConfig) {
    const defaultConfig: ReviewerConfig = {
      type: 'gemini',
      cliPath: 'gemini',
      model: 'gemini-2.5-pro',
      timeout: globalConfig.reviewer.timeout || 120000,
      enableResume: false
    };
    
    super(reviewerConfig ? { ...defaultConfig, ...reviewerConfig } : defaultConfig);
    this.git = new GitUtils();
  }
  
  async review(
    request: ReviewRequest, 
    gitDiff: string, 
    previousRounds?: ReviewResult[],
    session?: any
  ): Promise<ReviewResult> {
    try {
      // Check if Gemini CLI is available
      await this.checkGeminiCLI();
      
      // Get changed files for the prompt
      const changedFiles = await this.git.getChangedFiles();
      
      // Generate the review prompt
      const prompt = generateReviewPrompt(request, changedFiles, previousRounds);
      
      // Note: Gemini CLI doesn't have the same tool restrictions as Claude CLI
      // It will have access to its full capabilities during review
      
      try {
        // Build Gemini CLI command
        const cliPath = this.config.cliPath || 'gemini';
        const model = this.config.model || 'gemini-2.5-pro';
        
        this.logger.info(`Gemini CLI invocation details:`, {
          cliPath: cliPath,
          model: model,
          promptLength: prompt.length,
          timeout: this.config.timeout
        });
        
        // Execute Gemini CLI using spawn for safer stdin handling
        let stdout = '';
        let stderr = '';
        
        try {
          await new Promise<void>((resolve, reject) => {
            const geminiProcess = spawn(cliPath, ['--model', model]);
            
            // Set timeout
            const timeout = setTimeout(() => {
              geminiProcess.kill();
              reject(new Error(`Gemini CLI timed out after ${this.config.timeout || 120000}ms`));
            }, this.config.timeout || 120000);
            
            // Collect output
            geminiProcess.stdout.on('data', (data) => {
              stdout += data.toString();
            });
            
            geminiProcess.stderr.on('data', (data) => {
              stderr += data.toString();
            });
            
            // Handle completion
            geminiProcess.on('close', (code) => {
              clearTimeout(timeout);
              if (code !== 0) {
                reject(new Error(`Gemini CLI exited with code ${code}`));
              } else {
                resolve();
              }
            });
            
            geminiProcess.on('error', (err) => {
              clearTimeout(timeout);
              reject(err);
            });
            
            // Write prompt to stdin
            geminiProcess.stdin.write(prompt);
            geminiProcess.stdin.end();
          });
          
          this.logger.info(`Gemini CLI completed successfully`, {
            stdoutLength: stdout.length,
            stderrLength: stderr.length
          });
          
          if (stderr) {
            this.logger.warn('Gemini CLI stderr output', { stderr });
          }
          
        } catch (execError: any) {
          this.logger.error(`Gemini CLI command failed`, {
            exitCode: execError.code,
            signal: execError.signal,
            stdout: execError.stdout?.substring(0, 500),
            stderr: execError.stderr,
            message: execError.message
          });
          throw execError;
        }
        
        // Parse the response
        const review = this.parseResponse(stdout);
        
        // Calculate summary
        review.summary = this.calculateSummary(review);
        
        this.logger.info(`Review completed:`, {
          reviewId: review.review_id,
          overallAssessment: review.overall_assessment,
          designViolations: review.design_compliance.major_violations.length,
          totalComments: review.comments.length
        });
        
        return review;
        
      } catch (error) {
        this.logger.error('Gemini CLI review failed:', error);
        throw error;
      }
      
    } catch (error) {
      this.logger.error('Gemini CLI review failed:', error);
      throw error;
    }
  }
  
  private async checkGeminiCLI(): Promise<void> {
    try {
      const cliPath = this.config.cliPath || 'gemini';
      // Gemini CLI uses --version flag
      await execAsync(`${cliPath} --version`);
    } catch (error) {
      const cliPath = this.config.cliPath || 'gemini';
      throw new Error(`Gemini CLI not found at ${cliPath}. Please install it or ensure it is in your system PATH.`);
    }
  }
  
  private parseResponse(response: string): ReviewResult {
    try {
      // Gemini returns clean JSON directly when asked for it
      let reviewJson: any;
      
      // First try to parse the entire response as JSON
      try {
        reviewJson = JSON.parse(response.trim());
      } catch {
        // If that fails, look for JSON within the response
        // This handles cases where Gemini might add some text before/after the JSON
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          reviewJson = JSON.parse(jsonMatch[0]);
        } else {
          // Sometimes Gemini might return markdown code blocks
          const codeBlockMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
          if (codeBlockMatch) {
            reviewJson = JSON.parse(codeBlockMatch[1]);
          } else {
            throw new Error('No valid JSON found in Gemini response');
          }
        }
      }
      
      // Gemini follows our requested format exactly, so we can use it directly
      const review: ReviewResult = {
        review_id: '', // Will be set by handler
        timestamp: new Date().toISOString(),
        status: reviewJson.overall_assessment === 'lgtm' ? 'approved' : 'needs_changes',
        round: 1, // Will be set by handler
        design_compliance: reviewJson.design_compliance || {
          follows_architecture: true,
          major_violations: []
        },
        comments: reviewJson.comments || [],
        missing_requirements: reviewJson.missing_requirements || [],
        summary: {} as ReviewSummary, // Will be calculated
        test_results: reviewJson.test_results || {
          passed: true,
          summary: 'No tests run'
        },
        overall_assessment: reviewJson.overall_assessment || 'needs_changes'
      };
      
      return review;
      
    } catch (error) {
      this.logger.error('Failed to parse Gemini response:', error);
      
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
            description: `Failed to parse Gemini CLI response: ${error instanceof Error ? error.message : 'Unknown error'}`,
            impact: 'major',
            recommendation: 'Check Gemini CLI output and ensure it returns valid JSON'
          }]
        },
        comments: [{
          type: 'general',
          severity: 'major',
          category: 'design',
          comment: 'Review could not be parsed from Gemini CLI response.',
          suggested_fix: 'Verify Gemini CLI is working correctly and returns the expected JSON format'
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
}