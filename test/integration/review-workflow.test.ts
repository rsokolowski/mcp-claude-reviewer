import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { RequestReviewHandler } from '../../src/tools/request-review.js';
import { GetReviewHistoryHandler } from '../../src/tools/get-review-history.js';
import { MarkReviewCompleteHandler } from '../../src/tools/mark-review-complete.js';
import { ReviewStorageManager } from '../../src/storage-manager.js';
import { ClaudeReviewer } from '../../src/reviewers/claude-reviewer.js';
import { createLogger } from '../../src/logger.js';
import { loadConfig } from '../../src/config.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTempDir, cleanupTestDir, createTestGitRepo } from '../utils/test-helpers.js';
import { createMockReviewResponse, createMockGitDiff } from '../utils/mock-factories.js';
import { GitUtils } from '../../src/git-utils.js';

jest.mock('../../src/config.js');
jest.mock('../../src/logger.js');
jest.mock('../../src/reviewers/claude-reviewer.js');

describe('Review Workflow Integration', () => {
  let testDir: string;
  let mockConfig: any;
  let mockLogger: any;
  let requestHandler: RequestReviewHandler;
  let historyHandler: GetReviewHistoryHandler;
  let completeHandler: MarkReviewCompleteHandler;

  beforeEach(async () => {
    testDir = await createTempDir();
    process.env.MCP_CLIENT_CWD = testDir;

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      dir: testDir
    };

    mockConfig = {
      logging: { level: 'info', toFile: false, toConsole: true },
      reviewStoragePath: '.reviews',
      persistReviewPrompts: false,
      reviewer: {
        type: 'claude',
        cliPath: '/usr/local/bin/claude',
        model: 'claude-3-opus',
        timeout: 120000,
        enableResume: true
      }
    };

    (loadConfig as jest.Mock).mockReturnValue(mockConfig);
    (createLogger as jest.Mock).mockReturnValue(mockLogger);

    // Initialize handlers
    requestHandler = new RequestReviewHandler();
    historyHandler = new GetReviewHistoryHandler();
    completeHandler = new MarkReviewCompleteHandler();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
    jest.clearAllMocks();
  });

  describe('Complete Review Cycle', () => {
    it('should handle a full review cycle: request → history → complete', async () => {
      // Create a git repo with changes
      await createTestGitRepo(testDir);
      
      // Mock the Claude reviewer
      const mockReviewResponse = createMockReviewResponse();
      (ClaudeReviewer as jest.Mock).mockImplementation(() => ({
        review: jest.fn<() => Promise<any>>().mockResolvedValue(mockReviewResponse)
      }));

      // Step 1: Request a review
      const reviewRequest = {
        summary: 'Implementing new feature for user authentication',
        focus_areas: ['security', 'error handling'],
        test_command: 'npm test'
      };

      const reviewResult = await requestHandler.handle(reviewRequest);

      expect(reviewResult).toMatchObject({
        review_id: expect.stringMatching(/^\d{4}-\d{2}-\d{2}-\d{3}$/),
        status: mockReviewResponse.status,
        overall_assessment: mockReviewResponse.overall_assessment,
        summary: mockReviewResponse.summary,
        round: 1
      });

      const reviewId = reviewResult.review_id;

      // Step 2: Get review history
      const history = await historyHandler.handle({ limit: 5 });

      expect(history).toHaveLength(1);
      const session = (history as any)[0];
      expect(session).toMatchObject({
        review_id: reviewId,
        status: expect.any(String),
        request: expect.objectContaining({
          summary: reviewRequest.summary
        }),
        rounds: expect.arrayContaining([
          expect.objectContaining({
            overall_assessment: mockReviewResponse.overall_assessment
          })
        ])
      });

      // Step 3: Mark review as complete
      const completeResult = await completeHandler.handle({
        review_id: reviewId,
        final_status: 'approved',
        notes: 'All issues addressed'
      });

      expect(completeResult).toMatchObject({
        success: true,
        review_id: reviewId,
        final_status: 'approved',
        message: `Review ${reviewId} marked as approved`
      });

      // Step 4: Verify the review is marked as complete in history
      const updatedHistory = await historyHandler.handle({ review_id: reviewId });

      expect(updatedHistory).toBeDefined();
      const updatedSession = updatedHistory as any;
      expect(updatedSession.review_id).toBe(reviewId);
      expect(updatedSession.status).toBe('approved');
      
      // Check if final notes were saved
      const notesFile = path.join(testDir, '.reviews', 'sessions', reviewId, 'final-notes.txt');
      const notesExist = await fs.stat(notesFile).then(() => true).catch(() => false);
      expect(notesExist).toBe(true);
      const notesContent = await fs.readFile(notesFile, 'utf-8');
      expect(notesContent).toBe('All issues addressed');
    });

    it('should handle multi-round reviews', async () => {
      // Create a git repo with changes
      await createTestGitRepo(testDir);
      
      const mockReviewResponse1 = createMockReviewResponse();
      mockReviewResponse1.overall_assessment = 'needs_changes';
      
      const mockReviewResponse2 = createMockReviewResponse();
      mockReviewResponse2.overall_assessment = 'lgtm';
      mockReviewResponse2.summary.critical_issues = 0;

      let reviewCallCount = 0;
      (ClaudeReviewer as jest.Mock).mockImplementation(() => ({
        review: jest.fn<() => Promise<any>>().mockImplementation(() => {
          reviewCallCount++;
          return Promise.resolve(reviewCallCount === 1 ? mockReviewResponse1 : mockReviewResponse2);
        })
      }));

      // Round 1: Initial review
      const reviewResult1 = await requestHandler.handle({
        summary: 'Initial implementation',
        focus_areas: ['logic', 'structure']
      });

      expect(reviewResult1.overall_assessment).toBe('needs_changes');
      const reviewId = reviewResult1.review_id;

      // Round 2: Follow-up review
      const reviewResult2 = await requestHandler.handle({
        summary: 'Addressed review feedback',
        previous_review_id: reviewId
      });

      expect(reviewResult2.review_id).toBe(reviewId);
      expect(reviewResult2.overall_assessment).toBe('lgtm');
      expect(reviewResult2.round).toBe(2);

      // Check history shows both rounds
      const history = await historyHandler.handle({ review_id: reviewId });

      expect(history).toBeDefined();
      const session = history as any;
      expect(session.rounds).toHaveLength(2);
      expect(session.rounds[0].overall_assessment).toBe('needs_changes');
      expect(session.rounds[1].overall_assessment).toBe('lgtm');
    });
  });

  describe('Error Scenarios', () => {
    it('should handle review request when not in a git repository', async () => {
      // Don't create a git repo - testDir is just an empty directory
      
      await expect(requestHandler.handle({
        summary: 'Test review'
      })).rejects.toThrow();
    });

    it('should handle review request with no changes', async () => {
      // Create a git repo but without any uncommitted changes
      await createTestGitRepo(testDir);
      
      // Stage and commit the changes so there are no uncommitted changes
      const simpleGit = (await import('simple-git')).default;
      const git = simpleGit(testDir);
      await git.add('.');
      await git.commit('Commit all changes');

      await expect(requestHandler.handle({
        summary: 'Test review'
      })).rejects.toThrow('No changes detected to review');
    });

    it('should handle marking non-existent review as complete', async () => {
      await expect(completeHandler.handle({
        review_id: 'non-existent-review',
        final_status: 'approved'
      })).rejects.toThrow('Review session non-existent-review not found');
    });

    it('should handle review history retrieval with invalid review ID', async () => {
      await createTestGitRepo(testDir);
      
      await expect(historyHandler.handle({
        review_id: 'non-existent-review'
      })).rejects.toThrow('Review session non-existent-review not found');
    });

    it('should handle Claude reviewer errors gracefully', async () => {
      await createTestGitRepo(testDir);
      
      (ClaudeReviewer as jest.Mock).mockImplementation(() => ({
        review: jest.fn<() => Promise<any>>().mockRejectedValue(new Error('Claude API error'))
      }));

      await expect(requestHandler.handle({
        summary: 'Test review'
      })).rejects.toThrow('Claude API error');
    });
  });

  describe('Storage Persistence', () => {
    it('should persist review data correctly', async () => {
      // Create a git repo with changes
      await createTestGitRepo(testDir);
      
      const mockReviewResponse = createMockReviewResponse();
      (ClaudeReviewer as jest.Mock).mockImplementation(() => ({
        review: jest.fn<() => Promise<any>>().mockResolvedValue(mockReviewResponse)
      }));

      const reviewResult = await requestHandler.handle({
        summary: 'Test persistence'
      });

      const reviewId = reviewResult.review_id;
      const sessionDir = path.join(testDir, '.reviews', 'sessions', reviewId);

      // Check session directory exists
      const sessionExists = await fs.stat(sessionDir).then(() => true).catch(() => false);
      expect(sessionExists).toBe(true);

      // Check session.json exists
      const sessionFile = path.join(sessionDir, 'session.json');
      const sessionData = JSON.parse(await fs.readFile(sessionFile, 'utf-8'));
      
      expect(sessionData).toMatchObject({
        review_id: reviewId,
        created_at: expect.any(String),
        updated_at: expect.any(String),
        status: expect.any(String),
        request: expect.objectContaining({
          summary: 'Test persistence'
        }),
        rounds: expect.arrayContaining([
          expect.objectContaining({
            review_id: reviewId,
            timestamp: expect.any(String),
            overall_assessment: mockReviewResponse.overall_assessment
          })
        ])
      });

      // Check round-1 directory exists
      const round1Dir = path.join(sessionDir, 'round-1');
      const round1Exists = await fs.stat(round1Dir).then(() => true).catch(() => false);
      expect(round1Exists).toBe(true);

      // Check git diff was saved
      const diffFile = path.join(sessionDir, 'changes.diff');
      const diffContent = await fs.readFile(diffFile, 'utf-8');
      expect(diffContent).toContain('diff --git');  // Real git diff output
    });

    it('should update latest review pointer', async () => {
      // Create a git repo with changes
      await createTestGitRepo(testDir);
      
      const mockReviewResponse = createMockReviewResponse();
      (ClaudeReviewer as jest.Mock).mockImplementation(() => ({
        review: jest.fn<() => Promise<any>>().mockResolvedValue(mockReviewResponse)
      }));

      const reviewResult = await requestHandler.handle({
        summary: 'Test latest pointer'
      });

      const latestFile = path.join(testDir, '.reviews', 'latest.json');
      const latestData = JSON.parse(await fs.readFile(latestFile, 'utf-8'));
      
      expect(latestData).toEqual({
        review_id: reviewResult.review_id
      });
    });
  });


  describe('Test Command Execution', () => {
    it('should execute test command when provided', async () => {
      // Create a git repo with changes
      await createTestGitRepo(testDir);
      
      const mockReviewResponse = createMockReviewResponse();
      let capturedRequest: any;
      
      (ClaudeReviewer as jest.Mock).mockImplementation(() => ({
        review: jest.fn<(request: any, gitDiff: string, previousRounds?: any[]) => Promise<any>>()
          .mockImplementation(async (request) => {
            capturedRequest = request;
            return mockReviewResponse;
          })
      }));

      await requestHandler.handle({
        summary: 'Test with command',
        test_command: 'npm test'
      });

      // Verify the test command was passed in the request
      expect(capturedRequest).toBeDefined();
      expect(capturedRequest.test_command).toBe('npm test');
    });
  });
});