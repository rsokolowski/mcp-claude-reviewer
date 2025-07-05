import { ReviewRequest, ReviewResult, ReviewSummary } from '../types.js';

export interface IReviewer {
  review(request: ReviewRequest, gitDiff: string, previousRounds?: ReviewResult[]): Promise<ReviewResult>;
}

export interface ReviewerConfig {
  type: 'claude' | 'gemini' | 'mock';
  cliPath?: string;
  model?: string | null;
  timeout?: number;
  apiKey?: string;
  [key: string]: any;
}

export abstract class BaseReviewer implements IReviewer {
  protected config: ReviewerConfig;
  
  constructor(config: ReviewerConfig) {
    this.config = config;
  }
  
  abstract review(
    request: ReviewRequest, 
    gitDiff: string, 
    previousRounds?: ReviewResult[]
  ): Promise<ReviewResult>;
  
  protected calculateSummary(review: ReviewResult): ReviewSummary {
    const summary: ReviewSummary = {
      design_violations: review.design_compliance.major_violations.length,
      critical_issues: 0,
      major_issues: 0,
      minor_issues: 0,
      suggestions: 0
    };
    
    for (const comment of review.comments) {
      switch (comment.severity) {
        case 'critical':
          summary.critical_issues++;
          break;
        case 'major':
          summary.major_issues++;
          break;
        case 'minor':
          summary.minor_issues++;
          break;
        case 'suggestion':
          summary.suggestions++;
          break;
      }
    }
    
    return summary;
  }
  
  protected validateTestCommand(command: string): string | null {
    const allowedPatterns = [
      /^npm\s+(test|run\s+test(:[a-zA-Z0-9_-]+)?)$/,
      /^yarn\s+(test|run\s+test(:[a-zA-Z0-9_-]+)?)$/,
      /^pnpm\s+(test|run\s+test(:[a-zA-Z0-9_-]+)?)$/,
      /^python\s+-m\s+(pytest|unittest)(\s+[a-zA-Z0-9_./\\-]+)?$/,
      /^pytest(\s+[a-zA-Z0-9_./\\-]+)?$/,
      /^go\s+test(\s+[a-zA-Z0-9_./\\-]+)?$/,
      /^cargo\s+test(\s+[a-zA-Z0-9_-]+)?$/,
      /^dotnet\s+test(\s+[a-zA-Z0-9_./\\-]+)?$/,
      /^gradle\s+test$/,
      /^mvn\s+test$/,
      /^make\s+test$/
    ];
    
    const trimmedCommand = command.trim();
    
    const isAllowed = allowedPatterns.some(pattern => pattern.test(trimmedCommand));
    
    if (!isAllowed) {
      console.warn(`Test command "${trimmedCommand}" does not match allowed patterns. Skipping test execution for security.`);
      return null;
    }
    
    return trimmedCommand;
  }
}