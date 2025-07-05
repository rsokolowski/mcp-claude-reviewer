import { jest } from '@jest/globals';

jest.setTimeout(10000);

process.env.NODE_ENV = 'test';

afterEach(() => {
  jest.clearAllMocks();
});