#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import { RequestReviewHandler } from './tools/request-review.js';
import { GetReviewHistoryHandler } from './tools/get-review-history.js';
import { MarkReviewCompleteHandler } from './tools/mark-review-complete.js';

const server = new Server(
  {
    name: 'claude-reviewer',
    version: '0.1.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Initialize handlers
const requestReviewHandler = new RequestReviewHandler();
const getReviewHistoryHandler = new GetReviewHistoryHandler();
const markReviewCompleteHandler = new MarkReviewCompleteHandler();

// Define all tools
const tools: Tool[] = [
  RequestReviewHandler.getToolDefinition(),
  GetReviewHistoryHandler.getToolDefinition(),
  MarkReviewCompleteHandler.getToolDefinition()
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case 'request_review':
        const reviewResult = await requestReviewHandler.handle(request.params.arguments as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(reviewResult, null, 2)
            }
          ]
        };
        
      case 'get_review_history':
        const history = await getReviewHistoryHandler.handle(request.params.arguments as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(history, null, 2)
            }
          ]
        };
        
      case 'mark_review_complete':
        const result = await markReviewCompleteHandler.handle(request.params.arguments as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
        
      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      ],
      isError: true
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Claude Reviewer server started');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});