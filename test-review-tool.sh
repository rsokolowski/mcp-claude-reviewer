#!/bin/bash
echo "Testing MCP Claude Reviewer - request_review tool"
echo ""

# Initialize git repo if not already
if [ ! -d ".git" ]; then
  echo "Initializing git repository for testing..."
  git init
  git config user.email "test@example.com"
  git config user.name "Test User"
fi

# Create a test file with changes
echo "Creating test changes..."
cat > test-file.ts << 'EOF'
export interface CasePoolSchema {
  id: string;
  exercise_id: string; // This violates design!
  name: string;
}
EOF

git add test-file.ts 2>/dev/null || true

# Create test commands
cat > /tmp/mcp-review-test.txt << 'EOF'
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"request_review","arguments":{"summary":"Implemented CasePoolSchema interface","relevant_docs":["DESIGN.md"],"focus_areas":["Schema compliance"]}}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_review_history","arguments":{"limit":1}}}
EOF

echo "Starting server and sending review request..."
echo ""

timeout 10s node dist/index.js < /tmp/mcp-review-test.txt 2>/tmp/mcp-server-log.txt | jq -r 'select(.id==2) | .result.content[0].text' | jq .

echo ""
echo "Server log:"
cat /tmp/mcp-server-log.txt

# Clean up
rm -f /tmp/mcp-review-test.txt /tmp/mcp-server-log.txt test-file.ts
git reset --hard HEAD 2>/dev/null || true

echo ""
echo "Test completed!"