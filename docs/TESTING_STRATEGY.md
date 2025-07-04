# Testing Strategy for MCP Claude Reviewer

## Overview

This document outlines a comprehensive testing strategy for the MCP Claude Reviewer project. The current codebase lacks proper test coverage, which is critical for a developer tool that provides code review functionality.

## Test Framework Selection

### Recommended: Jest
- **Why Jest**: 
  - Excellent TypeScript support
  - Built-in mocking capabilities
  - Great coverage reporting
  - Active community and ecosystem
  - Works well with async/await patterns used throughout the codebase

### Alternative: Vitest
- Faster than Jest
- Similar API to Jest
- Better ESM support
- Consider if performance becomes an issue

## Testing Structure

```
test/
├── unit/
│   ├── git-utils.test.ts
│   ├── storage-manager.test.ts
│   ├── config.test.ts
│   ├── logger.test.ts
│   ├── reviewers/
│   │   ├── claude-reviewer.test.ts
│   │   └── mock-reviewer.test.ts
│   ├── tools/
│   │   ├── request-review.test.ts
│   │   ├── get-review-history.test.ts
│   │   └── mark-review-complete.test.ts
│   └── prompts/
│       └── review-prompt.test.ts
├── integration/
│   ├── mcp-server.test.ts
│   ├── review-workflow.test.ts
│   └── multi-project.test.ts
├── fixtures/
│   ├── git-repos/
│   ├── review-responses/
│   └── config-files/
└── utils/
    ├── test-helpers.ts
    └── mock-factories.ts
```

## Testing Categories

### 1. Unit Tests (Priority: High)

#### Git Utils (`src/git-utils.ts`)
- Test git diff generation
- Test branch detection
- Test changed files detection
- Mock simple-git library
- Test error handling for git operations

#### Storage Manager (`src/storage-manager.ts`)
- Test save/retrieve operations
- Test directory creation
- Test file naming conventions
- Mock file system operations
- Test error handling and recovery

#### Config Module (`src/config.ts`)
- Test configuration loading from files
- Test environment variable merging
- Test default values
- Test validation of config values
- Test multi-project configuration

#### Logger (`src/logger.ts`)
- Test different log levels
- Test file and console output
- Test log rotation (if implemented)
- Mock file system for log files

#### Claude Reviewer (`src/reviewers/claude-reviewer.ts`)
- Test command construction
- Test response parsing
- Test error handling
- Mock child_process.exec
- Test timeout handling

#### Review Tools
- **Request Review**: Test review workflow, history tracking, test command execution
- **Get History**: Test retrieval logic, filtering, sorting
- **Mark Complete**: Test status updates, validation

### 2. Integration Tests (Priority: Medium)

#### MCP Server Integration
- Test server initialization
- Test tool registration
- Test request/response flow
- Test error propagation

#### Review Workflow
- Test complete review cycle
- Test iterative reviews
- Test with actual git repositories (fixtures)

#### Multi-Project Support
- Test working directory detection
- Test configuration isolation
- Test concurrent reviews

### 3. E2E Tests (Priority: Low)
- Test with actual Claude CLI (if available in CI)
- Test MCP protocol communication
- Test with Claude Desktop (manual testing)

## Test Implementation Examples

### Example 1: Git Utils Test

```typescript
// test/unit/git-utils.test.ts
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { gitDiff, getCurrentBranch, getChangedFiles } from '../../src/git-utils';
import simpleGit from 'simple-git';

jest.mock('simple-git');

describe('Git Utils', () => {
  let mockGit: any;

  beforeEach(() => {
    mockGit = {
      diff: jest.fn(),
      branch: jest.fn(),
      status: jest.fn(),
    };
    (simpleGit as jest.Mock).mockReturnValue(mockGit);
  });

  describe('gitDiff', () => {
    it('should return git diff for working directory', async () => {
      const expectedDiff = 'diff --git a/file.ts b/file.ts\n+added line';
      mockGit.diff.mockResolvedValue(expectedDiff);

      const result = await gitDiff('/project/path');

      expect(mockGit.diff).toHaveBeenCalledWith(['--no-prefix']);
      expect(result).toBe(expectedDiff);
    });

    it('should handle empty diff', async () => {
      mockGit.diff.mockResolvedValue('');

      const result = await gitDiff('/project/path');

      expect(result).toBe('');
    });

    it('should throw error when git fails', async () => {
      mockGit.diff.mockRejectedValue(new Error('Git error'));

      await expect(gitDiff('/project/path')).rejects.toThrow('Git error');
    });
  });

  describe('getCurrentBranch', () => {
    it('should return current branch name', async () => {
      mockGit.branch.mockResolvedValue({
        current: 'feature/add-tests',
        all: ['main', 'feature/add-tests'],
      });

      const result = await getCurrentBranch('/project/path');

      expect(result).toBe('feature/add-tests');
    });
  });
});
```

