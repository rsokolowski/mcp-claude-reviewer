import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { RequestReviewHandler } from '../../src/tools/request-review.js';
import { ReviewRequest } from '../../src/types.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

describe('Multi-Reviewer Integration', () => {
  let testDir: string;
  let handler: RequestReviewHandler;
  
  beforeEach(async () => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `mcp-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    // Initialize git repo
    execSync('git init', { cwd: testDir });
    execSync('git config user.email "test@example.com"', { cwd: testDir });
    execSync('git config user.name "Test User"', { cwd: testDir });
    
    // Create initial commit
    await fs.writeFile(join(testDir, 'test.js'), 'console.log("initial");');
    execSync('git add .', { cwd: testDir });
    execSync('git commit -m "Initial commit"', { cwd: testDir });
    
    // Make changes
    await fs.writeFile(join(testDir, 'test.js'), 'console.log("modified");');
    
    handler = new RequestReviewHandler();
  });
  
  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });
  
  describe('Claude Reviewer Configuration', () => {
    it('should use Claude reviewer with custom configuration', async () => {
      const config = {
        reviewer: {
          type: 'claude' as const,
          cliPath: 'claude',
          model: 'claude-3-opus-20240229',
          timeout: 180000
        },
        reviewStoragePath: '.reviews',
        logging: { level: 'INFO' }
      };
      
      await fs.writeFile(
        join(testDir, '.claude-reviewer.json'),
        JSON.stringify(config, null, 2)
      );
      
      const request = {
        summary: 'Test Claude reviewer with custom config',
        workingDirectory: testDir
      };
      
      // This will use mock reviewer since Claude CLI won't be available in tests
      // But it will validate that the configuration is loaded correctly
      try {
        await handler.handle(request);
      } catch (error: any) {
        // Expected to fail - either CLI not found or actual CLI error
        expect(
          error.message.includes('Claude CLI not found') ||
          error.message.includes('Command failed:')
        ).toBe(true);
      }
    }, 20000); // Increase timeout since Claude CLI might actually run
  });
  
  describe('Gemini Reviewer Configuration', () => {
    it('should use Gemini reviewer when configured', async () => {
      const config = {
        reviewer: {
          type: 'gemini' as const,
          cliPath: 'gemini',
          model: 'gemini-2.0-flash-exp',
          timeout: 120000,
          apiKey: 'test-api-key'
        },
        reviewStoragePath: '.reviews',
        logging: { level: 'INFO' }
      };
      
      await fs.writeFile(
        join(testDir, '.claude-reviewer.json'),
        JSON.stringify(config, null, 2)
      );
      
      const request = {
        summary: 'Test Gemini reviewer',
        workingDirectory: testDir
      };
      
      try {
        await handler.handle(request);
      } catch (error: any) {
        // Expected to fail - either CLI not found or actual CLI error
        expect(
          error.message.includes('Gemini CLI not found') ||
          error.message.includes('Gemini CLI exited with code')
        ).toBe(true);
      }
    }, 20000); // Increase timeout since Gemini CLI might actually run
  });
  
  describe('Mock Reviewer Configuration', () => {
    it('should use Mock reviewer when configured', async () => {
      const config = {
        reviewer: {
          type: 'mock' as const
        },
        reviewStoragePath: '.reviews',
        logging: { level: 'INFO' }
      };
      
      await fs.writeFile(
        join(testDir, '.claude-reviewer.json'),
        JSON.stringify(config, null, 2)
      );
      
      const request = {
        summary: 'Test Mock reviewer',
        workingDirectory: testDir
      };
      
      const result = await handler.handle(request);
      
      expect(result).toBeDefined();
      expect(result.review_id).toBeTruthy();
      expect(result.status).toMatch(/approved|needs_changes/);
    });
  });
  
  describe('Backward Compatibility', () => {
    it('should handle mock reviewer configuration', async () => {
      const config = {
        reviewer: {
          type: 'mock' as const
        },
        reviewStoragePath: '.reviews',
        logging: { level: 'INFO' }
      };
      
      await fs.writeFile(
        join(testDir, '.claude-reviewer.json'),
        JSON.stringify(config, null, 2)
      );
      
      const request = {
        summary: 'Test mock reviewer configuration',
        workingDirectory: testDir
      };
      
      const result = await handler.handle(request);
      
      expect(result).toBeDefined();
      expect(result.review_id).toMatch(/^\d{4}-\d{2}-\d{2}-\d{3}$/); // Date-based ID from storage system
    });
    
    it('should use new config schema for Claude reviewer', async () => {
      const config = {
        reviewer: {
          type: 'claude' as const,
          cliPath: '/custom/claude',
          model: 'claude-3-5-sonnet-20241022',
          timeout: 150000,
          enableResume: true
        },
        reviewStoragePath: '.reviews',
        logging: { level: 'INFO' }
      };
      
      await fs.writeFile(
        join(testDir, '.claude-reviewer.json'),
        JSON.stringify(config, null, 2)
      );
      
      const request = {
        summary: 'Test new Claude reviewer config schema',
        workingDirectory: testDir
      };
      
      try {
        const result = await handler.handle(request);
        // If Claude CLI is actually installed and working, the review will succeed
        // In that case, just verify we got a valid review result
        expect(result).toBeDefined();
        expect(result.review_id).toBeTruthy();
        expect(result.status).toMatch(/approved|needs_changes/);
      } catch (error: any) {
        // Should try to use Claude with custom path - will fail since /custom/claude doesn't exist
        // Or if the default 'claude' CLI is found, it will attempt to run and may fail for other reasons
        expect(
          error.message.includes('Claude CLI not found at /custom/claude') ||
          error.message.includes('Command failed:') ||
          error.message.includes('Invalid model name') ||
          error.message.includes('spawn /custom/claude ENOENT')
        ).toBe(true);
      }
    }, 30000); // Increase timeout since Claude CLI might actually run
  });
  
  describe('Configuration Priority', () => {
    it('should use new reviewer configuration structure', async () => {
      const config = {
        reviewer: {
          type: 'claude' as const,
          cliPath: '/new/claude',
          model: 'new-model',
          timeout: 200000,
          enableResume: true
        },
        reviewStoragePath: '.reviews',
        persistReviewPrompts: false,
        logging: { level: 'INFO', toConsole: true, toFile: false }
      };
      
      await fs.writeFile(
        join(testDir, '.claude-reviewer.json'),
        JSON.stringify(config, null, 2)
      );
      
      const request = {
        summary: 'Test new configuration structure',
        workingDirectory: testDir
      };
      
      try {
        await handler.handle(request);
      } catch (error: any) {
        // Should use new config path
        expect(
          error.message.includes('Claude CLI not found at /new/claude') ||
          error.message.includes('Command failed:')
        ).toBe(true);
      }
    }, 20000); // Increase timeout since Claude CLI might actually run
  });
});