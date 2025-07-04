import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface Config {
  claudeCliPath: string;
  maxReviewRounds: number;
  reviewModel: string;
  autoRunTests: boolean;
  reviewStoragePath: string;
  ignoredFiles: string[];
  testCommand: string;
  severityThresholds: {
    blockOn: string[];
    warnOn: string[];
  };
}

const defaultConfig: Config = {
  claudeCliPath: process.env.CLAUDE_CLI_PATH || 'claude',
  maxReviewRounds: parseInt(process.env.MAX_REVIEW_ROUNDS || '5'),
  reviewModel: process.env.REVIEW_MODEL || 'claude-3-opus-20240229',
  autoRunTests: process.env.AUTO_RUN_TESTS === 'true',
  reviewStoragePath: '.reviews',
  ignoredFiles: ['*.generated.ts', '*.test.ts'],
  testCommand: 'npm test',
  severityThresholds: {
    blockOn: ['critical', 'major'],
    warnOn: ['minor']
  }
};

export function loadConfig(): Config {
  const configPath = join(process.cwd(), '.claude-reviewer.json');
  
  if (existsSync(configPath)) {
    try {
      const fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
      return { ...defaultConfig, ...fileConfig };
    } catch (error) {
      console.error('Error loading config file:', error);
      return defaultConfig;
    }
  }
  
  return defaultConfig;
}

export const config = loadConfig();