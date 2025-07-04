import { ReviewStorageManager } from '../storage-manager.js';

export class MarkReviewCompleteHandler {
  private storage: ReviewStorageManager;
  
  constructor() {
    this.storage = new ReviewStorageManager();
  }
  
  async handle(params: {
    review_id: string;
    final_status: 'approved' | 'abandoned' | 'merged';
    notes?: string;
  }): Promise<{ success: boolean; message: string }> {
    await this.storage.markReviewComplete(
      params.review_id,
      params.final_status,
      params.notes
    );
    
    return {
      success: true,
      message: `Review ${params.review_id} marked as ${params.final_status}`
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