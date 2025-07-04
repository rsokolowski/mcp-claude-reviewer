import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { Logger, LogLevel, createLogger } from '../../src/logger';

jest.mock('fs');

const mockedAppendFileSync = appendFileSync as jest.MockedFunction<typeof appendFileSync>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>;

describe('Logger Module', () => {
  const originalEnv = process.env;
  const originalCwd = process.cwd;
  let consoleSpy: any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.cwd = jest.fn(() => '/test/cwd');
    // Note: The logger implementation uses console.error for all log output (to write to stderr)
    // This is intentional behavior, not a test mistake
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Setup default mock behavior
    mockedExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
    process.cwd = originalCwd;
    consoleSpy.mockRestore();
  });

  describe('Logger Construction', () => {
    it('should create logger with default configuration', () => {
      const logger = new Logger('TestLogger');
      
      logger.info('Test message');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] [TestLogger] Test message')
      );
    });

    it('should use environment variables for configuration', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      process.env.LOG_TO_CONSOLE = 'true';
      process.env.LOG_TO_FILE = 'true';
      
      mockedExistsSync.mockReturnValue(false);
      
      const logger = new Logger('TestLogger');
      
      logger.debug('Debug message');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] [TestLogger] Debug message')
      );
      expect(mockedMkdirSync).toHaveBeenCalledWith(join('/test/cwd', 'logs'), { recursive: true });
    });

    it('should use custom configuration over environment variables', () => {
      process.env.LOG_LEVEL = 'ERROR';
      
      const logger = new Logger('TestLogger', {
        level: LogLevel.DEBUG,
        toConsole: true
      });
      
      logger.debug('Debug message');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] [TestLogger] Debug message')
      );
    });

    it('should disable console when LOG_TO_CONSOLE is false', () => {
      process.env.LOG_TO_CONSOLE = 'false';
      
      const logger = new Logger('TestLogger');
      
      logger.info('Test message');
      
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('Logging Levels', () => {
    it('should respect log level hierarchy', () => {
      const logger = new Logger('TestLogger', { level: LogLevel.WARN });
      
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');
      
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Debug message')
      );
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Info message')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[WARN] [TestLogger] Warn message')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] [TestLogger] Error message')
      );
    });

    it('should log all levels when set to DEBUG', () => {
      const logger = new Logger('TestLogger', { level: LogLevel.DEBUG });
      
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');
      
      expect(consoleSpy).toHaveBeenCalledTimes(4);
    });

    it('should only log errors when set to ERROR', () => {
      const logger = new Logger('TestLogger', { level: LogLevel.ERROR });
      
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');
      
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] [TestLogger] Error message')
      );
    });
  });

  describe('Message Formatting', () => {
    it('should format messages with timestamp and metadata', () => {
      const logger = new Logger('TestLogger');
      const meta = { key: 'value', count: 42 };
      
      logger.info('Test message', meta);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] \[TestLogger\] Test message {"key":"value","count":42}/)
      );
    });

    it('should handle error objects specially', () => {
      const logger = new Logger('TestLogger');
      const error = new Error('Test error');
      error.stack = 'Error stack trace';
      
      logger.error('Error occurred', error);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"error":"Test error"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"stack":"Error stack trace"')
      );
    });

    it('should handle non-Error objects in error method', () => {
      const logger = new Logger('TestLogger');
      const errorData = { code: 'ERR001', message: 'Custom error' };
      
      logger.error('Error occurred', errorData);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('{"code":"ERR001","message":"Custom error"}')
      );
    });

    it('should handle messages without metadata', () => {
      const logger = new Logger('TestLogger');
      
      logger.info('Simple message');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[INFO\] \[TestLogger\] Simple message$/)
      );
    });
  });

  describe('File Logging', () => {
    it('should create log directory and file when file logging is enabled', () => {
      mockedExistsSync.mockReturnValue(false);
      
      const logger = new Logger('TestLogger', { toFile: true });
      
      logger.info('Test message');
      
      expect(mockedMkdirSync).toHaveBeenCalledWith(
        join('/test/cwd', 'logs'),
        { recursive: true }
      );
      expect(mockedAppendFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/\/test\/cwd\/logs\/mcp-reviewer-\d{4}-\d{2}-\d{2}\.log/),
        expect.stringContaining('[INFO] [TestLogger] Test message\n')
      );
    });

    it('should use custom file path when provided', () => {
      const customPath = 'custom/path/app.log';
      mockedExistsSync.mockReturnValue(false);
      
      const logger = new Logger('TestLogger', {
        toFile: true,
        filePath: customPath
      });
      
      logger.info('Test message');
      
      expect(mockedMkdirSync).toHaveBeenCalledWith(
        resolve('/test/cwd', 'custom/path'),
        { recursive: true }
      );
      expect(mockedAppendFileSync).toHaveBeenCalledWith(
        resolve('/test/cwd', customPath),
        expect.stringContaining('[INFO] [TestLogger] Test message\n')
      );
    });

    it('should use absolute custom file path', () => {
      const absolutePath = '/absolute/path/app.log';
      mockedExistsSync.mockReturnValue(true);
      
      const logger = new Logger('TestLogger', {
        toFile: true,
        filePath: absolutePath
      });
      
      logger.info('Test message');
      
      expect(mockedAppendFileSync).toHaveBeenCalledWith(
        absolutePath,
        expect.stringContaining('[INFO] [TestLogger] Test message\n')
      );
    });

    it('should use LOG_FILE_PATH environment variable', () => {
      process.env.LOG_TO_FILE = 'true';
      process.env.LOG_FILE_PATH = 'env/path/app.log';
      mockedExistsSync.mockReturnValue(false);
      
      const logger = new Logger('TestLogger');
      
      logger.info('Test message');
      
      expect(mockedMkdirSync).toHaveBeenCalledWith(
        resolve('/test/cwd', 'env/path'),
        { recursive: true }
      );
      expect(mockedAppendFileSync).toHaveBeenCalledWith(
        resolve('/test/cwd', 'env/path/app.log'),
        expect.stringContaining('[INFO] [TestLogger] Test message\n')
      );
    });

    it('should handle file write errors gracefully', () => {
      const writeConsoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockedAppendFileSync.mockImplementation(() => {
        throw new Error('Write failed');
      });
      
      const logger = new Logger('TestLogger', { toFile: true, toConsole: false });
      
      logger.info('Test message');
      
      expect(writeConsoleSpy).toHaveBeenCalledWith(
        'Failed to write to log file:',
        expect.any(Error)
      );
      writeConsoleSpy.mockRestore();
    });

    it('should use working directory for relative paths', () => {
      const workingDir = '/working/dir';
      const customPath = 'logs/app.log';
      mockedExistsSync.mockReturnValue(false);
      
      const logger = new Logger('TestLogger', {
        toFile: true,
        filePath: customPath
      }, workingDir);
      
      logger.info('Test message');
      
      expect(mockedMkdirSync).toHaveBeenCalledWith(
        join(workingDir, 'logs'),
        { recursive: true }
      );
      expect(mockedAppendFileSync).toHaveBeenCalledWith(
        resolve(workingDir, customPath),
        expect.stringContaining('[INFO] [TestLogger] Test message\n')
      );
    });

    it('should not attempt file operations when file logging is disabled', () => {
      const logger = new Logger('TestLogger', { toFile: false });
      
      logger.info('Test message');
      
      expect(mockedMkdirSync).not.toHaveBeenCalled();
      expect(mockedAppendFileSync).not.toHaveBeenCalled();
    });
  });

  describe('Factory Function', () => {
    it('should create logger using factory function', () => {
      const logger = createLogger('FactoryLogger', { level: LogLevel.DEBUG });
      
      expect(logger).toBeInstanceOf(Logger);
      
      logger.debug('Factory logger message');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] [FactoryLogger] Factory logger message')
      );
    });

    it('should pass all parameters through factory function', () => {
      const workingDir = '/factory/working';
      mockedExistsSync.mockReturnValue(false);
      
      const logger = createLogger('FactoryLogger', {
        toFile: true,
        filePath: 'factory.log'
      }, workingDir);
      
      logger.info('Test');
      
      expect(mockedMkdirSync).toHaveBeenCalledWith(
        workingDir,
        { recursive: true }
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty logger name', () => {
      const logger = new Logger('');
      
      logger.info('Test message');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[] Test message')
      );
    });

    it('should handle undefined metadata', () => {
      const logger = new Logger('TestLogger');
      
      logger.info('Test message', undefined);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[INFO\] \[TestLogger\] Test message$/)
      );
    });

    it('should handle string log level in config', () => {
      const logger = new Logger('TestLogger', { level: 'WARN' as any });
      
      logger.info('Should not appear');
      logger.warn('Should appear');
      
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Should appear')
      );
    });

    it('should handle invalid log level by allowing all messages', () => {
      // When an invalid level is provided, indexOf returns -1, which makes all messages pass
      // This is current behavior - arguably it should fall back to a safe default like INFO
      // but for now we're testing the actual implementation behavior
      const logger = new Logger('TestLogger', { level: 'INVALID' as any });
      
      logger.debug('Debug message');
      logger.info('Info message');
      
      // Both messages should be logged due to the indexOf returning -1
      expect(consoleSpy).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Debug message')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Info message')
      );
    });
  });
});