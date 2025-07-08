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
  reviewStoragePath: string;
  logging: {
    level?: string;
    toFile?: boolean;
    toConsole?: boolean;
    filePath?: string;
  };
  persistReviewPrompts: boolean;
  reviewer: {
    type: 'claude' | 'gemini' | 'mock';
    cliPath: string;
    model?: string | null;
    timeout: number;
    enableResume: boolean;
  };
}

const defaultConfig: Config = {
  reviewStoragePath: '.reviews',
  logging: {
    level: 'INFO',
    toFile: false,
    toConsole: true
  },
  persistReviewPrompts: false,
  reviewer: {
    type: 'claude',
    cliPath: 'claude',
    model: null,
    timeout: 120000,
    enableResume: true
  }
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
  
  
  // Ensure reviewer config exists with defaults
  if (!config.reviewer) {
    config.reviewer = {
      type: 'claude',
      cliPath: 'claude',
      model: null,
      timeout: 120000,
      enableResume: true
    };
  }
  
  return config;
}

export const config = loadConfig();