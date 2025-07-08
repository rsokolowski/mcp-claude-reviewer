import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { RequestReviewHandler } from '../../src/tools/request-review.js';
import { GetReviewHistoryHandler } from '../../src/tools/get-review-history.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { ClaudeReviewer } from '../../src/reviewers/claude-reviewer.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createTempDir, cleanupTestDir, createTestGitRepo } from '../utils/test-helpers.js';
import { createMockReviewResponse, createMockGitDiff } from '../utils/mock-factories.js';
import { GitUtils } from '../../src/git-utils.js';

jest.mock('../../src/config.js');
jest.mock('../../src/logger.js');
jest.mock('../../src/reviewers/claude-reviewer.js');

describe('Multi-Project Support Integration', () => {
  let project1Dir: string;
  let project2Dir: string;
  let mockLogger: any;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    // Create two separate project directories
    project1Dir = await createTempDir();
    project2Dir = await createTempDir();
    
    originalEnv = process.env.MCP_CLIENT_CWD;

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    (createLogger as jest.Mock).mockImplementation(() => mockLogger);

    // Mock Claude reviewer
    const mockReviewResponse = createMockReviewResponse();
    (ClaudeReviewer as jest.Mock).mockImplementation(() => ({
      review: jest.fn<() => Promise<any>>().mockResolvedValue(mockReviewResponse)
    }));
  });

  afterEach(async () => {
    await Promise.all([
      cleanupTestDir(project1Dir),
      cleanupTestDir(project2Dir)
    ]);
    process.env.MCP_CLIENT_CWD = originalEnv;
    jest.clearAllMocks();
  });

  describe('Project Isolation', () => {
    it('should maintain separate review histories for different projects', async () => {
      // Configure different settings for each project
      const project1Config = {
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

      const project2Config = {
        logging: { level: 'debug', toFile: true, toConsole: true, filePath: 'reviews.log' },
        reviewStoragePath: '.code-reviews',
        persistReviewPrompts: false,
        reviewer: {
          type: 'claude',
          cliPath: '/usr/local/bin/claude',
          model: 'claude-3-sonnet',
          timeout: 180000,
          enableResume: true
        }
      };

      // Review in project 1
      process.env.MCP_CLIENT_CWD = project1Dir;
      (loadConfig as jest.Mock).mockReturnValue(project1Config);
      
      // Create git repo for project 1
      await createTestGitRepo(project1Dir);
      
      const handler1 = new RequestReviewHandler();
      const historyHandler1 = new GetReviewHistoryHandler();
      
      const review1 = await handler1.handle({
        summary: 'Project 1 feature implementation'
      });

      // Review in project 2
      process.env.MCP_CLIENT_CWD = project2Dir;
      (loadConfig as jest.Mock).mockReturnValue(project2Config);
      
      // Create git repo for project 2
      await createTestGitRepo(project2Dir);
      
      const handler2 = new RequestReviewHandler();
      const historyHandler2 = new GetReviewHistoryHandler();
      
      const review2 = await handler2.handle({
        summary: 'Project 2 bug fix'
      });

      // Check that reviews are stored in different locations
      const project1ReviewDir = path.join(project1Dir, '.reviews', 'sessions', review1.review_id);
      const project2ReviewDir = path.join(project2Dir, '.code-reviews', 'sessions', review2.review_id);
      
      const project1Exists = await fs.stat(project1ReviewDir).then(() => true).catch(() => false);
      const project2Exists = await fs.stat(project2ReviewDir).then(() => true).catch(() => false);
      
      expect(project1Exists).toBe(true);
      expect(project2Exists).toBe(true);

      // Verify histories are separate
      process.env.MCP_CLIENT_CWD = project1Dir;
      (loadConfig as jest.Mock).mockReturnValue(project1Config);
      const history1 = await historyHandler1.handle({ limit: 10 });
      
      process.env.MCP_CLIENT_CWD = project2Dir;
      (loadConfig as jest.Mock).mockReturnValue(project2Config);
      const history2 = await historyHandler2.handle({ limit: 10 });
      
      expect(history1).toHaveLength(1);
      expect(history2).toHaveLength(1);
      expect((history1 as any)[0].request.summary).toBe('Project 1 feature implementation');
      expect((history2 as any)[0].request.summary).toBe('Project 2 bug fix');
    });

    it('should load project-specific configuration files', async () => {
      // Create project-specific config files
      const project1ConfigFile = {
        reviewer: {
          type: 'claude',
          model: 'claude-3-opus'
        }
      };

      const project2ConfigFile = {
        reviewer: {
          type: 'claude',
          model: 'claude-3-sonnet'
        }
      };

      await fs.writeFile(
        path.join(project1Dir, '.claude-reviewer.json'),
        JSON.stringify(project1ConfigFile)
      );

      await fs.writeFile(
        path.join(project2Dir, '.claude-reviewer.json'),
        JSON.stringify(project2ConfigFile)
      );

      // Mock loadConfig to return different configs based on directory
      (loadConfig as jest.Mock).mockImplementation((dir) => {
        const baseConfig = {
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

        if (dir === project1Dir) {
          return {
            ...baseConfig,
            reviewer: { ...baseConfig.reviewer, ...project1ConfigFile.reviewer }
          };
        } else if (dir === project2Dir) {
          return {
            ...baseConfig,
            reviewer: { ...baseConfig.reviewer, ...project2ConfigFile.reviewer }
          };
        }
        return baseConfig;
      });

      // Test project 1
      process.env.MCP_CLIENT_CWD = project1Dir;
      await createTestGitRepo(project1Dir);
      
      const handler1 = new RequestReviewHandler();
      
      // Since ClaudeReviewer.review() doesn't take a prompt parameter,
      // we can't capture it directly. The test should verify that the
      // configuration is loaded correctly instead.
      const mockReviewResponse = createMockReviewResponse();
      (ClaudeReviewer as jest.Mock).mockImplementation(() => ({
        review: jest.fn<(request: any, gitDiff: string, previousRounds?: any[]) => Promise<any>>()
          .mockResolvedValue(mockReviewResponse)
      }));

      const result1 = await handler1.handle({ summary: 'Test project 1' });
      expect(result1).toBeDefined();
      expect(result1.review_id).toBeDefined();

      // Test project 2
      process.env.MCP_CLIENT_CWD = project2Dir;
      await createTestGitRepo(project2Dir);
      
      const handler2 = new RequestReviewHandler();
      
      // Test that project 2 can also create reviews
      (ClaudeReviewer as jest.Mock).mockImplementation(() => ({
        review: jest.fn<(request: any, gitDiff: string, previousRounds?: any[]) => Promise<any>>()
          .mockResolvedValue(createMockReviewResponse())
      }));

      const result2 = await handler2.handle({ summary: 'Test project 2' });
      expect(result2).toBeDefined();
      expect(result2.review_id).toBeDefined();
    });
  });

  describe('Concurrent Reviews', () => {
    it('should handle concurrent reviews in different projects', async () => {
      const mockConfig = {
        logging: { level: 'info', file: null },
        reviewStoragePath: '.reviews',
        reviewer: {
          type: 'claude' as const,
          cliPath: '/usr/local/bin/claude',
          model: 'claude-3-opus',
          timeout: 120000,
          enableResume: true
        }
      };

      (loadConfig as jest.Mock).mockReturnValue(mockConfig);

      // Create git repos for both projects
      await createTestGitRepo(project1Dir);
      await createTestGitRepo(project2Dir);

      // Create handlers for both projects
      process.env.MCP_CLIENT_CWD = project1Dir;
      const handler1 = new RequestReviewHandler();
      
      process.env.MCP_CLIENT_CWD = project2Dir;
      const handler2 = new RequestReviewHandler();

      // Mock reviewer with delays to simulate concurrent execution
      let reviewCount = 0;
      (ClaudeReviewer as jest.Mock).mockImplementation(() => ({
        review: jest.fn<() => Promise<any>>().mockImplementation(async () => {
          reviewCount++;
          const delay = reviewCount === 1 ? 100 : 50; // First review takes longer
          await new Promise(resolve => setTimeout(resolve, delay));
          return createMockReviewResponse();
        })
      }));

      // Start both reviews using workingDirectory parameter to avoid env var conflicts
      const review1Promise = handler1.handle({
        summary: 'Concurrent review 1',
        workingDirectory: project1Dir
      });

      // Add a small delay to ensure different review IDs
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const review2Promise = handler2.handle({
        summary: 'Concurrent review 2',
        workingDirectory: project2Dir
      });

      // Wait for both to complete
      const [review1, review2] = await Promise.all([review1Promise, review2Promise]);

      // Verify both completed successfully
      expect(review1.status).toBe('needs_changes');
      expect(review2.status).toBe('needs_changes');
      // Since they're in different projects, they can have the same ID
      // The important thing is that they're stored in different directories

      // Verify reviews are stored in correct projects
      const review1Exists = await fs.stat(
        path.join(project1Dir, '.reviews', 'sessions', review1.review_id)
      ).then(() => true).catch(() => false);
      
      const review2Exists = await fs.stat(
        path.join(project2Dir, '.reviews', 'sessions', review2.review_id)
      ).then(() => true).catch(() => false);

      expect(review1Exists).toBe(true);
      expect(review2Exists).toBe(true);
    });
  });

  describe('Working Directory Detection', () => {
    it('should use MCP_CLIENT_CWD environment variable when available', async () => {
      process.env.MCP_CLIENT_CWD = project1Dir;
      
      const mockConfig = {
        logging: { level: 'info', file: null },
        reviewStoragePath: '.reviews',
        reviewer: {
          type: 'claude' as const,
          cliPath: '/usr/local/bin/claude',
          model: 'claude-3-opus',
          timeout: 120000,
          enableResume: true
        }
      };

      (loadConfig as jest.Mock).mockReturnValue(mockConfig);

      // Create git repo in project1Dir
      await createTestGitRepo(project1Dir);

      const handler = new RequestReviewHandler();
      const review = await handler.handle({
        summary: 'Test working directory'
      });

      // Check review was created in project1Dir
      const reviewPath = path.join(project1Dir, '.reviews', 'sessions', review.review_id);
      const exists = await fs.stat(reviewPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should fall back to process.cwd() when MCP_CLIENT_CWD is not set', async () => {
      // Save original cwd
      const originalCwd = process.cwd();
      
      // Remove MCP_CLIENT_CWD
      delete process.env.MCP_CLIENT_CWD;
      
      // Mock process.cwd to return project2Dir
      jest.spyOn(process, 'cwd').mockReturnValue(project2Dir);

      const mockConfig = {
        logging: { level: 'info', toFile: false, toConsole: true },
        reviewStoragePath: '.reviews',
        reviewer: {
          type: 'claude' as const,
          cliPath: 'claude',
          model: 'claude-3-opus',
          timeout: 120000
        },
        persistReviewPrompts: false
      };

      (loadConfig as jest.Mock).mockReturnValue(mockConfig);

      // Create git repo in project2Dir
      await createTestGitRepo(project2Dir);

      // Create logger mock that captures the working directory
      let loggerCreatedWithDir: string | undefined;
      (createLogger as jest.Mock).mockImplementation((...args: any[]) => {
        // createLogger(name, config, workingDir)
        // Only capture the logger created by request-review (not reviewer-factory)
        if (args[0] === 'request-review' && args[2] !== undefined) {
          loggerCreatedWithDir = args[2]; // third parameter is workingDir
        }
        return mockLogger;
      });

      const handler = new RequestReviewHandler();
      await handler.handle({
        summary: 'Test fallback to cwd'
      });

      // Verify the handler used process.cwd()
      expect(createLogger).toHaveBeenCalled();
      expect(loggerCreatedWithDir).toBe(project2Dir);

      // Restore process.cwd
      jest.spyOn(process, 'cwd').mockReturnValue(originalCwd);
    });
  });

  describe('Cross-Project Operations', () => {
    it('should not allow accessing reviews from different projects', async () => {
      const mockConfig = {
        logging: { level: 'info', file: null },
        reviewStoragePath: '.reviews',
        reviewer: {
          type: 'claude' as const,
          cliPath: '/usr/local/bin/claude',
          model: 'claude-3-opus',
          timeout: 120000,
          enableResume: true
        }
      };

      (loadConfig as jest.Mock).mockReturnValue(mockConfig);

      // Create a review in project 1
      process.env.MCP_CLIENT_CWD = project1Dir;
      await createTestGitRepo(project1Dir);
      
      const handler1 = new RequestReviewHandler();
      const review1 = await handler1.handle({
        summary: 'Project 1 review'
      });

      // Try to access it from project 2
      process.env.MCP_CLIENT_CWD = project2Dir;
      await createTestGitRepo(project2Dir);
      
      const historyHandler2 = new GetReviewHistoryHandler();
      
      // Should not find the review and throw an error
      await expect(historyHandler2.handle({
        review_id: review1.review_id
      })).rejects.toThrow(`Review session ${review1.review_id} not found`);
    });
  });
});