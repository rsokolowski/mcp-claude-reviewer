# Claude CLI Resume Feature Design

## Overview

This design proposes utilizing Claude CLI's `--resume` functionality to maintain conversation context across follow-up reviews, improving efficiency and reducing token usage.

## Current State

- Each review creates a new Claude CLI invocation
- Previous review context is passed as text in the prompt
- Claude's session IDs are generated but never used
- No conversation memory between reviews

## Proposed Solution

### 1. Session Management

Store Claude's session ID alongside our review session:

```typescript
interface ReviewSession {
  reviewId: string;          // Our format: YYYY-MM-DD-NNN
  claudeSessionIds?: {       // Model-specific session IDs for resume
    [model: string]: string; // e.g., { "opus": "abc-123", "sonnet": "def-456" }
  };
  rounds: ReviewRound[];
  // ... existing fields
}
```

### 2. CLI Invocation Strategy

#### Initial Review
```bash
claude --print --output-format json --model <model> --allowedTools "<tools>" < prompt.txt
```
- Capture and store the `session_id` from response
- Save it in the review session file

#### Follow-up Review
```bash
claude --resume <session_id> --print --output-format json --model <model> --allowedTools "<tools>" < prompt.txt
```
- Use stored `session_id` with `--resume` flag
- Claude maintains conversation context automatically

### 3. Implementation Changes

#### ClaudeReviewer

No changes needed to BaseReviewer - the existing architecture already supports this enhancement.
```typescript
class ClaudeReviewer extends BaseReviewer {
  async review(request: ReviewRequest): Promise<ReviewResult> {
    // Load previous session if follow-up
    const previousSession = request.previous_review_id 
      ? await this.loadSession(request.previous_review_id)
      : null;
    
    // Use Claude session ID if available for current model
    const model = this.config.model || 'default';
    const claudeSessionId = previousSession?.claudeSessionIds?.[model];
    
    // Execute with resume if session exists
    const result = await this.executeWithClaude(
      prompt, 
      claudeSessionId
    );
    
    // Store Claude session ID for future use
    await this.saveSession({
      ...session,
      claudeSessionIds: {
        ...(session.claudeSessionIds || {}),
        [model]: result.session_id
      }
    });
  }
}
```

### 4. Benefits

1. **Context Preservation**: Claude maintains full conversation history
2. **Token Efficiency**: No need to re-send previous rounds in prompt
3. **Better Understanding**: Claude can reference earlier discussions naturally
4. **Cost Reduction**: Fewer input tokens for follow-up reviews

### 5. Considerations

1. **Session Expiry**: 
   - Claude sessions expire after an undocumented period (likely 24-48 hours)
   - Detect expiry by checking for specific error patterns in CLI output
   - Error response will include "session not found" or similar message
   - Fallback: Log warning at DEBUG level and proceed with full prompt

2. **Model Consistency**: 
   - Sessions are model-specific - store session IDs per model
   - Using wrong model with session ID will fail gracefully

3. **Error Handling**: 
   - Wrap resume attempts in try-catch
   - On any error, fallback to current full-prompt approach
   - Log errors at DEBUG level to avoid noise

4. **Backward Compatibility**: 
   - Support existing sessions without Claude session IDs
   - Check for both old `claudeSessionId` and new `claudeSessionIds` fields

5. **Security**: 
   - Session IDs provide access to conversation history
   - Should not be logged above DEBUG level
   - Stored only in local session files with existing permissions

### 6. Migration Path

1. Update session storage to include `claudeSessionIds`
2. Modify Claude reviewer to use resume when available
3. Gracefully handle old sessions without session IDs
4. Add configuration option to enable/disable resume feature:
   - Add `enableResume: boolean = true` to server config
   - Allow override via environment variable or config file

### 7. Testing Strategy

1. Test successful resume with valid session ID
2. Test fallback when session ID is invalid/expired
3. Test model consistency requirements
4. Verify token usage reduction
5. Test error scenarios

## Example Flow

1. **Initial Review**:
   - User requests review with model "opus"
   - Claude CLI invoked normally
   - Response includes `session_id: "abc-123"`
   - Session stored with `claudeSessionIds: { "opus": "abc-123" }`

2. **Follow-up Review**:
   - User requests follow-up with `previous_review_id`
   - System loads previous session, finds session ID for current model
   - Claude CLI invoked with `--resume abc-123`
   - Claude continues conversation with full context
   - Response returns same session ID (Claude maintains the session)

3. **Error Handling**:
   - If resume fails (expired/invalid session), CLI returns error
   - System detects error, logs at DEBUG level
   - Falls back to full prompt approach automatically
   - User experience remains unchanged

## Performance Targets

- **Token Reduction**: 50-80% reduction in input tokens for follow-up reviews
- **Response Time**: Similar or slightly faster due to reduced prompt size
- **Session Reuse Rate**: Target 90%+ successful resume rate within 24 hours

## Monitoring and Metrics

1. **Success Metrics**:
   - Track session resume success rate
   - Measure token usage reduction
   - Monitor response time improvements

2. **Error Tracking**:
   - Log resume failures with reasons
   - Track session expiry patterns
   - Monitor fallback frequency

3. **Usage Analytics**:
   - Count of reviews using resume
   - Average number of rounds per session
   - Model-specific resume patterns

## Requirements

- **Claude CLI Version**: Resume feature available in all recent versions
- **Rate Limiting**: Standard Claude API rate limits apply
- **Retry Strategy**: Use existing retry logic, no special handling needed