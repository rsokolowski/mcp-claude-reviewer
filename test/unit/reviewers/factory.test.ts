import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ReviewerFactory } from '../../../src/reviewers/factory.js';
import { ClaudeReviewer } from '../../../src/reviewers/claude-reviewer.js';
import { GeminiReviewer } from '../../../src/reviewers/gemini-reviewer.js';
import { MockReviewer } from '../../../src/reviewers/mock-reviewer.js';
import { ReviewerConfig } from '../../../src/reviewers/base.js';

describe('ReviewerFactory', () => {
  describe('create', () => {
    it('should create a Claude reviewer when type is claude', () => {
      const config: ReviewerConfig = {
        type: 'claude',
        cliPath: '/usr/bin/claude',
        model: 'claude-3-opus',
        timeout: 180000
      };
      
      const reviewer = ReviewerFactory.create(config);
      expect(reviewer).toBeInstanceOf(ClaudeReviewer);
    });
    
    it('should create a Gemini reviewer when type is gemini', () => {
      const config: ReviewerConfig = {
        type: 'gemini',
        cliPath: '/usr/bin/gemini',
        model: 'gemini-2.0-flash-exp',
        timeout: 120000,
        apiKey: 'test-api-key'
      };
      
      const reviewer = ReviewerFactory.create(config);
      expect(reviewer).toBeInstanceOf(GeminiReviewer);
    });
    
    it('should create a Mock reviewer when type is mock', () => {
      const config: ReviewerConfig = {
        type: 'mock'
      };
      
      const reviewer = ReviewerFactory.create(config);
      expect(reviewer).toBeInstanceOf(MockReviewer);
    });
    
    it('should throw an error for unknown reviewer type', () => {
      const config = {
        type: 'unknown'
      } as any;
      
      expect(() => ReviewerFactory.create(config)).toThrow('Unknown reviewer type: unknown');
    });
    
    it('should pass logging config to logger', () => {
      const config: ReviewerConfig = {
        type: 'claude'
      };
      const loggingConfig = {
        level: 'DEBUG',
        toFile: true,
        filePath: '/tmp/test.log'
      };
      
      // Create reviewer with logging config
      const reviewer = ReviewerFactory.create(config, loggingConfig);
      expect(reviewer).toBeInstanceOf(ClaudeReviewer);
    });
  });
});