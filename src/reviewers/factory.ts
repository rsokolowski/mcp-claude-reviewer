import { IReviewer, ReviewerConfig } from './base.js';
import { ClaudeReviewer } from './claude-reviewer.js';
import { MockReviewer } from './mock-reviewer.js';
import { GeminiReviewer } from './gemini-reviewer.js';
import { createLogger } from '../logger.js';

export class ReviewerFactory {
  static create(config: ReviewerConfig, loggingConfig?: any): IReviewer {
    const logger = createLogger('reviewer-factory', loggingConfig);
    
    logger.info(`Creating reviewer of type: ${config.type}`);
    
    switch (config.type) {
      case 'claude':
        return new ClaudeReviewer(config);
        
      case 'gemini':
        return new GeminiReviewer(config);
        
      case 'mock':
        return new MockReviewer(config);
        
      default:
        throw new Error(`Unknown reviewer type: ${config.type}`);
    }
  }
}