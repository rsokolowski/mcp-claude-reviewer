import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { GitUtils } from '../../src/git-utils';
import simpleGit from 'simple-git';

jest.mock('simple-git');

describe('GitUtils', () => {
  let gitUtils: GitUtils;
  let mockGit: any;

  beforeEach(() => {
    mockGit = {
      status: jest.fn(),
      diff: jest.fn(),
      branch: jest.fn(),
      log: jest.fn(),
    };
    (simpleGit as jest.Mock).mockReturnValue(mockGit);
    gitUtils = new GitUtils('/test/project');
  });

  describe('isGitRepository', () => {
    it('should return true when git status succeeds', async () => {
      mockGit.status.mockResolvedValue({});

      const result = await gitUtils.isGitRepository();

      expect(result).toBe(true);
      expect(mockGit.status).toHaveBeenCalled();
    });

    it('should return false when git status fails', async () => {
      mockGit.status.mockRejectedValue(new Error('Not a git repository'));

      const result = await gitUtils.isGitRepository();

      expect(result).toBe(false);
    });
  });

  describe('getChangedFiles', () => {
    it('should return all changed files without duplicates', async () => {
      mockGit.status.mockResolvedValue({
        staged: ['file1.ts', 'file2.ts'],
        modified: ['file2.ts', 'file3.ts'],
        created: ['file4.ts'],
        renamed: [{ from: 'old.ts', to: 'new.ts' }],
      });

      const result = await gitUtils.getChangedFiles();

      expect(result).toEqual(['file1.ts', 'file2.ts', 'file3.ts', 'file4.ts', 'new.ts']);
      expect(result.length).toBe(5);
    });

    it('should return empty array when no changes', async () => {
      mockGit.status.mockResolvedValue({
        staged: [],
        modified: [],
        created: [],
        renamed: [],
      });

      const result = await gitUtils.getChangedFiles();

      expect(result).toEqual([]);
    });
  });

  describe('getGitDiff', () => {
    it('should return staged diff when staged parameter is true', async () => {
      const stagedDiff = 'staged diff content';
      mockGit.diff.mockResolvedValue(stagedDiff);

      const result = await gitUtils.getGitDiff(true);

      expect(result).toBe(stagedDiff);
      expect(mockGit.diff).toHaveBeenCalledWith(['--cached']);
    });

    it('should return combined diff when both staged and unstaged changes exist', async () => {
      const stagedDiff = 'staged diff';
      const unstagedDiff = 'unstaged diff';
      mockGit.diff
        .mockResolvedValueOnce(stagedDiff)
        .mockResolvedValueOnce(unstagedDiff);

      const result = await gitUtils.getGitDiff(false);

      expect(result).toContain('=== STAGED CHANGES ===');
      expect(result).toContain(stagedDiff);
      expect(result).toContain('=== UNSTAGED CHANGES ===');
      expect(result).toContain(unstagedDiff);
    });

    it('should return only staged diff when no unstaged changes', async () => {
      const stagedDiff = 'staged diff';
      mockGit.diff
        .mockResolvedValueOnce(stagedDiff)
        .mockResolvedValueOnce('');

      const result = await gitUtils.getGitDiff(false);

      expect(result).toBe(stagedDiff);
    });

    it('should return empty string when no changes', async () => {
      mockGit.diff
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('');

      const result = await gitUtils.getGitDiff(false);

      expect(result).toBe('');
    });
  });

  describe('getCurrentBranch', () => {
    it('should return current branch name', async () => {
      mockGit.branch.mockResolvedValue({
        current: 'feature/add-tests',
        all: ['main', 'feature/add-tests'],
      });

      const result = await gitUtils.getCurrentBranch();

      expect(result).toBe('feature/add-tests');
    });
  });

  describe('getRecentCommits', () => {
    it('should return formatted commit messages', async () => {
      mockGit.log.mockResolvedValue({
        all: [
          {
            hash: 'abc1234567890',
            message: 'Add feature X',
            author_name: 'John Doe',
          },
          {
            hash: 'def0987654321',
            message: 'Fix bug Y',
            author_name: 'Jane Smith',
          },
        ],
      });

      const result = await gitUtils.getRecentCommits(2);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe('abc1234 - Add feature X (John Doe)');
      expect(result[1]).toBe('def0987 - Fix bug Y (Jane Smith)');
      expect(mockGit.log).toHaveBeenCalledWith({ maxCount: 2 });
    });

    it('should use default count of 10', async () => {
      mockGit.log.mockResolvedValue({ all: [] });

      await gitUtils.getRecentCommits();

      expect(mockGit.log).toHaveBeenCalledWith({ maxCount: 10 });
    });
  });

  describe('getDiffFromBranch', () => {
    it('should return diff from base branch', async () => {
      const branchDiff = 'diff from main branch';
      mockGit.diff.mockResolvedValue(branchDiff);

      const result = await gitUtils.getDiffFromBranch('main');

      expect(result).toBe(branchDiff);
      expect(mockGit.diff).toHaveBeenCalledWith(['main...HEAD']);
    });

    it('should fall back to regular diff on error', async () => {
      const regularDiff = 'regular diff';
      mockGit.diff
        .mockRejectedValueOnce(new Error('Branch not found'))
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce(regularDiff);

      const result = await gitUtils.getDiffFromBranch('nonexistent');

      expect(result).toBe(regularDiff);
    });
  });

  describe('getFilesChangedFromBranch', () => {
    it('should return files changed from base branch', async () => {
      mockGit.diff.mockResolvedValue('file1.ts\nfile2.ts\nfile3.ts\n');

      const result = await gitUtils.getFilesChangedFromBranch('main');

      expect(result).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
      expect(mockGit.diff).toHaveBeenCalledWith(['main...HEAD', '--name-only']);
    });

    it('should filter out empty lines', async () => {
      mockGit.diff.mockResolvedValue('file1.ts\n\nfile2.ts\n\n');

      const result = await gitUtils.getFilesChangedFromBranch('main');

      expect(result).toEqual(['file1.ts', 'file2.ts']);
    });

    it('should fall back to getChangedFiles on error', async () => {
      mockGit.diff.mockRejectedValue(new Error('Branch not found'));
      mockGit.status.mockResolvedValue({
        staged: ['fallback.ts'],
        modified: [],
        created: [],
        renamed: [],
      });

      const result = await gitUtils.getFilesChangedFromBranch('nonexistent');

      expect(result).toEqual(['fallback.ts']);
    });
  });
});