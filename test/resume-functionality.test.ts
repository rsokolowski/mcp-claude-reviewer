import { ClaudeReviewer } from '../src/reviewers/claude-reviewer.js';
import { ReviewRequest, ReviewSession } from '../src/types.js';
import { exec } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

jest.mock('child_process');
jest.mock('../src/git-utils.js', () => ({
  GitUtils: jest.fn().mockImplementation(() => ({
    getChangedFiles: jest.fn().mockResolvedValue(['file1.ts', 'file2.ts'])
  }))
}));
jest.mock('../src/logger.js', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

describe('Claude Resume Functionality', () => {
  let reviewer: ClaudeReviewer;
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `test-resume-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    
    // Mock execAsync to return version check success
    (exec as any).mockImplementation((cmd: string, opts: any, callback: any) => {
      if (typeof opts === 'function') {
        callback = opts;
        opts = {};
      }
      
      if (cmd.includes('--version')) {
        callback(null, { stdout: 'claude version 1.0.0', stderr: '' });
      }
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  test('should use resume flag when session ID is available', async () => {
    reviewer = new ClaudeReviewer({
      type: 'claude',
      cliPath: 'claude',
      model: 'opus',
      enableResume: true
    });

    const request: ReviewRequest = {
      summary: 'Test review',
      previous_review_id: 'test-session-123'
    };

    const session: ReviewSession = {
      review_id: 'test-session-123',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'in_progress',
      rounds: [],
      request,
      claudeSessionIds: {
        'opus': 'abc-123-session-id'
      }
    };

    let capturedCommand = '';
    (exec as any).mockImplementation((cmd: string, opts: any, callback: any) => {
      if (typeof opts === 'function') {
        callback = opts;
        opts = {};
      }
      
      if (cmd.includes('--version')) {
        callback(null, { stdout: 'claude version 1.0.0', stderr: '' });
      } else {
        capturedCommand = cmd;
        // Mock successful Claude response with session ID
        const response = {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: JSON.stringify({
            review_id: 'test-review',
            overall_assessment: 'lgtm',
            design_compliance: { follows_architecture: true, major_violations: [] },
            comments: [],
            missing_requirements: [],
            test_results: { passed: true, summary: 'All tests passed' }
          }),
          session_id: 'abc-123-session-id',
          total_cost_usd: 0.01,
          usage: { input_tokens: 100, output_tokens: 200 }
        };
        callback(null, { stdout: JSON.stringify(response), stderr: '' });
      }
    });

    const result = await reviewer.review(request, 'test diff', [], session);

    // Verify resume flag was used
    expect(capturedCommand).toContain('--resume abc-123-session-id');
    expect(capturedCommand).toContain('--model opus');
    expect(result.overall_assessment).toBe('lgtm');
  });

  test('should not use resume flag when enableResume is false', async () => {
    reviewer = new ClaudeReviewer({
      type: 'claude',
      cliPath: 'claude',
      model: 'opus',
      enableResume: false
    });

    const request: ReviewRequest = {
      summary: 'Test review',
      previous_review_id: 'test-session-123'
    };

    const session: ReviewSession = {
      review_id: 'test-session-123',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'in_progress',
      rounds: [],
      request,
      claudeSessionIds: {
        'opus': 'abc-123-session-id'
      }
    };

    let capturedCommand = '';
    (exec as any).mockImplementation((cmd: string, opts: any, callback: any) => {
      if (typeof opts === 'function') {
        callback = opts;
        opts = {};
      }
      
      if (cmd.includes('--version')) {
        callback(null, { stdout: 'claude version 1.0.0', stderr: '' });
      } else {
        capturedCommand = cmd;
        const response = {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: JSON.stringify({
            review_id: 'test-review',
            overall_assessment: 'lgtm',
            design_compliance: { follows_architecture: true, major_violations: [] },
            comments: [],
            missing_requirements: [],
            test_results: { passed: true, summary: 'All tests passed' }
          }),
          session_id: 'new-session-id',
          total_cost_usd: 0.01,
          usage: { input_tokens: 100, output_tokens: 200 }
        };
        callback(null, { stdout: JSON.stringify(response), stderr: '' });
      }
    });

    await reviewer.review(request, 'test diff', [], session);

    // Verify resume flag was NOT used
    expect(capturedCommand).not.toContain('--resume');
  });

  test('should handle missing session ID gracefully', async () => {
    reviewer = new ClaudeReviewer({
      type: 'claude',
      cliPath: 'claude',
      model: 'opus',
      enableResume: true
    });

    const request: ReviewRequest = {
      summary: 'Test review',
      previous_review_id: 'test-session-123'
    };

    const session: ReviewSession = {
      review_id: 'test-session-123',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'in_progress',
      rounds: [],
      request
      // No claudeSessionIds
    };

    let capturedCommand = '';
    (exec as any).mockImplementation((cmd: string, opts: any, callback: any) => {
      if (typeof opts === 'function') {
        callback = opts;
        opts = {};
      }
      
      if (cmd.includes('--version')) {
        callback(null, { stdout: 'claude version 1.0.0', stderr: '' });
      } else {
        capturedCommand = cmd;
        const response = {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: JSON.stringify({
            review_id: 'test-review',
            overall_assessment: 'lgtm',
            design_compliance: { follows_architecture: true, major_violations: [] },
            comments: [],
            missing_requirements: [],
            test_results: { passed: true, summary: 'All tests passed' }
          }),
          session_id: 'new-session-id',
          total_cost_usd: 0.01,
          usage: { input_tokens: 100, output_tokens: 200 }
        };
        callback(null, { stdout: JSON.stringify(response), stderr: '' });
      }
    });

    await reviewer.review(request, 'test diff', [], session);

    // Verify resume flag was NOT used (no session ID available)
    expect(capturedCommand).not.toContain('--resume');
  });

  test('should store session ID for future use', async () => {
    reviewer = new ClaudeReviewer({
      type: 'claude',
      cliPath: 'claude',
      model: 'opus',
      enableResume: true
    });

    const request: ReviewRequest = {
      summary: 'Initial review'
    };

    (exec as any).mockImplementation((cmd: string, opts: any, callback: any) => {
      if (typeof opts === 'function') {
        callback = opts;
        opts = {};
      }
      
      if (cmd.includes('--version')) {
        callback(null, { stdout: 'claude version 1.0.0', stderr: '' });
      } else {
        const response = {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: JSON.stringify({
            review_id: 'test-review',
            overall_assessment: 'lgtm',
            design_compliance: { follows_architecture: true, major_violations: [] },
            comments: [],
            missing_requirements: [],
            test_results: { passed: true, summary: 'All tests passed' }
          }),
          session_id: 'new-session-abc-123',
          total_cost_usd: 0.01,
          usage: { input_tokens: 100, output_tokens: 200 }
        };
        callback(null, { stdout: JSON.stringify(response), stderr: '' });
      }
    });

    const result = await reviewer.review(request, 'test diff');

    // Verify session ID is attached to result
    expect((result as any).__claudeSessionId).toBe('new-session-abc-123');
    expect((result as any).__claudeModel).toBe('opus');
  });

  test('should retry without resume when session expires', async () => {
    reviewer = new ClaudeReviewer({
      type: 'claude',
      cliPath: 'claude',
      model: 'opus',
      enableResume: true
    });

    const request: ReviewRequest = {
      summary: 'Test review',
      previous_review_id: 'test-session-123'
    };

    const session: ReviewSession = {
      review_id: 'test-session-123',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'in_progress',
      rounds: [],
      request,
      claudeSessionIds: {
        'opus': 'expired-session-id'
      }
    };

    let callCount = 0;
    (exec as any).mockImplementation((cmd: string, opts: any, callback: any) => {
      if (typeof opts === 'function') {
        callback = opts;
        opts = {};
      }
      
      if (cmd.includes('--version')) {
        callback(null, { stdout: 'claude version 1.0.0', stderr: '' });
      } else {
        callCount++;
        if (callCount === 1 && cmd.includes('--resume')) {
          // First call with resume fails with session error
          const error: any = new Error('Command failed');
          error.code = 1;
          error.stdout = 'Error: session not found';
          error.stderr = '';
          callback(error);
        } else {
          // Retry without resume succeeds
          const response = {
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: JSON.stringify({
              review_id: 'test-review',
              overall_assessment: 'lgtm',
              design_compliance: { follows_architecture: true, major_violations: [] },
              comments: [],
              missing_requirements: [],
              test_results: { passed: true, summary: 'All tests passed' }
            }),
            session_id: 'new-session-id',
            total_cost_usd: 0.01,
            usage: { input_tokens: 100, output_tokens: 200 }
          };
          callback(null, { stdout: JSON.stringify(response), stderr: '' });
        }
      }
    });

    const result = await reviewer.review(request, 'test diff', [], session);

    // Verify it succeeded after retry
    expect(result.overall_assessment).toBe('lgtm');
    expect(callCount).toBe(2); // Initial call + retry
  });

  test('should use model-specific session IDs', async () => {
    reviewer = new ClaudeReviewer({
      type: 'claude',
      cliPath: 'claude',
      model: 'sonnet',
      enableResume: true
    });

    const request: ReviewRequest = {
      summary: 'Test review',
      previous_review_id: 'test-session-123'
    };

    const session: ReviewSession = {
      review_id: 'test-session-123',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'in_progress',
      rounds: [],
      request,
      claudeSessionIds: {
        'opus': 'opus-session-id',
        'sonnet': 'sonnet-session-id'
      }
    };

    let capturedCommand = '';
    (exec as any).mockImplementation((cmd: string, opts: any, callback: any) => {
      if (typeof opts === 'function') {
        callback = opts;
        opts = {};
      }
      
      if (cmd.includes('--version')) {
        callback(null, { stdout: 'claude version 1.0.0', stderr: '' });
      } else {
        capturedCommand = cmd;
        const response = {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: JSON.stringify({
            review_id: 'test-review',
            overall_assessment: 'lgtm',
            design_compliance: { follows_architecture: true, major_violations: [] },
            comments: [],
            missing_requirements: [],
            test_results: { passed: true, summary: 'All tests passed' }
          }),
          session_id: 'sonnet-session-id',
          total_cost_usd: 0.01,
          usage: { input_tokens: 100, output_tokens: 200 }
        };
        callback(null, { stdout: JSON.stringify(response), stderr: '' });
      }
    });

    await reviewer.review(request, 'test diff', [], session);

    // Verify correct model-specific session ID was used
    expect(capturedCommand).toContain('--resume sonnet-session-id');
    expect(capturedCommand).toContain('--model sonnet');
  });
});