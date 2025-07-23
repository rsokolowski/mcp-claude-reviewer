import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { BaseReviewer, ReviewerConfig } from './base.js';
import { ReviewRequest, ReviewResult, ReviewSummary } from '../types.js';
import { generateReviewPrompt } from '../prompts/review-prompt.js';
import { config as globalConfig } from '../config.js';
import { GitUtils } from '../git-utils.js';
import { createLogger } from '../logger.js';

const execAsync = promisify(exec);

export class ClaudeReviewer extends BaseReviewer {
  private git: GitUtils;
  private logger = createLogger('claude-reviewer', globalConfig.logging);
  private sessionIds: Map<string, string> = new Map();
  
  constructor(reviewerConfig?: ReviewerConfig) {
    super(reviewerConfig || { 
      type: 'claude',
      cliPath: globalConfig.reviewer.cliPath,
      model: globalConfig.reviewer.model,
      timeout: globalConfig.reviewer.timeout,
      enableResume: globalConfig.reviewer.enableResume
    });
    this.git = new GitUtils();
  }
  
  async review(
    request: ReviewRequest, 
    gitDiff: string, 
    previousRounds?: ReviewResult[],
    session?: any
  ): Promise<ReviewResult> {
    try {
      // Check if Claude CLI is available
      await this.checkClaudeCLI();
      
      // Get changed files for the prompt
      const changedFiles = await this.git.getChangedFiles();
      
      // Check if we will use resume functionality
      const willUseResume = this.config.enableResume !== false && 
                           request.previous_review_id && 
                           session?.claudeSessionIds && 
                           session.claudeSessionIds[this.config.model || 'default'];
      
      // Generate the review prompt
      // Don't include previous rounds if we're using resume (Claude will have context)
      const prompt = generateReviewPrompt(
        request, 
        changedFiles, 
        willUseResume ? undefined : previousRounds,
        willUseResume
      );
      
      // Determine where to save the prompt file
      let promptFile: string;
      if (globalConfig.persistReviewPrompts) {
        const installDir = process.env.MCP_INSTALL_DIR;
        if (installDir) {
          // Validate MCP_INSTALL_DIR to prevent directory traversal
          if (!join(installDir).startsWith('/') && !join(installDir).match(/^[A-Za-z]:\\/)) {
            this.logger.error('MCP_INSTALL_DIR must be an absolute path');
            // Fall back to temp directory
            promptFile = join(tmpdir(), `claude-review-${Date.now()}.md`);
          } else {
            try {
              // Create review-prompts directory with restrictive permissions
              const reviewPromptsDir = join(installDir, 'review-prompts');
              if (!existsSync(reviewPromptsDir)) {
                mkdirSync(reviewPromptsDir, { recursive: true, mode: 0o750 });
              }
              
              // Generate filename with sanitized timestamp
              const timestamp = new Date().toISOString()
                .replace(/[:.]/g, '-')
                .replace('T', '_')
                .replace('Z', '');
              promptFile = join(reviewPromptsDir, `claude-review-${timestamp}.md`);
            } catch (error) {
              this.logger.error(`Failed to create review prompts directory: ${error instanceof Error ? error.message : String(error)}`);
              // Fall back to temp directory
              promptFile = join(tmpdir(), `claude-review-${Date.now()}.md`);
            }
          }
        } else {
          this.logger.warn('persistReviewPrompts is enabled but MCP_INSTALL_DIR is not set. Using temp directory.');
          promptFile = join(tmpdir(), `claude-review-${Date.now()}.md`);
        }
      } else {
        // Use temporary directory as before
        promptFile = join(tmpdir(), `claude-review-${Date.now()}.md`);
      }
      
      writeFileSync(promptFile, prompt);
      
      try {
        // Run Claude CLI with the prompt
        // Use --allowedTools to limit tools to only those needed for code exploration and tests
        let allowedTools = 'Read(**/*),Grep(**/*),LS(**),Bash(find:*),Bash(grep:*),Bash(rg:*)';
        
        // Add test command to allowed tools if provided
        if (request.test_command) {
          // Validate test command to prevent injection attacks
          const validTestCommand = this.validateTestCommand(request.test_command);
          if (validTestCommand) {
            allowedTools += `,Bash(${validTestCommand})`;
          }
        }
        
        // Only include --model flag if model is specified (non-null)
        const modelFlag = this.config.model ? ` --model ${this.config.model}` : '';
        const cliPath = this.config.cliPath || globalConfig.reviewer.cliPath;
        
        // Check if we should use resume functionality
        let resumeFlag = '';
        if (this.config.enableResume !== false && request.previous_review_id && session?.claudeSessionIds) {
          const modelKey = this.config.model || 'default';
          const sessionId = session.claudeSessionIds[modelKey];
          if (sessionId) {
            resumeFlag = ` --resume ${sessionId}`;
            this.logger.info('Using Claude session resume', { sessionId, model: modelKey });
          }
        }
        
        const command = `cat "${promptFile}" | ${cliPath} --print --output-format json${modelFlag}${resumeFlag} --allowedTools "${allowedTools}"`;
        
        // Log full Claude CLI invocation details
        this.logger.info(`Claude CLI invocation details:`, {
          fullCommand: command,
          promptFile: promptFile,
          promptLength: prompt.length,
          promptPreview: prompt.substring(0, 500) + (prompt.length > 500 ? '...' : ''),
          allowedTools: allowedTools,
          model: this.config.model || 'default',
          timeout: this.config.timeout || globalConfig.reviewer.timeout
        });
        
        // Log the full prompt content at debug level
        this.logger.debug(`Full prompt content:`, { prompt });
        
        let stdout: string, stderr: string;
        try {
          const result = await execAsync(command, {
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
            timeout: this.config.timeout || globalConfig.reviewer.timeout, // Use configurable timeout
            shell: '/bin/sh'
          });
          stdout = result.stdout;
          stderr = result.stderr;
          
          this.logger.info(`Claude CLI completed successfully`, {
            stdoutLength: stdout.length,
            stderrLength: stderr.length
          });
          
          if (stderr && !stderr.includes('Warning')) {
            this.logger.warn('Claude CLI stderr output', { stderr });
          }
          
          // Log first 200 chars of stdout for debugging
          this.logger.debug(`Claude CLI stdout preview`, { preview: stdout.substring(0, 200) });
        } catch (execError: any) {
          // Check if this is a session error and we should retry
          if (resumeFlag && this.isSessionError(execError)) {
            this.logger.debug('Session expired or invalid, retrying without resume', { 
              sessionId: session?.claudeSessionIds?.[this.config.model || 'default'],
              error: execError.message 
            });
            
            // Retry without resume flag
            const retryCommand = `cat "${promptFile}" | ${cliPath} --print --output-format json${modelFlag} --allowedTools "${allowedTools}"`;
            this.logger.info('Retrying Claude CLI without resume flag');
            
            try {
              const retryResult = await execAsync(retryCommand, {
                maxBuffer: 10 * 1024 * 1024,
                timeout: this.config.timeout || globalConfig.reviewer.timeout,
                shell: '/bin/sh'
              });
              stdout = retryResult.stdout;
              stderr = retryResult.stderr;
              
              this.logger.info('Claude CLI retry succeeded');
            } catch (retryError: any) {
              this.logger.error('Claude CLI retry also failed', {
                exitCode: retryError.code,
                message: retryError.message
              });
              throw retryError;
            }
          } else {
            this.logger.error(`Claude CLI command failed`, {
              exitCode: execError.code,
              signal: execError.signal,
              killed: execError.killed,
              stdout: execError.stdout?.substring(0, 500),
              stderr: execError.stderr,
              message: execError.message
            });
            throw execError;
          }
        }
        
        // Log the full Claude response at debug level
        this.logger.debug(`Full Claude CLI response:`, { 
          response: stdout,
          responseLength: stdout.length 
        });
        
        // Parse the response
        const review = this.parseResponse(stdout);
        
        // Log parsed review result
        this.logger.info(`Review completed:`, {
          reviewId: review.review_id,
          overallAssessment: review.overall_assessment,
          designViolations: review.design_compliance.major_violations.length,
          totalComments: review.comments.length,
          criticalIssues: review.comments.filter(c => c.severity === 'critical').length,
          majorIssues: review.comments.filter(c => c.severity === 'major').length,
          testsPassed: review.test_results?.passed
        });
        
        // Tests are now run by the reviewer through the provided test_command
        // The review result should already contain test_results if tests were run
        
        // Calculate summary
        review.summary = this.calculateSummary(review);
        
        // Attach session ID to the review for storage
        if (this.config.enableResume !== false) {
          const modelKey = this.config.model || 'default';
          const sessionId = this.sessionIds.get(modelKey);
          if (sessionId) {
            (review as any).__claudeSessionId = sessionId;
            (review as any).__claudeModel = modelKey;
          }
        }
        
        return review;
        
      } finally {
        // Clean up temp file only if not persisting
        if (!globalConfig.persistReviewPrompts && existsSync(promptFile)) {
          unlinkSync(promptFile);
        } else if (globalConfig.persistReviewPrompts) {
          this.logger.info(`Review prompt saved to: ${promptFile}`);
        }
      }
      
    } catch (error) {
      console.error('Claude CLI review failed:', error);
      throw error;
    }
  }
  
