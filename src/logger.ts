import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

export interface LoggerConfig {
  level?: string | LogLevel;
  toFile?: boolean;
  toConsole?: boolean;
  filePath?: string;
}

export class Logger {
  private name: string;
  private logFile?: string;
  private enableConsole: boolean;
  private minLevel: LogLevel;
  
  constructor(name: string, config?: LoggerConfig, workingDir?: string) {
    this.name = name;
    
    // Use provided config or fall back to environment variables
    this.enableConsole = config?.toConsole ?? (process.env.LOG_TO_CONSOLE !== 'false');
    this.minLevel = (config?.level as LogLevel) ?? (process.env.LOG_LEVEL as LogLevel) ?? LogLevel.INFO;
    
    // Set up file logging if enabled
    const enableFileLogging = config?.toFile ?? (process.env.LOG_TO_FILE === 'true');
    if (enableFileLogging) {
      // Use custom file path if provided, otherwise use default
      if (config?.filePath || process.env.LOG_FILE_PATH) {
        const customPath = config?.filePath || process.env.LOG_FILE_PATH || '';
        
        // Resolve the path to handle both absolute and relative paths
        const resolvedPath = resolve(workingDir || process.cwd(), customPath);
        
        // Ensure directory exists for custom path
        const dir = dirname(resolvedPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        
        this.logFile = resolvedPath;
      } else {
        // Default behavior: use logs directory with date-based filename
        const logDir = join(workingDir || process.cwd(), 'logs');
        if (!existsSync(logDir)) {
          mkdirSync(logDir, { recursive: true });
        }
        
        const date = new Date().toISOString().split('T')[0];
        this.logFile = join(logDir, `mcp-reviewer-${date}.log`);
      }
    }
  }
  
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const currentIndex = levels.indexOf(this.minLevel);
    const messageIndex = levels.indexOf(level);
    return messageIndex >= currentIndex;
  }
  
  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] [${this.name}] ${message}${metaStr}`;
  }
  
  private log(level: LogLevel, message: string, meta?: any): void {
    if (!this.shouldLog(level)) return;
    
    const formatted = this.formatMessage(level, message, meta);
    
    // Console output (for stderr)
    if (this.enableConsole) {
      console.error(formatted);
    }
    
    // File output
    if (this.logFile) {
      try {
        appendFileSync(this.logFile, formatted + '\n');
      } catch (error) {
        console.error('Failed to write to log file:', error);
      }
    }
  }
  
  debug(message: string, meta?: any): void {
    this.log(LogLevel.DEBUG, message, meta);
  }
  
  info(message: string, meta?: any): void {
    this.log(LogLevel.INFO, message, meta);
  }
  
  warn(message: string, meta?: any): void {
    this.log(LogLevel.WARN, message, meta);
  }
  
  error(message: string, error?: Error | any): void {
    const meta = error instanceof Error 
      ? { error: error.message, stack: error.stack }
      : error;
    this.log(LogLevel.ERROR, message, meta);
  }
}

// Factory function for creating loggers
export function createLogger(name: string, config?: LoggerConfig, workingDir?: string): Logger {
  return new Logger(name, config, workingDir);
}