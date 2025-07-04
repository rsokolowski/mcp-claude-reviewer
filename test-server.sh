#!/bin/bash
echo "Testing MCP Claude Reviewer server..."
echo ""
echo "Starting server and sending test commands..."
echo ""

# Create a temporary file for the test commands
cat > /tmp/mcp-test-commands.txt << 'EOF'
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"test_connection","arguments":{}}}
EOF

# Run the server and send commands
timeout 5s node dist/index.js < /tmp/mcp-test-commands.txt 2>/tmp/mcp-server-log.txt

echo "Server log:"
cat /tmp/mcp-server-log.txt
echo ""

# Clean up
rm -f /tmp/mcp-test-commands.txt /tmp/mcp-server-log.txt

echo "Test completed!"