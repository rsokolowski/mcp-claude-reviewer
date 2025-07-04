import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { jest } from '@jest/globals';

const execAsync = promisify(exec);

export async function createTestGitRepo(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await execAsync('git init', { cwd: dir });
  await execAsync('git config user.email "test@example.com"', { cwd: dir });
  await execAsync('git config user.name "Test User"', { cwd: dir });
  
  const filePath = path.join(dir, 'file.txt');
  await fs.writeFile(filePath, 'initial content');
  await execAsync('git add .', { cwd: dir });
  await execAsync('git commit -m "Initial commit"', { cwd: dir });
  
  await fs.writeFile(filePath, 'modified content');
  
  return dir;
}

export async function cleanupTestDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

export function mockConsole() {
  const originalConsole = { ...console };
  const logs: string[] = [];
  
  console.log = jest.fn((...args) => logs.push(args.join(' ')));
  console.error = jest.fn((...args) => logs.push(`ERROR: ${args.join(' ')}`));
  console.warn = jest.fn((...args) => logs.push(`WARN: ${args.join(' ')}`));
  
  return {
    logs,
    restore: () => Object.assign(console, originalConsole),
  };
}

export function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join('/tmp', 'mcp-claude-reviewer-test-'));
}