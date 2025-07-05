import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { RequestReviewHandler } from '../../../src/tools/request-review';
import { ReviewRequest, ReviewResult, ReviewSession } from '../../../src/types';
import { createMockReviewRequest, createMockReviewResponse } from '../../utils/mock-factories';

// Mock all dependencies at module level
jest.mock('../../../src/storage-manager');
jest.mock('../../../src/git-utils');
jest.mock('../../../src/reviewers/claude-reviewer');
jest.mock('../../../src/reviewers/mock-reviewer');
jest.mock('../../../src/config', () => ({
  loadConfig: jest.fn(() => ({
    useClaudeReviewer: true,
    useMockReviewer: false,
    claudeCliPath: 'claude',
    reviewModel: 'test-model',
    reviewTimeout: 30000,
    logging: {
      level: 'INFO',
      toConsole: false,
      toFile: false
    },
    reviewStoragePath: '.reviews'
  }))
}));

// Import after mocking to get mocked versions
import { ReviewStorageManager } from '../../../src/storage-manager';
import { GitUtils } from '../../../src/git-utils';
import { ClaudeReviewer } from '../../../src/reviewers/claude-reviewer';
import { MockReviewer } from '../../../src/reviewers/mock-reviewer';
import { loadConfig } from '../../../src/config';

const mockedStorageManager = ReviewStorageManager as jest.MockedClass<typeof ReviewStorageManager>;
const mockedGitUtils = GitUtils as jest.MockedClass<typeof GitUtils>;
const mockedClaudeReviewer = ClaudeReviewer as jest.MockedClass<typeof ClaudeReviewer>;
const mockedMockReviewer = MockReviewer as jest.MockedClass<typeof MockReviewer>;
const mockedLoadConfig = loadConfig as jest.MockedFunction<typeof loadConfig>;

