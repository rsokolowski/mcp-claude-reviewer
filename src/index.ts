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
import { createLogger } from './logger.js';
import { loadConfig } from './config.js';

// Get working directory from MCP client or use current directory
const workingDir = process.env.MCP_CLIENT_CWD || process.cwd();
const config = loadConfig(workingDir);
const logger = createLogger('server', config.logging, workingDir);

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

server.setRequestHandler(ListToolsRequestSchema, async () => {
  logger.info('ListTools request received', { toolCount: tools.length });
  logger.debug('Tools being returned', { 
    tools: tools.map(t => ({ name: t.name, description: t.description?.substring(0, 50) }))
  });
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  logger.info(`Tool called: ${toolName}`, { arguments: request.params.arguments });
  
  try {
    switch (toolName) {
      case 'request_review':
        const reviewResult = await requestReviewHandler.handle(request.params.arguments as any);
        logger.info('Review completed', { 
          reviewId: reviewResult.review_id,
          status: reviewResult.status,
          assessment: reviewResult.overall_assessment 
        });
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
        logger.debug('Review history retrieved', { 
          count: Array.isArray(history) ? history.length : 1 
        });
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
        logger.info('Review marked complete', request.params.arguments);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
        
      default:
        logger.warn(`Unknown tool requested: ${toolName}`);
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    logger.error(`Tool execution failed: ${toolName}`, error);
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
  logger.info('MCP Claude Reviewer server started');
}

main().catch((error) => {
  logger.error('Server startup failed', error);
  process.exit(1);
});