  private async checkClaudeCLI(): Promise<void> {
    try {
      const cliPath = this.config.cliPath || globalConfig.reviewer.cliPath;
      await execAsync(`${cliPath} --version`);
    } catch (error) {
      const cliPath = this.config.cliPath || globalConfig.reviewer.cliPath;
      throw new Error(`Claude CLI not found at ${cliPath}. Please install it or ensure it is in your system PATH.`);
    }
  }
  
  private parseResponse(response: string): ReviewResult {
    try {
      // Parse the Claude CLI JSON response
      const cliResponse = JSON.parse(response);
      
      // Validate it's a successful result
      if (cliResponse.type !== 'result' || cliResponse.is_error) {
        throw new Error(`Claude CLI returned an error: ${cliResponse.error || 'Unknown error'}`);
      }
      
      // Log CLI metadata for debugging and monitoring
      this.logger.info('Claude CLI execution stats', {
        duration_ms: cliResponse.duration_ms,
        duration_api_ms: cliResponse.duration_api_ms,
        num_turns: cliResponse.num_turns,
        total_cost_usd: cliResponse.total_cost_usd,
        input_tokens: cliResponse.usage?.input_tokens,
        output_tokens: cliResponse.usage?.output_tokens,
        cache_creation_tokens: cliResponse.usage?.cache_creation_input_tokens,
        cache_read_tokens: cliResponse.usage?.cache_read_input_tokens,
        session_id: cliResponse.session_id
      });
      
      // Store session ID for future use if resume is enabled
      if (this.config.enableResume !== false && cliResponse.session_id) {
        const modelKey = this.config.model || 'default';
        this.sessionIds.set(modelKey, cliResponse.session_id);
      }
      
      // Extract the actual review from the result field
      let reviewJson: string;
      const resultContent = cliResponse.result;
      
      if (typeof resultContent !== 'string') {
        throw new Error(`Unexpected result type: ${typeof resultContent}`);
      }
      
      // The result may contain explanatory text before the JSON review
      // Look for JSON content in the result
      if (resultContent.includes('```json')) {
        // Extract from markdown code block
        const jsonMatch = resultContent.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
          reviewJson = jsonMatch[1];
        } else {
          throw new Error('Found markdown JSON block but could not extract content');
        }
      } else {
        // Look for JSON object in the result
        const jsonStartIndex = resultContent.indexOf('{');
        if (jsonStartIndex === -1) {
          throw new Error('No JSON object found in result');
        }
        
        // Extract from the first { to the end (the JSON should be the last thing)
        const jsonContent = resultContent.substring(jsonStartIndex);
        
        // Find the matching closing brace
        let braceCount = 0;
        let jsonEndIndex = -1;
        let inString = false;
        let escapeNext = false;
        
        for (let i = 0; i < jsonContent.length; i++) {
          const char = jsonContent[i];
          
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          if (char === '"') {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '{') {
              braceCount++;
            } else if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                jsonEndIndex = i + 1;
                break;
              }
            }
          }
        }
        
        if (jsonEndIndex === -1) {
          throw new Error('Could not find matching closing brace for JSON review');
        }
        
        reviewJson = jsonContent.substring(0, jsonEndIndex);
      }
      
      // Parse the review JSON
      const parsed = JSON.parse(reviewJson);
      
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
      console.error('Failed to parse Claude CLI response:', error);
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
            description: `Failed to parse Claude CLI response: ${error instanceof Error ? error.message : 'Unknown error'}`,
            impact: 'major',
            recommendation: 'Check Claude CLI output and ensure it returns valid JSON with --output-format json'
          }]
        },
        comments: [{
          type: 'general',
          severity: 'major',
          category: 'design',
          comment: 'Review could not be parsed from Claude CLI response.',
          suggested_fix: 'Verify Claude CLI is working correctly and returns the expected JSON format'
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
  
  private isSessionError(error: any): boolean {
    // Check various indicators of session-related errors
    const errorMessage = error.message?.toLowerCase() || '';
    const stdout = error.stdout?.toLowerCase() || '';
    const stderr = error.stderr?.toLowerCase() || '';
    
    const sessionErrorPatterns = [
      'session not found',
      'invalid session',
      'session expired',
      'session does not exist',
      'no such session',
      'session_not_found'
    ];
    
    return sessionErrorPatterns.some(pattern => 
      errorMessage.includes(pattern) || 
      stdout.includes(pattern) || 
      stderr.includes(pattern)
    );
  }
  
  // Test execution is now handled by the reviewer via allowed tools
}