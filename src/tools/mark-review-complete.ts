import { ReviewStorageManager } from '../storage-manager.js';
import { loadConfig } from '../config.js';
import { join } from 'path';

export class MarkReviewCompleteHandler {
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
  
  async handle(params: {
    review_id: string;
    final_status: 'approved' | 'abandoned' | 'merged';
    notes?: string;
    workingDirectory?: string;
  }): Promise<{ success: boolean; message: string; review_id: string; final_status: string }> {
    // Determine the working directory
    const workingDir = this.detectWorkingDirectory(params.workingDirectory);
    
    // Load config from the working directory
    const config = loadConfig(workingDir);
    
    // Create storage manager with the correct working directory
    const storage = new ReviewStorageManager(join(workingDir, config.reviewStoragePath));
    
    await storage.markReviewComplete(
      params.review_id,
      params.final_status,
      params.notes
    );
    
    return {
      success: true,
      message: `Review ${params.review_id} marked as ${params.final_status}`,
      review_id: params.review_id,
      final_status: params.final_status
    };
  }
  
  static getToolDefinition() {
    return {
      name: 'mark_review_complete',
      description: 'Mark a review session as complete with final status',
      inputSchema: {
        type: 'object' as const,
        properties: {
          review_id: {
            type: 'string',
            description: 'Review session ID'
          },
          final_status: {
            type: 'string',
            enum: ['approved', 'abandoned', 'merged'],
            description: 'Final status of the review'
          },
          notes: {
            type: 'string',
            description: 'Final notes or summary'
          }
        },
        required: ['review_id', 'final_status']
      }
    };
  }
}