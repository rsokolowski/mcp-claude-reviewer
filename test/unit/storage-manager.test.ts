import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ReviewStorageManager } from '../../src/storage-manager';
import * as fs from 'fs';
import * as path from 'path';
import { ReviewRequest, ReviewResult, ReviewSession } from '../../src/types';
import { createMockReviewRequest, createMockReviewResponse } from '../utils/mock-factories';

jest.mock('fs');
jest.mock('../../src/config', () => ({
  config: {
    reviewStoragePath: '.reviews',
  },
}));

describe('ReviewStorageManager', () => {
  let storage: ReviewStorageManager;
  const testStorageRoot = '/test/project/.reviews';
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
    // Restore Date if it was mocked
    jest.restoreAllMocks();
    mockFs.existsSync.mockReturnValue(false);
    mockFs.mkdirSync.mockImplementation(() => undefined as any);
    mockFs.writeFileSync.mockImplementation(() => undefined);
    mockFs.readdirSync.mockReturnValue([] as any);
    mockFs.readFileSync.mockImplementation((() => '') as any);
    
    storage = new ReviewStorageManager(testStorageRoot);
  });

  describe('constructor and initialization', () => {
    it('should create storage directory structure', () => {
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        path.join(testStorageRoot, 'sessions'),
        { recursive: true }
      );
    });

    it('should use default storage path when not provided', () => {
      jest.spyOn(process, 'cwd').mockReturnValue('/current/dir');
      new ReviewStorageManager();
      
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        path.join('/current/dir', '.reviews', 'sessions'),
        { recursive: true }
      );
    });
  });

  describe('generateReviewId', () => {
    it('should generate review ID with date and sequential number', async () => {
      const mockDate = new Date('2024-01-15T10:00:00Z');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([]);

      const reviewId = await storage.createReviewSession(createMockReviewRequest());

      expect(reviewId).toBe('2024-01-15-001');
    });

    it('should increment number for multiple reviews on same day', async () => {
      const mockDate = new Date('2024-01-15T10:00:00Z');
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        '2024-01-15-001',
        '2024-01-15-002',
        '2024-01-14-001',
      ] as any);

      const reviewId = await storage.createReviewSession(createMockReviewRequest());

      expect(reviewId).toBe('2024-01-15-003');
    });
  });

  describe('createReviewSession', () => {
    it('should create session directory and save files', async () => {
      const request = createMockReviewRequest();
      const reviewId = await storage.createReviewSession(request);

      const sessionDir = path.join(testStorageRoot, 'sessions', reviewId);
      
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(sessionDir, { recursive: true });
      
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join(sessionDir, 'request.json'),
        JSON.stringify(request, null, 2)
      );

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join(sessionDir, 'session.json'),
        expect.stringContaining('"status": "in_progress"')
      );

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join(testStorageRoot, 'latest.json'),
        expect.stringContaining(reviewId)
      );
    });
  });

  describe('saveReviewResult', () => {
    it('should save review result and update session', async () => {
      const reviewId = '2024-01-15-001';
      const sessionDir = path.join(testStorageRoot, 'sessions', reviewId);
      const mockSession: ReviewSession = {
        review_id: reviewId,
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        status: 'in_progress',
        rounds: [],
        request: createMockReviewRequest(),
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockSession));

      const review: ReviewResult = {
        ...createMockReviewResponse(),
        round: 1,
        status: 'needs_changes' as const,
      };

      await storage.saveReviewResult(reviewId, review);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        path.join(sessionDir, 'round-1'),
        { recursive: true }
      );

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join(sessionDir, 'round-1', 'review.json'),
        JSON.stringify(review, null, 2)
      );

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join(sessionDir, 'session.json'),
        expect.stringContaining('"status": "needs_changes"')
      );
    });

    it('should throw error if session does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(
        storage.saveReviewResult('nonexistent', {} as ReviewResult)
      ).rejects.toThrow('Review session nonexistent not found');
    });
  });

  describe('saveGitDiff', () => {
    it('should save git diff to session directory', async () => {
      const reviewId = '2024-01-15-001';
      const diff = 'diff --git a/file.ts b/file.ts\n+added line';

      await storage.saveGitDiff(reviewId, diff);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join(testStorageRoot, 'sessions', reviewId, 'changes.diff'),
        diff
      );
    });
  });

  describe('getReviewSession', () => {
    it('should read and return session data', async () => {
      const reviewId = '2024-01-15-001';
      const mockSession: ReviewSession = {
        review_id: reviewId,
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        status: 'in_progress',
        rounds: [],
        request: createMockReviewRequest(),
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockSession));

      const result = await storage.getReviewSession(reviewId);

      expect(result).toEqual(mockSession);
      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        path.join(testStorageRoot, 'sessions', reviewId, 'session.json'),
        'utf-8'
      );
    });

    it('should throw error if session does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(
        storage.getReviewSession('nonexistent')
      ).rejects.toThrow('Review session nonexistent not found');
    });
  });

  describe('getReviewHistory', () => {
    it('should return sorted review sessions', async () => {
      const sessions: ReviewSession[] = [
        {
          review_id: '2024-01-15-001',
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T10:00:00Z',
          status: 'approved',
          rounds: [],
          request: createMockReviewRequest(),
        },
        {
          review_id: '2024-01-16-001',
          created_at: '2024-01-16T10:00:00Z',
          updated_at: '2024-01-16T10:00:00Z',
          status: 'in_progress',
          rounds: [],
          request: createMockReviewRequest(),
        },
      ];

      mockFs.existsSync.mockImplementation((path) => {
        const pathStr = path as string;
        // Return true for session.json checks
        if (pathStr.includes('session.json')) return true;
        // Return true for directories
        return true;
      });
      mockFs.readdirSync.mockReturnValue(['2024-01-15-001', '2024-01-16-001'] as any);
      // Mock readdir returns files in order, but our test needs to simulate
      // that they can be read in any order and sorted by created_at
      mockFs.readFileSync.mockImplementation(((path: any, options: any) => {
        const pathStr = path as string;
        if (pathStr.includes('2024-01-15-001')) {
          return JSON.stringify(sessions[0]);
        } else if (pathStr.includes('2024-01-16-001')) {
          return JSON.stringify(sessions[1]);
        }
        return '';
      }) as any);

      const result = await storage.getReviewHistory(5);

      expect(result).toHaveLength(2);
      expect(result[0].review_id).toBe('2024-01-16-001');
      expect(result[1].review_id).toBe('2024-01-15-001');
    });

    it('should return empty array if no sessions exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = await storage.getReviewHistory();

      expect(result).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      const sessionIds = Array.from({ length: 10 }, (_, i) => 
        `2024-01-${String(i + 1).padStart(2, '0')}-001`
      );

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(sessionIds as any);
      
      sessionIds.forEach((id, index) => {
        mockFs.readFileSync.mockReturnValueOnce(JSON.stringify({
          review_id: id,
          created_at: `2024-01-${String(index + 1).padStart(2, '0')}T10:00:00Z`,
          updated_at: `2024-01-${String(index + 1).padStart(2, '0')}T10:00:00Z`,
          status: 'approved',
          rounds: [],
          request: createMockReviewRequest(),
        }));
      });

      const result = await storage.getReviewHistory(3);

      expect(result).toHaveLength(3);
    });
  });

  describe('markReviewComplete', () => {
    it('should update session status and save notes', async () => {
      const reviewId = '2024-01-15-001';
      const mockSession: ReviewSession = {
        review_id: reviewId,
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        status: 'in_progress',
        rounds: [],
        request: createMockReviewRequest(),
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockSession));

      await storage.markReviewComplete(reviewId, 'approved', 'All issues resolved');

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join(testStorageRoot, 'sessions', reviewId, 'session.json'),
        expect.stringContaining('"status": "approved"')
      );

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        path.join(testStorageRoot, 'sessions', reviewId, 'final-notes.txt'),
        'All issues resolved'
      );
    });

    it('should work without notes', async () => {
      const reviewId = '2024-01-15-001';
      const mockSession: ReviewSession = {
        review_id: reviewId,
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        status: 'in_progress',
        rounds: [],
        request: createMockReviewRequest(),
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockSession));

      await storage.markReviewComplete(reviewId, 'abandoned');

      const writeFileCalls = (mockFs.writeFileSync as jest.Mock).mock.calls;
      const notesCall = writeFileCalls.find(call => 
        (call[0] as string).includes('final-notes.txt')
      );
      
      expect(notesCall).toBeUndefined();
    });
  });

  describe('getLatestReview', () => {
    it('should return latest review ID', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ review_id: '2024-01-15-003' }));

      const result = await storage.getLatestReview();

      expect(result).toBe('2024-01-15-003');
    });

    it('should return null if no latest pointer exists', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = await storage.getLatestReview();

      expect(result).toBeNull();
    });
  });
});