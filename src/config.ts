import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  
  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      const sourceValue = source[key];
      const targetValue = target[key];
      
      if (sourceValue !== undefined) {
        if (
          typeof sourceValue === 'object' && 
          sourceValue !== null && 
          !Array.isArray(sourceValue) &&
          typeof targetValue === 'object' && 
          targetValue !== null && 
          !Array.isArray(targetValue)
        ) {
          result[key] = deepMerge(targetValue, sourceValue);
        } else {
          result[key] = sourceValue as T[typeof key];
        }
      }
    }
  }
  
  return result;
}

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
  useMockReviewer: boolean;
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
  },
  useMockReviewer: process.env.USE_MOCK_REVIEWER === 'true'
};

export function loadConfig(workingDir?: string): Config {
  // Try to load config from the working directory first
  const dirs = workingDir ? [workingDir, process.cwd()] : [process.cwd()];
  
  for (const dir of dirs) {
    const configPath = join(dir, '.claude-reviewer.json');
    
    if (existsSync(configPath)) {
      try {
        const fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
        return deepMerge(defaultConfig, fileConfig);
      } catch (error) {
        console.error('Error loading config file:', error);
      }
    }
  }
  
  return defaultConfig;
}

export const config = loadConfig();