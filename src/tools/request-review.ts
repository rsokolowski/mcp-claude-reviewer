import { ReviewRequest, ReviewResult } from '../types.js';
import { ReviewStorageManager } from '../storage-manager.js';
import { GitUtils } from '../git-utils.js';
import { ClaudeReviewer } from '../reviewers/claude-reviewer.js';
import { MockReviewer } from '../reviewers/mock-reviewer.js';
import { IReviewer } from '../reviewers/base.js';
import { loadConfig } from '../config.js';

export class RequestReviewHandler {
  private storage: ReviewStorageManager;
  private git: GitUtils;
  private reviewer: IReviewer;
  
  constructor() {
    this.storage = new ReviewStorageManager();
    this.git = new GitUtils();
    
    const config = loadConfig();
    
    // Use reviewer based on configuration
    if (config.useMockReviewer) {
      this.reviewer = new MockReviewer();
    } else {
      this.reviewer = new ClaudeReviewer();
    }
  }
  
  async handle(params: ReviewRequest): Promise<ReviewResult> {
    // Validate git repository
    const isGitRepo = await this.git.isGitRepository();
    if (!isGitRepo) {
      throw new Error('Not in a git repository');
    }
    
    // Get git information
    const gitDiff = await this.git.getGitDiff();
    const changedFiles = await this.git.getChangedFiles();
    const currentBranch = await this.git.getCurrentBranch();
    
    if (!gitDiff && changedFiles.length === 0) {
      throw new Error('No changes detected to review');
    }
    
    // Handle review chain
    let previousRounds: ReviewResult[] = [];
    let reviewId: string;
    
    if (params.previous_review_id) {
      // Continue existing review session
      const previousSession = await this.storage.getReviewSession(params.previous_review_id);
      previousRounds = previousSession.rounds;
      reviewId = params.previous_review_id;
    } else {
      // Create new review session
      reviewId = await this.storage.createReviewSession(params);
      await this.storage.saveGitDiff(reviewId, gitDiff);
    }
    
    // Perform the review
    const review = await this.reviewer.review(params, gitDiff, previousRounds);
    
    // Update review with correct ID and round
    review.review_id = reviewId;
    review.round = previousRounds.length + 1;
    
    // Save review result
    await this.storage.saveReviewResult(reviewId, review);
    
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
          }
        },
        required: ['summary']
      }
    };
  }
}