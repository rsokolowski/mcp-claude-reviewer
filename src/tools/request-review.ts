import { ReviewRequest, ReviewResult } from '../types.js';
import { ReviewStorageManager } from '../storage-manager.js';
import { GitUtils } from '../git-utils.js';
import { ReviewerFactory } from '../reviewers/factory.js';
import { ReviewerConfig } from '../reviewers/base.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { join } from 'path';

// Logger will be created with proper working directory in the handler

export class RequestReviewHandler {
  // Storage manager will be created per-request with the correct working directory
  
  constructor() {
    // No longer create storage manager here
  }
  
  private detectWorkingDirectory(providedDir?: string): string {
    // Priority order:
    // 1. Explicitly provided directory (from MCP request params)
    if (providedDir) {
      return providedDir;
    }
    
    // 2. Environment variable set by MCP client wrapper
    if (process.env.MCP_CLIENT_CWD) {
      return process.env.MCP_CLIENT_CWD;
    }
    
    // 3. Default to server's current working directory
    return process.cwd();
  }
  
  private validateTestCommandPattern(command: string, logger: any): void {
    // Common test command patterns
    const commonPatterns = [
      /^npm\s+(test|run\s+test)/,
      /^yarn\s+(test|run\s+test)/,
      /^pnpm\s+(test|run\s+test)/,
      /^python\s+-m\s+(pytest|unittest)/,
      /^pytest/,
      /^go\s+test/,
      /^cargo\s+test/,
      /^dotnet\s+test/,
      /^gradle\s+test/,
      /^mvn\s+test/,
      /^make\s+test/
    ];
    
    const trimmedCommand = command.trim();
    const matchesCommon = commonPatterns.some(pattern => pattern.test(trimmedCommand));
    
    if (!matchesCommon) {
      logger.warn('Test command does not match common patterns', { 
        command: trimmedCommand,
        hint: 'Common patterns include: npm test, yarn test, pytest, go test, etc.'
      });
    }
  }
  
  async handle(params: ReviewRequest & { workingDirectory?: string }): Promise<ReviewResult> {
    // Determine the working directory for this review
    const workingDir = this.detectWorkingDirectory(params.workingDirectory);
    
    // Load config from the working directory
    const config = loadConfig(workingDir);
    
    // Create a logger instance for this request
    // Logger instances are lightweight and creating them per-request ensures proper configuration isolation
    const logger = createLogger('request-review', config.logging, workingDir);
    logger.info('Review requested', { workingDir, hasWorkingDirParam: !!params.workingDirectory });
    
    // Create storage manager with the correct working directory
    const storage = new ReviewStorageManager(join(workingDir, config.reviewStoragePath));
    
    // Log working directory detection source
    if (params.workingDirectory) {
      logger.debug('Using provided working directory', { dir: params.workingDirectory });
    } else if (process.env.MCP_CLIENT_CWD) {
      logger.debug('Using MCP_CLIENT_CWD environment variable', { dir: process.env.MCP_CLIENT_CWD });
    } else {
      logger.debug('Using server process.cwd()', { dir: process.cwd() });
    }
    
    // Validate test command if provided
    if (params.test_command) {
      this.validateTestCommandPattern(params.test_command, logger);
    }
    
    // Create reviewer based on configuration
    const reviewerConfig: ReviewerConfig = {
      type: config.reviewer.type,
      cliPath: config.reviewer.cliPath,
      model: config.reviewer.model,
      timeout: config.reviewer.timeout,
      enableResume: config.reviewer.enableResume
    };
    
    const reviewer = ReviewerFactory.create(reviewerConfig, config.logging);
    
    // Create GitUtils instance with the correct working directory
    const git = new GitUtils(workingDir);
    
    // Validate git repository
    const isGitRepo = await git.isGitRepository();
    if (!isGitRepo) {
      throw new Error('Not in a git repository');
    }
    
    // Get git information
    const gitDiff = await git.getGitDiff();
    const changedFiles = await git.getChangedFiles();
    const currentBranch = await git.getCurrentBranch();
    
    if (!gitDiff && changedFiles.length === 0) {
      throw new Error('No changes detected to review');
    }
    
    // Handle review chain
    let previousRounds: ReviewResult[] = [];
    let reviewId: string;
    let session: any = null;
    
    if (params.previous_review_id) {
      // Continue existing review session
      const previousSession = await storage.getReviewSession(params.previous_review_id);
      previousRounds = previousSession.rounds;
      reviewId = params.previous_review_id;
      session = previousSession;
    } else {
      // Create new review session
      reviewId = await storage.createReviewSession(params);
      await storage.saveGitDiff(reviewId, gitDiff);
    }
    
    // Perform the review
    const review = await reviewer.review(params, gitDiff, previousRounds, session);
    
    // Update review with correct ID and round
    review.review_id = reviewId;
    review.round = previousRounds.length + 1;
    
    // Save review result
    await storage.saveReviewResult(reviewId, review);
    
    // Update session with Claude session ID if provided
    if ((review as any).__claudeSessionId) {
      const updatedSession = await storage.getReviewSession(reviewId);
      if (!updatedSession.claudeSessionIds) {
        updatedSession.claudeSessionIds = {};
      }
      const model = (review as any).__claudeModel || 'default';
      updatedSession.claudeSessionIds[model] = (review as any).__claudeSessionId;
      await storage.updateSession(reviewId, updatedSession);
    }
    
    return review;
  }
  
  static getToolDefinition() {
    return {
      name: 'request_review',
      description: 'Request code review for current changes - returns review immediately',
      inputSchema: {
        type: 'object' as const,
        properties: {
          summary: {
            type: 'string',
            description: 'Summary of work attempted and completed'
          },
          relevant_docs: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of relevant design docs/specs'
          },
          focus_areas: {
            type: 'array', 
            items: { type: 'string' },
            description: 'Specific areas to focus review on'
          },
          previous_review_id: {
            type: 'string',
            description: 'ID of previous review if this is a follow-up'
          },
          test_command: {
            type: 'string',
            description: 'Command to run tests (e.g. "npm test", "python -m pytest")'
          }
        },
        required: ['summary']
      }
    };
  }
}