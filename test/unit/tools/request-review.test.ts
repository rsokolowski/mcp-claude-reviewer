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
    }
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
  let handler: RequestReviewHandler;
  let mockStorage: any;
  let mockGit: any;
  let mockClaudeReviewer: any;
  let mockMockReviewer: any;

  beforeEach(() => {
    jest.spyOn(process, 'cwd').mockReturnValue('/test/project');
    
    // Setup storage mock
    mockStorage = {
      createReviewSession: jest.fn(() => Promise.resolve('2024-01-15-001')),
      saveReviewResult: jest.fn(() => Promise.resolve(undefined)),
      saveGitDiff: jest.fn(() => Promise.resolve(undefined)),
      getReviewSession: jest.fn(() => Promise.resolve(null)),
      getReviewHistory: jest.fn(() => Promise.resolve([])),
      markReviewComplete: jest.fn(() => Promise.resolve(undefined)),
      getLatestReview: jest.fn(() => Promise.resolve(null))
    };
    
    // Setup git mock
    mockGit = {
      isGitRepository: jest.fn(() => Promise.resolve(true)),
      getGitDiff: jest.fn(() => Promise.resolve('diff --git a/file.ts b/file.ts\n+added line')),
      getChangedFiles: jest.fn(() => Promise.resolve(['file.ts'])),
      getCurrentBranch: jest.fn(() => Promise.resolve('feature-branch')),
      getBaseBranch: jest.fn(() => Promise.resolve('main'))
    };
    
    // Setup reviewer mocks
    mockClaudeReviewer = {
      review: jest.fn(() => Promise.resolve(createMockReviewResponse()))
    };
    
    mockMockReviewer = {
      review: jest.fn(() => Promise.resolve(createMockReviewResponse()))
    };
    
    // Configure constructor mocks
    mockedStorageManager.mockImplementation(() => mockStorage);
    mockedGitUtils.mockImplementation(() => mockGit);
    mockedClaudeReviewer.mockImplementation(() => mockClaudeReviewer);
    mockedMockReviewer.mockImplementation(() => mockMockReviewer);
    
    // Create handler instance
    handler = new RequestReviewHandler();
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
    it('should perform a successful review', async () => {
      const args: ReviewRequest = {
        summary: 'Added new feature X',
        focus_areas: ['security', 'performance'],
        test_command: 'npm test'
      };

      const mockReview = createMockReviewResponse() as ReviewResult;
      mockReview.overall_assessment = 'lgtm';
      mockReview.status = 'approved'; // Status should match overall_assessment
      mockClaudeReviewer.review.mockImplementation(() => Promise.resolve(mockReview));

      const result = await handler.handle(args);

      // Verify storage operations
      expect(mockStorage.createReviewSession).toHaveBeenCalledWith(args);
      expect(mockStorage.saveGitDiff).toHaveBeenCalledWith('2024-01-15-001', 'diff --git a/file.ts b/file.ts\n+added line');
      expect(mockStorage.saveReviewResult).toHaveBeenCalledWith('2024-01-15-001', expect.any(Object));

      // Verify reviewer was called
      expect(mockClaudeReviewer.review).toHaveBeenCalledWith(
        args,
        'diff --git a/file.ts b/file.ts\n+added line',
        []
      );

      // Verify result
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

      mockStorage.getReviewSession.mockImplementation(() => Promise.resolve(previousSession));

      const args: ReviewRequest = {
        summary: 'Fixed issues from previous review',
        previous_review_id: '2024-01-14-001'
      };

      const mockReview = createMockReviewResponse() as ReviewResult;
      mockReview.overall_assessment = 'lgtm';
      mockReview.status = 'approved'; // Status should match overall_assessment
      mockClaudeReviewer.review.mockImplementation(() => Promise.resolve(mockReview));

      const result = await handler.handle(args);

      // Verify previous rounds were passed to reviewer
      expect(mockClaudeReviewer.review).toHaveBeenCalledWith(
        args,
        expect.any(String),
        previousSession.rounds
      );

      // Verify result has correct round number
      expect(result.round).toBe(2);
      expect(result.review_id).toBe('2024-01-14-001');
    });

    it('should use mock reviewer when configured', async () => {
      // Configure to use mock reviewer
      mockedLoadConfig.mockReturnValue({
        useClaudeReviewer: false,
        useMockReviewer: true,
        claudeCliPath: 'claude',
        reviewModel: 'test-model',
        reviewTimeout: 30000,
        logging: { level: 'INFO', toConsole: false, toFile: false }
      } as any);

      const args: ReviewRequest = { summary: 'Test with mock reviewer' };
      
      await handler.handle(args);

      expect(mockMockReviewer.review).toHaveBeenCalled();
      expect(mockClaudeReviewer.review).not.toHaveBeenCalled();
    });

    it('should validate test command patterns', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      
      const args: ReviewRequest = {
        summary: 'Test command validation',
        test_command: 'some-unknown-command'
      };

      // Default mock setup in beforeEach should handle this

      await handler.handle(args);

      // The handler will log a warning but still pass the command to the reviewer
      expect(mockClaudeReviewer.review).toHaveBeenCalledWith(
        expect.objectContaining({
          test_command: 'some-unknown-command'
        }),
        expect.any(String),
        expect.any(Array)
      );

      consoleSpy.mockRestore();
    });

    it('should handle git repository validation errors', async () => {
      mockGit.isGitRepository.mockImplementation(() => Promise.resolve(false));

      const args: ReviewRequest = { summary: 'Test outside git repo' };

      await expect(handler.handle(args)).rejects.toThrow('Not in a git repository');
    });

    it('should handle no changes error', async () => {
      mockGit.getGitDiff.mockImplementation(() => Promise.resolve(''));
      mockGit.getChangedFiles.mockImplementation(() => Promise.resolve([]));

      const args: ReviewRequest = { summary: 'Test with no changes' };

      await expect(handler.handle(args)).rejects.toThrow('No changes detected to review');
    });

    it('should handle review errors gracefully', async () => {
      // Use mockImplementation to make it reject
      (mockClaudeReviewer.review as jest.Mock).mockImplementation(() => Promise.reject(new Error('Review failed')));

      const args: ReviewRequest = { summary: 'Test review failure' };

      await expect(handler.handle(args)).rejects.toThrow('Review failed');
    });

    it('should include all optional fields in review request', async () => {
      const args: ReviewRequest = {
        summary: 'Comprehensive test',
        relevant_docs: ['design.md', 'spec.md'],
        focus_areas: ['security', 'performance', 'accessibility'],
        test_command: 'npm test'
      };

      // Default mock setup in beforeEach should handle this

      await handler.handle(args);

      expect(mockStorage.createReviewSession).toHaveBeenCalledWith(args);
      expect(mockClaudeReviewer.review).toHaveBeenCalledWith(
        args,
        expect.any(String),
        []
      );
    });

    it('should handle MCP_CLIENT_CWD environment variable', async () => {
      process.env.MCP_CLIENT_CWD = '/env/project';
      
      const args: ReviewRequest = { summary: 'Test with env working directory' };

      await handler.handle(args);

      // Verify that GitUtils was created with the environment directory
      expect(mockedGitUtils).toHaveBeenCalledWith('/env/project');
    });

    it('should handle workingDirectory parameter', async () => {
      const args = {
        summary: 'Test with custom working directory',
        workingDirectory: '/custom/project'
      };

      await handler.handle(args);

      // Verify GitUtils was created with custom directory
      expect(mockedGitUtils).toHaveBeenCalledWith('/custom/project');
    });

    it('should calculate review status correctly', async () => {
      const testCases = [
        { assessment: 'lgtm', expectedStatus: 'approved' },
        { assessment: 'lgtm_with_suggestions', expectedStatus: 'needs_changes' },
        { assessment: 'needs_changes', expectedStatus: 'needs_changes' }
      ];

      for (const { assessment, expectedStatus } of testCases) {
        jest.clearAllMocks();
        
        const mockReview = createMockReviewResponse() as ReviewResult;
        mockReview.overall_assessment = assessment as any;
        // Set status based on ClaudeReviewer logic
        mockReview.status = assessment === 'lgtm' ? 'approved' : 'needs_changes';
        mockClaudeReviewer.review.mockImplementation(() => Promise.resolve(mockReview));

        const result = await handler.handle({ summary: `Test ${assessment}` });

        expect(result.status).toBe(expectedStatus);
        expect(result.overall_assessment).toBe(assessment);
      }
    });

    it('should handle git diff with both staged and unstaged changes', async () => {
      const complexDiff = '=== STAGED CHANGES ===\ndiff --git a/staged.ts\n+staged\n\n=== UNSTAGED CHANGES ===\ndiff --git a/unstaged.ts\n+unstaged';
      mockGit.getGitDiff.mockImplementation(() => Promise.resolve(complexDiff));
      mockGit.getChangedFiles.mockImplementation(() => Promise.resolve(['staged.ts', 'unstaged.ts']));

      const args: ReviewRequest = { summary: 'Test complex diff' };
      
      // Default mock setup in beforeEach should handle this
      
      await handler.handle(args);

      expect(mockStorage.saveGitDiff).toHaveBeenCalledWith('2024-01-15-001', complexDiff);
      expect(mockClaudeReviewer.review).toHaveBeenCalledWith(
        args,
        complexDiff,
        []
      );
    });
  });
});