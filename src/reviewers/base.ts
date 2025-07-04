import { ReviewRequest, ReviewResult } from '../types.js';

export interface IReviewer {
  review(request: ReviewRequest, gitDiff: string, previousRounds?: ReviewResult[]): Promise<ReviewResult>;
}