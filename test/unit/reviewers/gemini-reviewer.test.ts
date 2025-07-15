import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { exec, spawn } from 'child_process';
import { Readable, Writable } from 'stream';
import { GeminiReviewer } from '../../../src/reviewers/gemini-reviewer';
import { ReviewRequest } from '../../../src/types';
import { createMockReviewRequest } from '../../utils/mock-factories';

// Mock child_process module
jest.mock('child_process');

jest.mock('../../../src/config', () => ({
  config: {
    reviewer: {
      type: 'gemini',
      cliPath: 'gemini',
      model: 'gemini-2.5-pro',
      timeout: 30000,
      enableResume: false
    },
    logging: {
      level: 'INFO',
      toConsole: false,
      toFile: false
    }
  }
}));
jest.mock('../../../src/git-utils', () => ({
  GitUtils: jest.fn().mockImplementation(() => ({
    getChangedFiles: jest.fn(() => Promise.resolve(['file1.ts', 'file2.ts']))
  }))
}));

const mockedExec = exec as any;
const mockedSpawn = spawn as jest.Mock;

describe('GeminiReviewer', () => {
  let reviewer: GeminiReviewer;
  let request: ReviewRequest;
  let mockSpawnProcess: any;

  beforeEach(() => {
    jest.clearAllMocks();
    reviewer = new GeminiReviewer();
    request = createMockReviewRequest();

    // Mock for exec (used for --version check)
    mockedExec.mockImplementation((command: string, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      if (command.includes('--version')) {
        callback(null, 'gemini version 1.0.0', '');
      } else {
        callback(new Error('exec mock called with unexpected command'), '', '');
      }
    });

    // Mock for spawn (used for review execution)
    mockSpawnProcess = {
      stdout: Readable.from(['']),
      stderr: Readable.from(['']),
      stdin: new Writable({
        write(chunk, encoding, callback) {
          callback();
        },
        final(callback) {
          callback();
        }
      }),
      on: jest.fn((event: string, callback: (code: number) => void) => {
        if (event === 'close') {
          // Defer closing to simulate async operation
          setTimeout(() => callback(0), 0);
        }
        return mockSpawnProcess;
      }),
      kill: jest.fn()
    };
    mockedSpawn.mockReturnValue(mockSpawnProcess);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should execute Gemini CLI with correct parameters when no test command is provided', async () => {
    request.test_command = undefined; // Explicitly set test_command to undefined
    const mockReviewResult = {
      design_compliance: { follows_architecture: true, major_violations: [] },
      comments: [],
      missing_requirements: [],
      test_results: { passed: true, summary: 'All tests passed' },
      overall_assessment: 'lgtm'
    };

    mockSpawnProcess.stdout = Readable.from([JSON.stringify(mockReviewResult)]);

    const result = await reviewer.review(request, 'test diff');

    expect(mockedExec).toHaveBeenCalledWith('gemini --version', expect.any(Function));
    expect(mockedSpawn).toHaveBeenCalledWith('gemini', ['--model', 'gemini-2.5-pro', '--prompt-interactive']);
    expect(result.overall_assessment).toBe('lgtm');
  });

  it('should execute Gemini CLI with allowedTools when test command is provided', async () => {
    request.test_command = 'npm test';
    const mockReviewResult = { overall_assessment: 'lgtm' };
    mockSpawnProcess.stdout = Readable.from([JSON.stringify(mockReviewResult)]);

    await reviewer.review(request, 'test diff');

    expect(mockedSpawn).toHaveBeenCalledWith('gemini', [
      '--model', 
      'gemini-2.5-pro', 
      '--prompt-interactive', 
      '--allowedTools', 
      'Bash(npm test)'
    ]);
  });

  it('should throw error when Gemini CLI is not available', async () => {
    mockedExec.mockImplementation((command: string, callback: (error: Error, stdout: string, stderr: string) => void) => {
      callback(new Error('Command not found'), '', 'command not found');
    });

    await expect(reviewer.review(request, 'test diff')).rejects.toThrow(
      'Gemini CLI not found at gemini'
    );
  });

  it('should handle Gemini CLI execution error', async () => {
    // Make spawn fail
    mockSpawnProcess.on.mockImplementation((event: string, callback: (code: number) => void) => {
      if (event === 'close') {
        setTimeout(() => callback(1), 0); // Exit with error code
      }
      return mockSpawnProcess;
    });

    await expect(reviewer.review(request, 'test diff')).rejects.toThrow(
      'Gemini CLI exited with code 1'
    );
  });

  it('should handle Gemini CLI timeout', async () => {
    // Don't resolve the 'close' event to simulate a timeout
    mockSpawnProcess.on.mockImplementation(() => mockSpawnProcess);
    
    // Use a very short timeout for the test
    const reviewerWithTimeout = new GeminiReviewer({ type: 'gemini', timeout: 10 });

    await expect(reviewerWithTimeout.review(request, 'test diff')).rejects.toThrow(
      'Gemini CLI timed out after 10ms'
    );
    expect(mockSpawnProcess.kill).toHaveBeenCalled();
  });

  it('should parse response with markdown code blocks', async () => {
    const reviewJson = JSON.stringify({
      design_compliance: { follows_architecture: true, major_violations: [] },
      comments: [],
      overall_assessment: 'lgtm'
    });
    
    const response = `Here is the review:\n\`\`\`json\n${reviewJson}\n\`\`\``;
    mockSpawnProcess.stdout.push(response);
    mockSpawnProcess.stdout.push(null);

    const result = await reviewer.review(request, 'test diff');

    expect(result.overall_assessment).toBe('lgtm');
    expect(result.status).toBe('approved');
  });

  it('should return error review when parsing fails', async () => {
    mockSpawnProcess.stdout.push('invalid json');
    mockSpawnProcess.stdout.push(null);

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    
    const result = await reviewer.review(request, 'test diff');

    expect(result.overall_assessment).toBe('needs_changes');
    expect(result.design_compliance.major_violations).toHaveLength(1);
    expect(result.design_compliance.major_violations[0].issue).toBe('Review Parse Error');
    
    consoleSpy.mockRestore();
  });
});