### Example 2: Storage Manager Test

```typescript
// test/unit/storage-manager.test.ts
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { StorageManager } from '../../src/storage-manager';
import * as fs from 'fs/promises';
import * as path from 'path';

jest.mock('fs/promises');

describe('StorageManager', () => {
  let storage: StorageManager;
  const mockWorkingDir = '/test/project';

  beforeEach(() => {
    jest.clearAllMocks();
    storage = new StorageManager(mockWorkingDir);
  });

  describe('saveReview', () => {
    it('should save review with correct structure', async () => {
      const reviewData = {
        sessionId: 'test-session-123',
        request: { summary: 'Test review' },
        review: { overall_assessment: 'lgtm' },
        round: 1,
      };

      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

      await storage.saveReview(reviewData);

      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('.reviews/sessions/test-session-123/round-1'),
        { recursive: true }
      );

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('review.json'),
        expect.any(String)
      );
    });
  });

  describe('getReviewHistory', () => {
    it('should retrieve and parse review history', async () => {
      const mockSessions = ['session-1', 'session-2'];
      const mockSessionData = {
        metadata: { timestamp: Date.now() },
        rounds: [{ review: { overall_assessment: 'lgtm' } }],
      };

      (fs.readdir as jest.Mock).mockResolvedValue(mockSessions);
      (fs.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify(mockSessionData)
      );

      const history = await storage.getReviewHistory();

      expect(history).toHaveLength(2);
      expect(fs.readdir).toHaveBeenCalled();
    });
  });
});
```

### Example 3: Claude Reviewer Test

```typescript
// test/unit/reviewers/claude-reviewer.test.ts
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ClaudeReviewer } from '../../../src/reviewers/claude-reviewer';
import { exec } from 'child_process';
import { promisify } from 'util';

jest.mock('child_process');
jest.mock('util', () => ({
  ...jest.requireActual('util'),
  promisify: jest.fn(() => jest.fn()),
}));

describe('ClaudeReviewer', () => {
  let reviewer: ClaudeReviewer;
  let mockExec: jest.Mock;

  beforeEach(() => {
    mockExec = jest.fn();
    (promisify as jest.Mock).mockReturnValue(mockExec);
    
    reviewer = new ClaudeReviewer({
      claudePath: '/usr/local/bin/claude',
      model: 'claude-3-opus',
      timeout: 30000,
    });
  });

  describe('review', () => {
    it('should execute claude command with correct parameters', async () => {
      const mockResponse = {
        stdout: JSON.stringify({
          overall_assessment: 'lgtm',
          comments: [],
          summary: { critical_issues: 0 },
        }),
        stderr: '',
      };

      mockExec.mockResolvedValue(mockResponse);

      const result = await reviewer.review({
        prompt: 'Review this code',
        diff: 'diff content',
        testCommand: 'npm test',
      });

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('claude'),
        expect.objectContaining({
          timeout: 30000,
          maxBuffer: expect.any(Number),
        })
      );

      expect(result.overall_assessment).toBe('lgtm');
    });

    it('should handle malformed JSON response', async () => {
      mockExec.mockResolvedValue({
        stdout: 'Not valid JSON',
        stderr: '',
      });

      await expect(reviewer.review({
        prompt: 'Review',
        diff: 'diff',
      })).rejects.toThrow('Invalid JSON response');
    });

    it('should handle command timeout', async () => {
      mockExec.mockRejectedValue(new Error('Command timeout'));

      await expect(reviewer.review({
        prompt: 'Review',
        diff: 'diff',
      })).rejects.toThrow('Command timeout');
    });
  });
});
```

## Test Utilities

### Mock Factories

