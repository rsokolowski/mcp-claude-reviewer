import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { GetReviewHistoryHandler } from '../../../src/tools/get-review-history';
import { ReviewStorageManager } from '../../../src/storage-manager';
import { ReviewSession, ReviewResult } from '../../../src/types';
import { createMockReviewRequest, createMockReviewResponse } from '../../utils/mock-factories';

jest.mock('../../../src/storage-manager');
jest.mock('../../../src/config', () => ({
  config: {
    logging: {
      level: 'INFO',
      toConsole: false,
      toFile: false
    }
  }
}));

const mockedReviewStorageManager = ReviewStorageManager as jest.MockedClass<typeof ReviewStorageManager>;

describe('GetReviewHistoryHandler', () => {
  let tool: GetReviewHistoryHandler;
  let mockStorage: jest.Mocked<ReviewStorageManager>;
  
  const mockSessions: ReviewSession[] = [
    {
      review_id: '2024-01-15-003',
      created_at: '2024-01-15T15:00:00Z',
      updated_at: '2024-01-15T15:30:00Z',
      status: 'approved',
      rounds: [
        {
          ...createMockReviewResponse(),
          review_id: '2024-01-15-003',
          round: 1,
          overall_assessment: 'lgtm'
        }
      ],
      request: createMockReviewRequest()
    },
    {
      review_id: '2024-01-15-002',
      created_at: '2024-01-15T12:00:00Z',
      updated_at: '2024-01-15T13:00:00Z',
      status: 'needs_changes',
      rounds: [
        {
          ...createMockReviewResponse(),
          review_id: '2024-01-15-002',
          round: 1,
          overall_assessment: 'needs_changes'
        }
      ],
      request: createMockReviewRequest()
    },
    {
      review_id: '2024-01-15-001',
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T11:00:00Z',
      status: 'approved',
      rounds: [
        {
          ...createMockReviewResponse(),
          review_id: '2024-01-15-001',
          round: 1,
          overall_assessment: 'needs_changes'
        },
        {
          ...createMockReviewResponse(),
          review_id: '2024-01-15-001',
          round: 2,
          overall_assessment: 'lgtm'
        }
      ],
      request: createMockReviewRequest()
    }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(process, 'cwd').mockReturnValue('/test/project');
    
    // Setup storage mock
    mockStorage = {
      createReviewSession: jest.fn(),
      saveReviewResult: jest.fn(),
      saveGitDiff: jest.fn(),
      getReviewSession: jest.fn(),
      getReviewHistory: jest.fn(() => Promise.resolve(mockSessions)),
      markReviewComplete: jest.fn(),
      getLatestReview: jest.fn()
    } as any;
    
    mockedReviewStorageManager.mockImplementation(() => mockStorage);
    
    tool = new GetReviewHistoryHandler();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getToolDefinition', () => {
    it('should return correct tool definition', () => {
      const definition = GetReviewHistoryHandler.getToolDefinition();
      
      expect(definition.name).toBe('get_review_history');
      expect(definition.description).toBe('Get historical reviews for audit/reference');
      expect(definition.inputSchema).not.toHaveProperty('required');
      expect(definition.inputSchema.properties).toHaveProperty('limit');
      expect(definition.inputSchema.properties).toHaveProperty('review_id');
      expect(definition.inputSchema.properties.limit.description).toBe('Number of recent reviews to return (default: 5)');
      expect(definition.inputSchema.properties.review_id.description).toBe('Specific review session to retrieve');
    });
  });

  describe('handle', () => {
    it('should retrieve recent reviews with default limit', async () => {
      const result = await tool.handle({});

      expect(mockStorage.getReviewHistory).toHaveBeenCalledWith(5);
      expect(result).toEqual(mockSessions);
    });

    it('should retrieve recent reviews with custom limit', async () => {
      const result = await tool.handle({ limit: 10 });

      expect(mockStorage.getReviewHistory).toHaveBeenCalledWith(10);
      expect(result).toEqual(mockSessions);
    });

    it('should retrieve specific review by ID', async () => {
      const specificSession = mockSessions[1];
      mockStorage.getReviewSession.mockResolvedValue(specificSession);

      const result = await tool.handle({ review_id: '2024-01-15-002' });

      expect(mockStorage.getReviewSession).toHaveBeenCalledWith('2024-01-15-002');
      expect(mockStorage.getReviewHistory).not.toHaveBeenCalled();
      expect(result).toEqual(specificSession);
    });

    it('should handle empty history', async () => {
      mockStorage.getReviewHistory.mockResolvedValue([]);

      const result = await tool.handle({});

      expect(result).toEqual([]);
    });

    it('should handle limit of 0 correctly', async () => {
      const result = await tool.handle({ limit: 0 });

      // Note: limit of 0 gets defaulted to 5 in the handler
      expect(mockStorage.getReviewHistory).toHaveBeenCalledWith(5);
    });

    it('should handle negative limit by passing it through', async () => {
      const result = await tool.handle({ limit: -1 });

      expect(mockStorage.getReviewHistory).toHaveBeenCalledWith(-1);
    });

    it('should handle non-existent review ID', async () => {
      mockStorage.getReviewSession.mockRejectedValue(
        new Error('Review session non-existent not found')
      );

      await expect(tool.handle({ review_id: 'non-existent' }))
        .rejects.toThrow('Review session non-existent not found');
    });

    it('should handle storage errors', async () => {
      mockStorage.getReviewHistory.mockRejectedValue(
        new Error('Storage error')
      );

      await expect(tool.handle({}))
        .rejects.toThrow('Storage error');
    });

    it('should return complete session information', async () => {
      const result = await tool.handle({ limit: 1 }) as ReviewSession[];

      expect(result).toHaveLength(3); // All mock sessions
      
      const firstSession = result[0];
      expect(firstSession).toHaveProperty('review_id');
      expect(firstSession).toHaveProperty('created_at');
      expect(firstSession).toHaveProperty('updated_at');
      expect(firstSession).toHaveProperty('status');
      expect(firstSession).toHaveProperty('rounds');
      expect(firstSession).toHaveProperty('request');
      expect(firstSession.rounds).toBeInstanceOf(Array);
    });

    // Note: Working directory is not passed as parameter
    // Storage manager uses process.cwd() or config path

    // Storage manager constructor is called without parameters
    // and internally uses process.cwd() or config path

    // Working directory is determined by StorageManager internally

    it('should verify returned data structure for multiple reviews', async () => {
      const result = await tool.handle({ limit: 10 }) as ReviewSession[];

      expect(result).toHaveLength(3);
      
      // Verify sessions are in correct structure
      result.forEach((session: ReviewSession) => {
        expect(session.review_id).toMatch(/^\d{4}-\d{2}-\d{2}-\d{3}$/);
        expect(session.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        expect(session.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        expect(['approved', 'needs_changes', 'in_progress']).toContain(session.status);
        expect(session.rounds.length).toBeGreaterThanOrEqual(1);
        
        // Verify each round has required fields
        session.rounds.forEach((round: ReviewResult) => {
          expect(round).toHaveProperty('review_id');
          expect(round).toHaveProperty('round');
          expect(round).toHaveProperty('overall_assessment');
          expect(round).toHaveProperty('comments');
          expect(round).toHaveProperty('design_compliance');
        });
      });
    });

    it('should verify returned data structure for single review', async () => {
      const specificSession = mockSessions[1];
      mockStorage.getReviewSession.mockResolvedValue(specificSession);

      const result = await tool.handle({ review_id: '2024-01-15-002' }) as ReviewSession;

      // Result should be a single session, not an array
      expect(result).not.toBeInstanceOf(Array);
      expect(result.review_id).toBe('2024-01-15-002');
      expect(result.status).toBe('needs_changes');
      expect(result.rounds).toHaveLength(1);
    });
  });
});