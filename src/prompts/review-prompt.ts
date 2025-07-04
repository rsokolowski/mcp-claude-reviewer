import { ReviewRequest, ReviewResult } from '../types.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export function generateReviewPrompt(
  request: ReviewRequest,
  gitDiff: string,
  changedFiles: string[],
  previousRounds?: ReviewResult[]
): string {
  const relevantDocs = request.relevant_docs || [];
  const focusAreas = request.focus_areas || [];
  
  let prompt = `You are a senior software engineer conducting a code review. Your primary goal is to ensure the implementation correctly follows the design documents and architectural decisions.

## Review Request
${request.summary}

## Relevant Documentation
${relevantDocs.length > 0 ? relevantDocs.join(', ') : 'No specific documentation referenced'}

## Changed Files
${changedFiles.join('\n')}

## Focus Areas
${focusAreas.length > 0 ? focusAreas.join('\n') : 'No specific focus areas'}

## Test Command
${request.test_command ? `Test command available: \`${request.test_command}\`
You should run this command using the Bash tool to validate that tests pass.` : 'No test command provided - skip test validation.'}

## Review Priorities (in order of importance)

1. **Design Compliance** (MOST CRITICAL)
   - Does the implementation follow the architecture described in design docs?
   - Are data models and schemas aligned with specifications?
   - Are the relationships between entities correct?
   - Does the code respect the intended boundaries and abstractions?

2. **Missing Requirements**
   - What required fields, methods, or features are missing?
   - Are all specified behaviors implemented?
   - Do data structures contain all necessary properties?

3. **Structural Issues**
   - Are interfaces and contracts properly defined?
   - Is the code organized according to the architectural patterns?
   - Are dependencies flowing in the right direction?

4. **Implementation Quality**
   - Bugs, security issues, and performance problems
   - Code modularity and SOLID principles
   - Test coverage and quality
   - Error handling and edge cases

## Previous Review Rounds
${previousRounds ? formatPreviousRounds(previousRounds) : 'This is the first review round.'}

## Git Diff
\`\`\`diff
${gitDiff}
\`\`\`

## Review Output Format

Focus on high-level architectural issues first. Line-by-line nitpicks are less important than design compliance.

IMPORTANT: You must output ONLY a valid JSON object with no other text before or after. Do not use any tools or request additional information. Output the review as a single JSON object with the following structure:
{
  "design_compliance": {
    "follows_architecture": true/false,
    "major_violations": [
      {
        "issue": "Brief issue title",
        "description": "Detailed description",
        "impact": "critical|major|minor",
        "recommendation": "Specific fix recommendation"
      }
    ]
  },
  "comments": [
    {
      "type": "specific|general",
      "file": "path/to/file.ts", // optional for specific comments
      "line": 42, // optional for specific comments
      "severity": "critical|major|minor|suggestion",
      "category": "architecture|design|bug|performance|style|security|missing_feature",
      "comment": "Detailed review comment",
      "suggested_fix": "Optional code suggestion or architectural guidance"
    }
  ],
  "missing_requirements": [
    {
      "requirement": "Description of missing requirement",
      "design_doc_reference": "design.md#section", // optional
      "severity": "critical|major|minor"
    }
  ],
  "test_results": {
    "passed": true/false,
    "summary": "Test execution summary",
    "failing_tests": [], // list of test names if any failed
    "coverage": "92%" // optional
  },
  "overall_assessment": "needs_changes|lgtm_with_suggestions|lgtm"
}

Before giving LGTM:
1. If a test command was provided above, run it using the Bash tool and include the results in your test_results.
2. If no test command was provided, set test_results.passed to null and include a note that tests were not validated.
3. Verify the implementation follows the design architecture.`;

  // Include relevant documentation content if files exist
  if (relevantDocs.length > 0) {
    prompt += '\n\n## Referenced Documentation Content\n';
    for (const doc of relevantDocs) {
      if (existsSync(doc)) {
        try {
          const content = readFileSync(doc, 'utf-8');
          prompt += `\n### ${doc}\n\`\`\`\n${content.substring(0, 5000)}${content.length > 5000 ? '\n... (truncated)' : ''}\n\`\`\`\n`;
        } catch (error) {
          prompt += `\n### ${doc}\n(Unable to read file)\n`;
        }
      }
    }
  }

  return prompt;
}

function formatPreviousRounds(rounds: ReviewResult[]): string {
  return rounds.map((round, index) => {
    const criticalIssues = round.comments.filter(c => c.severity === 'critical');
    const majorIssues = round.comments.filter(c => c.severity === 'major');
    
    return `### Round ${index + 1}
- Status: ${round.status}
- Design Violations: ${round.design_compliance.major_violations.length}
- Critical Issues: ${criticalIssues.length}
- Major Issues: ${majorIssues.length}
- Overall Assessment: ${round.overall_assessment}

Key Issues from Previous Round:
${round.design_compliance.major_violations.map(v => `- ${v.issue}: ${v.description}`).join('\n')}
${criticalIssues.map(c => `- ${c.comment}`).join('\n')}`;
  }).join('\n\n');
}