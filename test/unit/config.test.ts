import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { loadConfig } from '../../src/config';

jest.mock('fs');

const mockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

describe('Config Module', () => {
  const originalEnv = process.env;
  const originalCwd = process.cwd;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.cwd = jest.fn(() => '/test/cwd');
  });

  afterEach(() => {
    process.env = originalEnv;
    process.cwd = originalCwd;
  });

  describe('loadConfig', () => {
    const defaultConfig = {
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

    describe('Default Configuration', () => {
      it('should return default config when no config file exists', () => {
        mockedExistsSync.mockReturnValue(false);

        const config = loadConfig();

        expect(config).toEqual(defaultConfig);
        expect(mockedExistsSync).toHaveBeenCalled();
      });
    });

    describe('Configuration Loading from Files', () => {
      it('should load config from working directory if provided', () => {
        const workingDir = '/test/working';
        const customConfig = {
          claudeCliPath: '/custom/claude',
          maxReviewRounds: 10,
          reviewModel: 'custom-model'
        };

        mockedExistsSync.mockImplementation((path) => {
          return path === join(workingDir, '.claude-reviewer.json');
        });
        mockedReadFileSync.mockReturnValue(JSON.stringify(customConfig));

        const config = loadConfig(workingDir);

        expect(mockedExistsSync).toHaveBeenCalledWith(join(workingDir, '.claude-reviewer.json'));
        expect(mockedReadFileSync).toHaveBeenCalledWith(join(workingDir, '.claude-reviewer.json'), 'utf-8');
        expect(config.claudeCliPath).toBe('/custom/claude');
        expect(config.maxReviewRounds).toBe(10);
        expect(config.reviewModel).toBe('custom-model');
      });

      it('should load config from process.cwd() if no working directory provided', () => {
        const customConfig = {
          reviewStoragePath: '/custom/reviews'
        };

        mockedExistsSync.mockImplementation((path) => {
          return path === join('/test/cwd', '.claude-reviewer.json');
        });
        mockedReadFileSync.mockReturnValue(JSON.stringify(customConfig));

        const config = loadConfig();

        expect(mockedExistsSync).toHaveBeenCalledWith(join('/test/cwd', '.claude-reviewer.json'));
        expect(config.reviewStoragePath).toBe('/custom/reviews');
      });

      it('should load config from MCP_INSTALL_DIR if set and other locations fail', () => {
        process.env.MCP_INSTALL_DIR = '/install/dir';
        const customConfig = {
          useMockReviewer: true,
          reviewTimeout: 60000
        };

        mockedExistsSync.mockImplementation((path) => {
          return path === join('/install/dir', '.claude-reviewer.json');
        });
        mockedReadFileSync.mockReturnValue(JSON.stringify(customConfig));

        const config = loadConfig();

        expect(mockedExistsSync).toHaveBeenCalledWith(join('/install/dir', '.claude-reviewer.json'));
        expect(config.useMockReviewer).toBe(true);
        expect(config.reviewTimeout).toBe(60000);
      });

      it('should handle JSON parse errors gracefully', () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue('invalid json');

        const config = loadConfig();

        expect(consoleSpy).toHaveBeenCalledWith('Error loading config file:', expect.any(Error));
        expect(config).toEqual(defaultConfig);
        consoleSpy.mockRestore();
      });

      it('should handle file read errors gracefully', () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockImplementation(() => {
          throw new Error('File read error');
        });

        const config = loadConfig();

        expect(consoleSpy).toHaveBeenCalledWith('Error loading config file:', expect.any(Error));
        expect(config).toEqual(defaultConfig);
        consoleSpy.mockRestore();
      });
    });

    describe('Configuration Merging', () => {
      it('should deep merge nested configuration objects', () => {
        const customConfig = {
          logging: {
            level: 'DEBUG',
            toFile: true
          }
        };

        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(JSON.stringify(customConfig));

        const config = loadConfig();

        expect(config.logging).toEqual({
          level: 'DEBUG',
          toFile: true,
          toConsole: true
        });
      });

      it('should override arrays completely, not merge them', () => {
        const customConfig = {
          severityThresholds: {
            blockOn: ['critical']
          }
        };

        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(JSON.stringify(customConfig));

        const config = loadConfig();

        expect(config.severityThresholds.blockOn).toEqual(['critical']);
        expect(config.severityThresholds.warnOn).toEqual(['minor']);
      });

      it('should handle null and undefined values correctly in merging', () => {
        const customConfig = {
          claudeCliPath: null,
          logging: {
            filePath: '/log/path'
          }
        };

        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(JSON.stringify(customConfig));

        const config = loadConfig();

        expect(config.claudeCliPath).toBeNull();
        expect(config.logging.filePath).toBe('/log/path');
      });

      it('should preserve null reviewModel from config file', () => {
        const customConfig = {
          reviewModel: null,
          claudeCliPath: '/custom/claude'
        };

        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(JSON.stringify(customConfig));

        const config = loadConfig();

        expect(config.reviewModel).toBeNull();
        expect(config.claudeCliPath).toBe('/custom/claude');
      });

      it('should use null as default reviewModel when no config file exists', () => {
        mockedExistsSync.mockReturnValue(false);

        const config = loadConfig();

        expect(config.reviewModel).toBeNull();
      });

      it('should use specified reviewModel when provided in config', () => {
        const customConfig = {
          reviewModel: 'claude-opus-4-20250514'
        };

        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(JSON.stringify(customConfig));

        const config = loadConfig();

        expect(config.reviewModel).toBe('claude-opus-4-20250514');
      });
    });


    describe('Deprecation Warnings', () => {
      it('should warn when autoRunTests is set to true in config file', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const customConfig = {
          autoRunTests: true
        };

        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue(JSON.stringify(customConfig));

        loadConfig();

        expect(consoleSpy).toHaveBeenCalledWith(
          'Warning: autoRunTests configuration is deprecated. ' +
          'Please use the test_command parameter when calling request_review instead.'
        );
        consoleSpy.mockRestore();
      });


      it('should not warn when autoRunTests is false', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        mockedExistsSync.mockReturnValue(false);

        loadConfig();

        expect(consoleSpy).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
      });
    });

    describe('Priority and Search Order', () => {
      it('should check directories in correct order: workingDir, cwd, installDir', () => {
        const workingDir = '/working';
        process.env.MCP_INSTALL_DIR = '/install';
        
        mockedExistsSync.mockReturnValue(false);

        loadConfig(workingDir);

        expect(mockedExistsSync).toHaveBeenNthCalledWith(1, join(workingDir, '.claude-reviewer.json'));
        expect(mockedExistsSync).toHaveBeenNthCalledWith(2, join('/test/cwd', '.claude-reviewer.json'));
        expect(mockedExistsSync).toHaveBeenNthCalledWith(3, join('/install', '.claude-reviewer.json'));
      });

      it('should stop searching after finding first config file', () => {
        const workingDir = '/working';
        process.env.MCP_INSTALL_DIR = '/install';
        
        mockedExistsSync.mockImplementation((path) => {
          return path === join('/test/cwd', '.claude-reviewer.json');
        });
        mockedReadFileSync.mockReturnValue('{}');

        loadConfig(workingDir);

        expect(mockedExistsSync).toHaveBeenCalledTimes(2);
        expect(mockedReadFileSync).toHaveBeenCalledTimes(1);
        expect(mockedReadFileSync).toHaveBeenCalledWith(join('/test/cwd', '.claude-reviewer.json'), 'utf-8');
      });

      it('should not duplicate directories in search path', () => {
        const workingDir = '/test/cwd';
        process.env.MCP_INSTALL_DIR = '/test/cwd';
        
        mockedExistsSync.mockReturnValue(false);

        loadConfig(workingDir);

        expect(mockedExistsSync).toHaveBeenCalledTimes(1);
        expect(mockedExistsSync).toHaveBeenCalledWith(join('/test/cwd', '.claude-reviewer.json'));
      });
    });
  });
});