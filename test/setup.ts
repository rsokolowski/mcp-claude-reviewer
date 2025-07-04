import { jest } from '@jest/globals';

jest.setTimeout(10000);

process.env.NODE_ENV = 'test';
process.env.MCP_CLAUDE_REVIEWER_LOG_LEVEL = 'silent';

afterEach(() => {
  jest.clearAllMocks();
});