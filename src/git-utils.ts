import simpleGit, { SimpleGit } from 'simple-git';
import { join } from 'path';

export class GitUtils {
  private git: SimpleGit;
  
  constructor(workingDir: string = process.cwd()) {
    this.git = simpleGit(workingDir);
  }
  
  async isGitRepository(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }
  
  async getChangedFiles(): Promise<string[]> {
    const status = await this.git.status();
    const changedFiles: string[] = [];
    
    // Include both staged and unstaged changes
    changedFiles.push(...status.staged);
    changedFiles.push(...status.modified);
    changedFiles.push(...status.created);
    changedFiles.push(...status.renamed.map(r => r.to));
    
    // Remove duplicates
    return [...new Set(changedFiles)];
  }
  
  async getGitDiff(staged: boolean = false): Promise<string> {
    if (staged) {
      return await this.git.diff(['--cached']);
    }
    // Get both staged and unstaged changes
    const stagedDiff = await this.git.diff(['--cached']);
    const unstagedDiff = await this.git.diff();
    
    if (stagedDiff && unstagedDiff) {
      return `=== STAGED CHANGES ===\n${stagedDiff}\n\n=== UNSTAGED CHANGES ===\n${unstagedDiff}`;
    }
    
    return stagedDiff || unstagedDiff || '';
  }
  
  async getCurrentBranch(): Promise<string> {
    const branch = await this.git.branch();
    return branch.current;
  }
  
  async getRecentCommits(count: number = 10): Promise<string[]> {
    const log = await this.git.log({ maxCount: count });
    return log.all.map(commit => 
      `${commit.hash.substring(0, 7)} - ${commit.message} (${commit.author_name})`
    );
  }
  
  async getDiffFromBranch(baseBranch: string = 'main'): Promise<string> {
    try {
      return await this.git.diff([`${baseBranch}...HEAD`]);
    } catch (error) {
      // If base branch doesn't exist or other error, fall back to regular diff
      return await this.getGitDiff();
    }
  }
  
  async getFilesChangedFromBranch(baseBranch: string = 'main'): Promise<string[]> {
    try {
      const diff = await this.git.diff([`${baseBranch}...HEAD`, '--name-only']);
      return diff.split('\n').filter(f => f.trim());
    } catch {
      // Fall back to current changes
      return await this.getChangedFiles();
    }
  }
}