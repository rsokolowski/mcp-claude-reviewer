import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { ReviewRequest, ReviewResult, ReviewSession } from './types.js';
import { config } from './config.js';

export class ReviewStorageManager {
  private storageRoot: string;
  
  constructor(storageRoot?: string) {
    this.storageRoot = storageRoot || join(process.cwd(), config.reviewStoragePath);
    this.ensureStorageStructure();
  }
  
  private ensureStorageStructure(): void {
    mkdirSync(join(this.storageRoot, 'sessions'), { recursive: true });
  }
  
  private generateReviewId(): string {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    
    // Find the next available number for today
    const sessionsDir = join(this.storageRoot, 'sessions');
    const existingDirs = existsSync(sessionsDir) 
      ? readdirSync(sessionsDir).filter(d => d.startsWith(dateStr))
      : [];
    
    const nextNum = existingDirs.length + 1;
    return `${dateStr}-${String(nextNum).padStart(3, '0')}`;
  }
  
  async createReviewSession(request: ReviewRequest): Promise<string> {
    const reviewId = this.generateReviewId();
    const sessionDir = join(this.storageRoot, 'sessions', reviewId);
    mkdirSync(sessionDir, { recursive: true });
    
    const session: ReviewSession = {
      review_id: reviewId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'in_progress',
      rounds: [],
      request
    };
    
    // Save initial request
    writeFileSync(
      join(sessionDir, 'request.json'),
      JSON.stringify(request, null, 2)
    );
    
    // Save session metadata
    writeFileSync(
      join(sessionDir, 'session.json'),
      JSON.stringify(session, null, 2)
    );
    
    // Update latest pointer
    this.updateLatestPointer(reviewId);
    
    return reviewId;
  }
  
  async saveReviewResult(reviewId: string, review: ReviewResult): Promise<void> {
    const sessionDir = join(this.storageRoot, 'sessions', reviewId);
    if (!existsSync(sessionDir)) {
      throw new Error(`Review session ${reviewId} not found`);
    }
    
    const roundDir = join(sessionDir, `round-${review.round}`);
    mkdirSync(roundDir, { recursive: true });
    
    // Save review result
    writeFileSync(
      join(roundDir, 'review.json'),
      JSON.stringify(review, null, 2)
    );
    
    // Update session metadata
    const sessionPath = join(sessionDir, 'session.json');
    const session: ReviewSession = JSON.parse(readFileSync(sessionPath, 'utf-8'));
    session.rounds.push(review);
    session.updated_at = new Date().toISOString();
    session.status = review.status;
    
    writeFileSync(sessionPath, JSON.stringify(session, null, 2));
    
    // Update latest pointer
    this.updateLatestPointer(reviewId);
  }
  
  async saveGitDiff(reviewId: string, diff: string): Promise<void> {
    const sessionDir = join(this.storageRoot, 'sessions', reviewId);
    writeFileSync(join(sessionDir, 'changes.diff'), diff);
  }
  
  async getReviewSession(reviewId: string): Promise<ReviewSession> {
    const sessionPath = join(this.storageRoot, 'sessions', reviewId, 'session.json');
    if (!existsSync(sessionPath)) {
      throw new Error(`Review session ${reviewId} not found`);
    }
    
    return JSON.parse(readFileSync(sessionPath, 'utf-8'));
  }
  
  async getReviewHistory(limit: number = 5): Promise<ReviewSession[]> {
    const sessionsDir = join(this.storageRoot, 'sessions');
    if (!existsSync(sessionsDir)) {
      return [];
    }
    
    const sessions = readdirSync(sessionsDir)
      .filter(d => existsSync(join(sessionsDir, d, 'session.json')))
      .map(d => {
        const sessionPath = join(sessionsDir, d, 'session.json');
        return JSON.parse(readFileSync(sessionPath, 'utf-8')) as ReviewSession;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
    
    return sessions;
  }
  
  async markReviewComplete(
    reviewId: string, 
    finalStatus: 'approved' | 'abandoned' | 'merged',
    notes?: string
  ): Promise<void> {
    const session = await this.getReviewSession(reviewId);
    session.status = finalStatus;
    session.updated_at = new Date().toISOString();
    
    const sessionPath = join(this.storageRoot, 'sessions', reviewId, 'session.json');
    writeFileSync(sessionPath, JSON.stringify(session, null, 2));
    
    if (notes) {
      const notesPath = join(this.storageRoot, 'sessions', reviewId, 'final-notes.txt');
      writeFileSync(notesPath, notes);
    }
  }
  
  private updateLatestPointer(reviewId: string): void {
    const latestPath = join(this.storageRoot, 'latest.json');
    writeFileSync(latestPath, JSON.stringify({ review_id: reviewId }, null, 2));
  }
  
  async getLatestReview(): Promise<string | null> {
    const latestPath = join(this.storageRoot, 'latest.json');
    if (!existsSync(latestPath)) {
      return null;
    }
    
    const latest = JSON.parse(readFileSync(latestPath, 'utf-8'));
    return latest.review_id;
  }
}