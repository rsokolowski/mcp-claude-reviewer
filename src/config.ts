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
  reviewTimeout: number;
  logging: {
    level?: string;
    toFile?: boolean;
    toConsole?: boolean;
    filePath?: string;
  };
}

const defaultConfig: Config = {
  claudeCliPath: 'claude',
  maxReviewRounds: 5,
  reviewModel: 'claude-opus-4-20250514',
  autoRunTests: false,
  reviewStoragePath: '.reviews',
  ignoredFiles: ['*.generated.ts', '*.test.ts'],
  severityThresholds: {
    blockOn: ['critical', 'major'],
    warnOn: ['minor']
  },
  useMockReviewer: false,
  reviewTimeout: 120000,
  logging: {
    level: 'INFO',
    toFile: false,
    toConsole: true
  }
};

export function loadConfig(workingDir?: string): Config {
  let config = deepMerge({} as Config, defaultConfig);
  
  // Try to load config from the working directory first
  const dirs = workingDir ? [workingDir, process.cwd()] : [process.cwd()];
  
  for (const dir of dirs) {
    const configPath = join(dir, '.claude-reviewer.json');
    
    if (existsSync(configPath)) {
      try {
        const fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
        config = deepMerge(defaultConfig, fileConfig);
        break;
      } catch (error) {
        console.error('Error loading config file:', error);
      }
    }
  }
  
  // Apply environment variable overrides
  if (process.env.CLAUDE_CLI_PATH) {
    config.claudeCliPath = process.env.CLAUDE_CLI_PATH;
  }
  if (process.env.MAX_REVIEW_ROUNDS) {
    config.maxReviewRounds = parseInt(process.env.MAX_REVIEW_ROUNDS);
  }
  if (process.env.REVIEW_MODEL) {
    config.reviewModel = process.env.REVIEW_MODEL;
  }
  if (process.env.AUTO_RUN_TESTS) {
    config.autoRunTests = process.env.AUTO_RUN_TESTS === 'true';
  }
  if (process.env.USE_MOCK_REVIEWER) {
    config.useMockReviewer = process.env.USE_MOCK_REVIEWER === 'true';
  }
  
  // Apply logging environment variable overrides
  if (process.env.LOG_LEVEL) {
    config.logging.level = process.env.LOG_LEVEL;
  }
  if (process.env.LOG_TO_FILE) {
    config.logging.toFile = process.env.LOG_TO_FILE === 'true';
  }
  if (process.env.LOG_TO_CONSOLE) {
    config.logging.toConsole = process.env.LOG_TO_CONSOLE === 'true';
  }
  if (process.env.LOG_FILE_PATH) {
    config.logging.filePath = process.env.LOG_FILE_PATH;
  }
  if (process.env.REVIEW_TIMEOUT) {
    config.reviewTimeout = parseInt(process.env.REVIEW_TIMEOUT);
  }
  
  // Warn about deprecated autoRunTests
  if (config.autoRunTests) {
    console.warn('Warning: autoRunTests configuration is deprecated. ' +
      'Please use the test_command parameter when calling request_review instead.');
  }
  
  return config;
}

export const config = loadConfig();