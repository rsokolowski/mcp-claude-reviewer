import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { MarkReviewCompleteHandler } from '../../../src/tools/mark-review-complete';
import { ReviewStorageManager } from '../../../src/storage-manager';
import { ReviewSession } from '../../../src/types';
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

describe('MarkReviewCompleteHandler', () => {
  let tool: MarkReviewCompleteHandler;
  let mockStorage: jest.Mocked<ReviewStorageManager>;
  
  const mockSession: ReviewSession = {
    review_id: '2024-01-15-001',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T11:00:00Z',
    status: 'in_progress',
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
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(process, 'cwd').mockReturnValue('/test/project');
    
    // Setup storage mock
    mockStorage = {
      createReviewSession: jest.fn(),
      saveReviewResult: jest.fn(),
      saveGitDiff: jest.fn(),
      getReviewSession: jest.fn(() => Promise.resolve(mockSession)),
      getReviewHistory: jest.fn(),
      markReviewComplete: jest.fn(() => Promise.resolve(undefined)),
      getLatestReview: jest.fn()
    } as any;
    
    mockedReviewStorageManager.mockImplementation(() => mockStorage);
    
    tool = new MarkReviewCompleteHandler();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getToolDefinition', () => {
    it('should return correct tool definition', () => {
      const definition = MarkReviewCompleteHandler.getToolDefinition();
      
      expect(definition.name).toBe('mark_review_complete');
      expect(definition.description).toBe('Mark a review session as complete with final status');
      expect(definition.inputSchema.required).toEqual(['review_id', 'final_status']);
      expect(definition.inputSchema.properties).toHaveProperty('review_id');
      expect(definition.inputSchema.properties).toHaveProperty('final_status');
      expect(definition.inputSchema.properties).toHaveProperty('notes');
      
      // Check enum values for final_status
      expect(definition.inputSchema.properties.final_status.enum).toEqual([
        'approved',
        'abandoned',
        'merged'
      ]);
    });
  });

  describe('handle', () => {
    it('should mark review as approved with notes', async () => {
      const args = {
        review_id: '2024-01-15-001',
        final_status: 'approved' as const,
        notes: 'All issues resolved, code looks good'
      };

      const result = await tool.handle(args);

      expect(mockStorage.markReviewComplete).toHaveBeenCalledWith(
        '2024-01-15-001',
        'approved',
        'All issues resolved, code looks good'
      );

      expect(result).toEqual({
        success: true,
        message: 'Review 2024-01-15-001 marked as approved'
      });
    });

    it('should mark review as abandoned without notes', async () => {
      const args = {
        review_id: '2024-01-15-001',
        final_status: 'abandoned' as const
      };

      const result = await tool.handle(args);

      expect(mockStorage.markReviewComplete).toHaveBeenCalledWith(
        '2024-01-15-001',
        'abandoned',
        undefined
      );

      expect(result).toEqual({
        success: true,
        message: 'Review 2024-01-15-001 marked as abandoned'
      });
    });

    it('should mark review as merged', async () => {
      const args = {
        review_id: '2024-01-15-001',
        final_status: 'merged' as const,
        notes: 'Merged to main branch'
      };

      const result = await tool.handle(args);

      expect(mockStorage.markReviewComplete).toHaveBeenCalledWith(
        '2024-01-15-001',
        'merged',
        'Merged to main branch'
      );

      expect(result).toEqual({
        success: true,
        message: 'Review 2024-01-15-001 marked as merged'
      });
    });

    it('should handle non-existent review', async () => {
      mockStorage.markReviewComplete.mockRejectedValue(
        new Error('Review session non-existent not found')
      );

      const args = {
        review_id: 'non-existent',
        final_status: 'approved' as const
      };

      await expect(tool.handle(args))
        .rejects.toThrow('Review session non-existent not found');
    });

    it('should handle storage errors', async () => {
      mockStorage.markReviewComplete.mockRejectedValue(
        new Error('Storage write error')
      );

      const args = {
        review_id: '2024-01-15-001',
        final_status: 'approved' as const
      };

      await expect(tool.handle(args))
        .rejects.toThrow('Storage write error');
    });

    it('should handle empty notes string', async () => {
      const args = {
        review_id: '2024-01-15-001',
        final_status: 'approved' as const,
        notes: ''
      };

      const result = await tool.handle(args);

      expect(mockStorage.markReviewComplete).toHaveBeenCalledWith(
        '2024-01-15-001',
        'approved',
        ''
      );

      expect(result.success).toBe(true);
    });

    it('should handle very long notes', async () => {
      const longNotes = 'A'.repeat(10000);
      const args = {
        review_id: '2024-01-15-001',
        final_status: 'approved' as const,
        notes: longNotes
      };

      const result = await tool.handle(args);

      expect(mockStorage.markReviewComplete).toHaveBeenCalledWith(
        '2024-01-15-001',
        'approved',
        longNotes
      );

      expect(result.success).toBe(true);
    });

    // Note: Working directory is not passed as parameter
    // Storage manager uses process.cwd() or config path

    // Storage manager constructor is called without parameters
    // and internally uses process.cwd() or config path

    it('should validate all final status values', async () => {
      const statuses = ['approved', 'abandoned', 'merged'] as const;
      
      for (const status of statuses) {
        jest.clearAllMocks();
        
        const args = {
          review_id: '2024-01-15-001',
          final_status: status
        };

        const result = await tool.handle(args);

        expect(mockStorage.markReviewComplete).toHaveBeenCalledWith(
          '2024-01-15-001',
          status,
          undefined
        );
        
        expect(result.message).toContain(status);
      }
    });

    it('should handle multiline notes', async () => {
      const multilineNotes = `First line of notes
Second line with more details
- Bullet point 1
- Bullet point 2

Final paragraph with conclusion`;

      const args = {
        review_id: '2024-01-15-001',
        final_status: 'approved' as const,
        notes: multilineNotes
      };

      const result = await tool.handle(args);

      expect(mockStorage.markReviewComplete).toHaveBeenCalledWith(
        '2024-01-15-001',
        'approved',
        multilineNotes
      );

      expect(result.success).toBe(true);
    });

    it('should handle special characters in notes', async () => {
      const specialNotes = 'Notes with "quotes" and \'apostrophes\' and \\ backslashes';

      const args = {
        review_id: '2024-01-15-001',
        final_status: 'approved' as const,
        notes: specialNotes
      };

      const result = await tool.handle(args);

      expect(mockStorage.markReviewComplete).toHaveBeenCalledWith(
        '2024-01-15-001',
        'approved',
        specialNotes
      );

      expect(result.success).toBe(true);
    });

    it('should handle review ID with special format', async () => {
      const args = {
        review_id: '2024-12-31-999',
        final_status: 'merged' as const
      };

      const result = await tool.handle(args);

      expect(mockStorage.markReviewComplete).toHaveBeenCalledWith(
        '2024-12-31-999',
        'merged',
        undefined
      );

      expect(result).toEqual({
        success: true,
        message: 'Review 2024-12-31-999 marked as merged'
      });
    });
  });
});