describe('RequestReviewHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(process, 'cwd').mockReturnValue('/test/project');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.MCP_CLIENT_CWD;
  });

  describe('getToolDefinition', () => {
    it('should return correct tool definition', () => {
      const definition = RequestReviewHandler.getToolDefinition();
      
      expect(definition.name).toBe('request_review');
      expect(definition.description).toBe('Request code review for current changes - returns review immediately');
      expect(definition.inputSchema.required).toEqual(['summary']);
      expect(definition.inputSchema.properties).toHaveProperty('summary');
      expect(definition.inputSchema.properties).toHaveProperty('relevant_docs');
      expect(definition.inputSchema.properties).toHaveProperty('focus_areas');
      expect(definition.inputSchema.properties).toHaveProperty('previous_review_id');
      expect(definition.inputSchema.properties).toHaveProperty('test_command');
    });
  });

  describe('handle', () => {
    const setupMocks = (overrides: {
      storage?: any,
      git?: any,
      reviewer?: any,
      config?: any
    } = {}) => {
      const mockStorage = {
        createReviewSession: jest.fn(() => Promise.resolve('2024-01-15-001')),
        saveReviewResult: jest.fn(() => Promise.resolve(undefined)),
        saveGitDiff: jest.fn(() => Promise.resolve(undefined)),
        getReviewSession: jest.fn(() => Promise.resolve(null)),
        getReviewHistory: jest.fn(() => Promise.resolve([])),
        markReviewComplete: jest.fn(() => Promise.resolve(undefined)),
        getLatestReview: jest.fn(() => Promise.resolve(null)),
        ...overrides.storage
      };

      const mockGit = {
        isGitRepository: jest.fn(() => Promise.resolve(true)),
        getGitDiff: jest.fn(() => Promise.resolve('diff --git a/file.ts b/file.ts\n+added line')),
        getChangedFiles: jest.fn(() => Promise.resolve(['file.ts'])),
        getCurrentBranch: jest.fn(() => Promise.resolve('feature-branch')),
        getBaseBranch: jest.fn(() => Promise.resolve('main')),
        ...overrides.git
      };

      const mockReviewer = {
        review: jest.fn(() => Promise.resolve(createMockReviewResponse())),
        ...overrides.reviewer
      };

      mockedStorageManager.mockImplementation(() => mockStorage);
      mockedGitUtils.mockImplementation(() => mockGit);
      mockedClaudeReviewer.mockImplementation(() => mockReviewer);
      mockedMockReviewer.mockImplementation(() => mockReviewer);

      if (overrides.config) {
        mockedLoadConfig.mockReturnValue(overrides.config);
      }

      return { mockStorage, mockGit, mockReviewer };
    };

    it('should perform a successful review', async () => {
      const mockReview = createMockReviewResponse() as ReviewResult;
      mockReview.overall_assessment = 'lgtm';
      mockReview.status = 'approved';

      const { mockStorage, mockReviewer } = setupMocks({
        reviewer: { review: jest.fn(() => Promise.resolve(mockReview)) }
      });

      const handler = new RequestReviewHandler();
      const args: ReviewRequest = {
        summary: 'Added new feature X',
        focus_areas: ['security', 'performance'],
        test_command: 'npm test'
      };

      const result = await handler.handle(args);

      expect(mockStorage.createReviewSession).toHaveBeenCalledWith(args);
      expect(mockStorage.saveGitDiff).toHaveBeenCalledWith('2024-01-15-001', 'diff --git a/file.ts b/file.ts\n+added line');
      expect(mockStorage.saveReviewResult).toHaveBeenCalledWith('2024-01-15-001', expect.any(Object));
      expect(mockReviewer.review).toHaveBeenCalledWith(args, expect.any(String), []);
      expect(result).toMatchObject({
        review_id: '2024-01-15-001',
        status: 'approved',
        overall_assessment: 'lgtm',
        round: 1
      });
    });

    it('should perform a follow-up review', async () => {
      const previousSession: ReviewSession = {
        review_id: '2024-01-14-001',
        created_at: '2024-01-14T10:00:00Z',
        updated_at: '2024-01-14T11:00:00Z',
        status: 'needs_changes',
        rounds: [{
          ...createMockReviewResponse(),
          round: 1,
          overall_assessment: 'needs_changes'
        } as ReviewResult],
        request: createMockReviewRequest()
      };

      const mockReview = createMockReviewResponse() as ReviewResult;
      mockReview.overall_assessment = 'lgtm';
      mockReview.status = 'approved';

      const { mockStorage, mockReviewer } = setupMocks({
        storage: { 
          getReviewSession: jest.fn(() => Promise.resolve(previousSession)),
          createReviewSession: jest.fn(() => Promise.resolve('2024-01-15-001')),
          saveReviewResult: jest.fn(() => Promise.resolve(undefined)),
          saveGitDiff: jest.fn(() => Promise.resolve(undefined))
        },
        reviewer: { review: jest.fn(() => Promise.resolve(mockReview)) }
      });

      const handler = new RequestReviewHandler();
      const args: ReviewRequest = {
        summary: 'Fixed issues from previous review',
        previous_review_id: '2024-01-14-001'
      };

      const result = await handler.handle(args);

      expect(mockReviewer.review).toHaveBeenCalledWith(args, expect.any(String), previousSession.rounds);
      expect(result.round).toBe(2);
      expect(result.review_id).toBe('2024-01-14-001');
    });

    it('should use mock reviewer when configured', async () => {
      setupMocks({
        config: {
          useClaudeReviewer: false,
          useMockReviewer: true,
          claudeCliPath: 'claude',
          reviewModel: 'test-model',
          reviewTimeout: 30000,
          logging: { level: 'INFO', toConsole: false, toFile: false },
          reviewStoragePath: '.reviews'
        } as any
      });

      const handler = new RequestReviewHandler();
      const args: ReviewRequest = { summary: 'Test with mock reviewer' };
      
      await handler.handle(args);

      expect(mockedMockReviewer).toHaveBeenCalled();
      expect(mockedClaudeReviewer).not.toHaveBeenCalled();
    });

    it('should validate test command patterns', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const { mockReviewer } = setupMocks();

      const handler = new RequestReviewHandler();
      const args: ReviewRequest = {
        summary: 'Test command validation',
        test_command: 'some-unknown-command'
      };

      await handler.handle(args);

      expect(mockReviewer.review).toHaveBeenCalledWith(
        expect.objectContaining({
          test_command: 'some-unknown-command'
        }),
        expect.any(String),
        expect.any(Array)
      );

      consoleSpy.mockRestore();
    });

    it('should handle git repository validation errors', async () => {
      setupMocks({
        git: {
          isGitRepository: jest.fn(() => Promise.resolve(false)),
          getGitDiff: jest.fn(() => Promise.resolve('')),
          getChangedFiles: jest.fn(() => Promise.resolve([])),
          getCurrentBranch: jest.fn(() => Promise.resolve('main')),
          getBaseBranch: jest.fn(() => Promise.resolve('main'))
        }
      });

      const handler = new RequestReviewHandler();
      const args: ReviewRequest = { summary: 'Test outside git repo' };

      await expect(handler.handle(args)).rejects.toThrow('Not in a git repository');
    });

    it('should handle no changes error', async () => {
      setupMocks({
        git: {
          isGitRepository: jest.fn(() => Promise.resolve(true)),
          getGitDiff: jest.fn(() => Promise.resolve('')),
          getChangedFiles: jest.fn(() => Promise.resolve([])),
          getCurrentBranch: jest.fn(() => Promise.resolve('main')),
          getBaseBranch: jest.fn(() => Promise.resolve('main'))
        }
      });

      const handler = new RequestReviewHandler();
      const args: ReviewRequest = { summary: 'Test with no changes' };

      await expect(handler.handle(args)).rejects.toThrow('No changes detected to review');
    });

    it('should handle review errors gracefully', async () => {
      setupMocks({
        reviewer: {
          review: jest.fn(() => Promise.reject(new Error('Review failed')))
        }
      });

      const handler = new RequestReviewHandler();
      const args: ReviewRequest = { summary: 'Test review failure' };

      await expect(handler.handle(args)).rejects.toThrow('Review failed');
    });

    it('should include all optional fields in review request', async () => {
      const { mockStorage, mockReviewer } = setupMocks();

      const handler = new RequestReviewHandler();
      const args: ReviewRequest = {
        summary: 'Comprehensive test',
        relevant_docs: ['design.md', 'spec.md'],
        focus_areas: ['security', 'performance', 'accessibility'],
        test_command: 'npm test'
      };

      await handler.handle(args);

      expect(mockStorage.createReviewSession).toHaveBeenCalledWith(args);
      expect(mockReviewer.review).toHaveBeenCalledWith(args, expect.any(String), []);
    });

    it('should handle MCP_CLIENT_CWD environment variable', async () => {
      process.env.MCP_CLIENT_CWD = '/env/project';
      setupMocks();

      const handler = new RequestReviewHandler();
      const args: ReviewRequest = { summary: 'Test with env working directory' };

      await handler.handle(args);

      expect(mockedGitUtils).toHaveBeenCalledWith('/env/project');
    });

    it('should handle workingDirectory parameter', async () => {
      setupMocks();

      const handler = new RequestReviewHandler();
      const args = {
        summary: 'Test with custom working directory',
        workingDirectory: '/custom/project'
      };

      await handler.handle(args);

      expect(mockedGitUtils).toHaveBeenCalledWith('/custom/project');
    });

    it('should calculate review status correctly', async () => {
      const testCases = [
        { assessment: 'lgtm', expectedStatus: 'approved' },
        { assessment: 'lgtm_with_suggestions', expectedStatus: 'needs_changes' },
        { assessment: 'needs_changes', expectedStatus: 'needs_changes' }
      ];

      for (const { assessment, expectedStatus } of testCases) {
        const mockReview = createMockReviewResponse() as ReviewResult;
        mockReview.overall_assessment = assessment as any;
        mockReview.status = assessment === 'lgtm' ? 'approved' : 'needs_changes';

        setupMocks({
          reviewer: { review: jest.fn(() => Promise.resolve(mockReview)) }
        });

        const handler = new RequestReviewHandler();
        const result = await handler.handle({ summary: `Test ${assessment}` });

        expect(result.status).toBe(expectedStatus);
        expect(result.overall_assessment).toBe(assessment);
      }
    });

    it('should handle git diff with both staged and unstaged changes', async () => {
      const complexDiff = '=== STAGED CHANGES ===\ndiff --git a/staged.ts\n+staged\n\n=== UNSTAGED CHANGES ===\ndiff --git a/unstaged.ts\n+unstaged';
      
      const { mockStorage, mockReviewer } = setupMocks({
        git: {
          isGitRepository: jest.fn(() => Promise.resolve(true)),
          getGitDiff: jest.fn(() => Promise.resolve(complexDiff)),
          getChangedFiles: jest.fn(() => Promise.resolve(['staged.ts', 'unstaged.ts'])),
          getCurrentBranch: jest.fn(() => Promise.resolve('feature-branch')),
          getBaseBranch: jest.fn(() => Promise.resolve('main'))
        }
      });

      const handler = new RequestReviewHandler();
      const args: ReviewRequest = { summary: 'Test complex diff' };
      
      await handler.handle(args);

      expect(mockStorage.saveGitDiff).toHaveBeenCalledWith('2024-01-15-001', complexDiff);
      expect(mockReviewer.review).toHaveBeenCalledWith(args, complexDiff, []);
    });
  });
});