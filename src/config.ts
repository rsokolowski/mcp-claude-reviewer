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
  /** @deprecated Use test_command parameter in request_review instead */
  autoRunTests: boolean;
  reviewStoragePath: string;
  ignoredFiles: string[];
  severityThresholds: {
    blockOn: string[];
    warnOn: string[];
  };
  useMockReviewer: boolean;
}

const defaultConfig: Config = {
  claudeCliPath: process.env.CLAUDE_CLI_PATH || 'claude',
  maxReviewRounds: parseInt(process.env.MAX_REVIEW_ROUNDS || '5'),
  reviewModel: process.env.REVIEW_MODEL || 'claude-opus-4-20250514',
  autoRunTests: process.env.AUTO_RUN_TESTS === 'true',
  reviewStoragePath: '.reviews',
  ignoredFiles: ['*.generated.ts', '*.test.ts'],
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
        const mergedConfig = deepMerge(defaultConfig, fileConfig);
        
        // Warn about deprecated autoRunTests
        if (mergedConfig.autoRunTests) {
          console.warn('Warning: autoRunTests configuration is deprecated. ' +
            'Please use the test_command parameter when calling request_review instead.');
        }
        
        return mergedConfig;
      } catch (error) {
        console.error('Error loading config file:', error);
      }
    }
  }
  
  return defaultConfig;
}

export const config = loadConfig();