import { ReviewStorageManager } from '../storage-manager.js';
import { ReviewSession } from '../types.js';
import { loadConfig } from '../config.js';
import { join } from 'path';

export class GetReviewHistoryHandler {
  // Storage manager will be created per-request with the correct working directory
  
  constructor() {
    // No longer create storage manager here
  }
  
  private detectWorkingDirectory(providedDir?: string): string {
    // Use same logic as RequestReviewHandler
    if (providedDir) {
      return providedDir;
    }
    if (process.env.MCP_CLIENT_CWD) {
      return process.env.MCP_CLIENT_CWD;
    }
    return process.cwd();
  }
  
  async handle(params: { limit?: number; review_id?: string; workingDirectory?: string }): Promise<ReviewSession[] | ReviewSession> {
    // Determine the working directory
    const workingDir = this.detectWorkingDirectory(params.workingDirectory);
    
    // Load config from the working directory
    const config = loadConfig(workingDir);
    
    // Create storage manager with the correct working directory
    const storage = new ReviewStorageManager(join(workingDir, config.reviewStoragePath));
    
    if (params.review_id) {
      // Get specific review
      return await storage.getReviewSession(params.review_id);
    }
    
    // Get review history
    const limit = params.limit || 5;
    return await storage.getReviewHistory(limit);
  }
  
  static getToolDefinition() {
    return {
      name: 'get_review_history',
      description: 'Get historical reviews for audit/reference',
      inputSchema: {
        type: 'object' as const,
        properties: {
          limit: {
            type: 'number',
            description: 'Number of recent reviews to return (default: 5)'
          },
          review_id: {
            type: 'string',
            description: 'Specific review session to retrieve'
          }
        }
      }
    };
  }
}