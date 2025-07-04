import { ReviewStorageManager } from '../storage-manager.js';
import { ReviewSession } from '../types.js';

export class GetReviewHistoryHandler {
  private storage: ReviewStorageManager;
  
  constructor() {
    this.storage = new ReviewStorageManager();
  }
  
  async handle(params: { limit?: number; review_id?: string }): Promise<ReviewSession[] | ReviewSession> {
    if (params.review_id) {
      // Get specific review
      return await this.storage.getReviewSession(params.review_id);
    }
    
    // Get review history
    const limit = params.limit || 5;
    return await this.storage.getReviewHistory(limit);
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