```typescript
// test/utils/mock-factories.ts
export function createMockReviewRequest() {
  return {
    summary: 'Test review request',
    focus_areas: ['security', 'performance'],
    relevant_docs: ['README.md'],
    test_command: 'npm test',
  };
}

export function createMockReviewResponse() {
  return {
    overall_assessment: 'needs_changes',
    comments: [
      {
        file: 'src/index.ts',
        line: 10,
        severity: 'critical',
        category: 'security',
        issue: 'Potential XSS vulnerability',
        suggestion: 'Sanitize user input',
      },
    ],
    summary: {
      critical_issues: 1,
      major_issues: 0,
      minor_issues: 0,
      total_files: 1,
    },
  };
}

export function createMockGitDiff() {
  return `diff --git a/src/example.ts b/src/example.ts
index 123..456 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,5 +1,6 @@
 export function example() {
-  console.log('old');
+  console.log('new');
+  return true;
 }`;
}
```

### Test Helpers

```typescript
// test/utils/test-helpers.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function createTestGitRepo(dir: string) {
  await fs.mkdir(dir, { recursive: true });
  await execAsync('git init', { cwd: dir });
  await execAsync('git config user.email "test@example.com"', { cwd: dir });
  await execAsync('git config user.name "Test User"', { cwd: dir });
  
  // Create initial commit
  const filePath = path.join(dir, 'file.txt');
  await fs.writeFile(filePath, 'initial content');
  await execAsync('git add .', { cwd: dir });
  await execAsync('git commit -m "Initial commit"', { cwd: dir });
  
  // Create changes
  await fs.writeFile(filePath, 'modified content');
  
  return dir;
}

export async function cleanupTestDir(dir: string) {
  await fs.rm(dir, { recursive: true, force: true });
}

export function mockConsole() {
  const originalConsole = { ...console };
  const logs: string[] = [];
  
  console.log = jest.fn((...args) => logs.push(args.join(' ')));
  console.error = jest.fn((...args) => logs.push(`ERROR: ${args.join(' ')}`));
  
  return {
    logs,
    restore: () => Object.assign(console, originalConsole),
  };
}
```

## Test Configuration

### Jest Configuration

```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/types.ts',
    '!src/index.ts', // MCP server setup, tested via integration
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
```

### Test Setup

```typescript
// test/setup.ts
import { jest } from '@jest/globals';

// Global test timeout
jest.setTimeout(10000);

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.MCP_CLAUDE_REVIEWER_LOG_LEVEL = 'silent';

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});
```

## Implementation Plan

### Phase 1: Foundation (Week 1)
1. Set up Jest and TypeScript configuration
2. Create test structure and utilities
3. Implement tests for core utilities (git-utils, storage-manager)
4. Achieve 80% coverage for utility modules

### Phase 2: Core Logic (Week 2)
1. Test reviewer implementations
2. Test tool handlers
3. Test configuration and logging
4. Achieve 80% coverage for core modules

### Phase 3: Integration (Week 3)
1. Create integration tests
2. Test MCP server setup
3. Test complete workflows
4. Performance testing

### Phase 4: Polish (Week 4)
1. Add missing edge case tests
2. Improve test documentation
3. Set up CI/CD integration
4. Create testing guidelines

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    
    strategy:
      matrix:
        node-version: [18.x, 20.x]
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Use Node.js ${{ matrix.node-version }}
      uses: actions/setup-node@v3
      with:
        node-version: ${{ matrix.node-version }}
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run tests
      run: npm test
    
    - name: Generate coverage
      run: npm run test:coverage
    
    - name: Upload coverage
      uses: codecov/codecov-action@v3
      with:
        file: ./coverage/lcov.info
```

## Best Practices

1. **Test Naming**: Use descriptive test names that explain what is being tested
2. **AAA Pattern**: Arrange, Act, Assert structure for all tests
3. **Mock External Dependencies**: Never make actual API calls or file system operations
4. **Test Data**: Use factories and builders for consistent test data
5. **Coverage**: Aim for 80%+ coverage but focus on meaningful tests
6. **Performance**: Keep unit tests fast (<100ms per test)
7. **Isolation**: Each test should be independent and repeatable

## Conclusion

Implementing this testing strategy will significantly improve the reliability and maintainability of the MCP Claude Reviewer. Start with Phase 1 to establish a solid foundation, then progressively build coverage across the codebase.