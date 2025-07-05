import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';

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
  reviewModel: string | null;
  /** @deprecated Use test_command parameter in request_review instead */
  autoRunTests: boolean;
  reviewStoragePath: string;
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
  persistReviewPrompts: boolean;
}

const defaultConfig: Config = {
  claudeCliPath: 'claude',
  maxReviewRounds: 5,
  reviewModel: null,
  autoRunTests: false,
  reviewStoragePath: '.reviews',
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
  },
  persistReviewPrompts: false
};

export function loadConfig(workingDir?: string): Config {
  let config = deepMerge({} as Config, defaultConfig);
  
  // Check directories in this order:
  // 1. Working directory (if provided) - where the user is working
  // 2. Current process directory - where the MCP server is running from
  // 3. Installation directory - from MCP_INSTALL_DIR environment variable
  const dirs: string[] = [];
  if (workingDir) dirs.push(workingDir);
  if (!dirs.includes(process.cwd())) dirs.push(process.cwd());
  
  // Add installation directory if available from environment
  const installDir = process.env.MCP_INSTALL_DIR;
  if (installDir && !dirs.includes(installDir)) {
    dirs.push(installDir);
  }
  
  for (const dir of dirs) {
    const configPath = join(dir, '.claude-reviewer.json');
    
    if (existsSync(configPath)) {
      try {
        const fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
        config = deepMerge(defaultConfig, fileConfig);
        break;
      } catch (error) {
        // Only log actual errors, not debug info
        console.error('Error loading config file:', error);
      }
    }
  }
  
  
  // Warn about deprecated autoRunTests
  if (config.autoRunTests) {
    console.warn('Warning: autoRunTests configuration is deprecated. ' +
      'Please use the test_command parameter when calling request_review instead.');
  }
  
  return config;
}

export const config = loadConfig();