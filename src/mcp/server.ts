/**
 * Datadog CI MCP Server
 *
 * Model Context Protocol server implementation for Datadog CI.
 * Exposes Lambda flare functionality as MCP tools for AI systems.
 *
 * @author Ryan Strat
 */

import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError} from '@modelcontextprotocol/sdk/types.js'

import {version} from '../helpers/version'

import {LAMBDA_FLARE_TOOL, executeLambdaFlareTool} from './tools/lambda-flare-tool'
import {MCP_PROTOCOL_VERSION, MCPToolCallParams} from './types'

/**
 * Datadog CI MCP Server
 *
 * This server provides MCP tools for Datadog CI functionality, starting with Lambda flare.
 * It follows the MCP specification and uses JSON-RPC 2.0 for communication.
 */
export class DatadogCIMCPServer {
  private server: Server

  constructor() {
    this.server = new Server(
      {
        name: 'datadog-ci-mcp-server',
        version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    )

    this.setupHandlers()
  }

  /**
   * Starts the MCP server with stdio transport
   */
  public async start(): Promise<void> {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)

    // Log server start
    console.error(`Datadog CI MCP Server v${version} started`)
    console.error(`Protocol version: ${MCP_PROTOCOL_VERSION}`)
    console.error('Available tools: lambda-flare')
  }

  /**
   * Stops the MCP server
   */
  public async stop(): Promise<void> {
    await this.server.close()
  }

  /**
   * Sets up MCP request handlers
   */
  private setupHandlers(): void {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [LAMBDA_FLARE_TOOL],
      }
    })

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const {name, arguments: args} = request.params

      switch (name) {
        case 'lambda-flare':
          try {
            const params: MCPToolCallParams = {
              name,
              arguments: args || {},
            }
            const result = await executeLambdaFlareTool(params)

            return {
              content: result.content,
              isError: result.isError,
            }
          } catch (error) {
            if (error instanceof Error) {
              throw new McpError(ErrorCode.InternalError, `Lambda flare tool execution failed: ${error.message}`)
            }
            throw new McpError(ErrorCode.InternalError, 'Lambda flare tool execution failed with unknown error')
          }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
      }
    })
  }
}

/**
 * Creates and starts a new Datadog CI MCP server instance
 */
export const createMCPServer = async (): Promise<DatadogCIMCPServer> => {
  const server = new DatadogCIMCPServer()
  await server.start()

  return server
}

/**
 * Main entry point for the MCP server
 * This function is called when the server is started as a standalone process
 */
export const main = async (): Promise<void> => {
  try {
    const server = await createMCPServer()

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.error('Received SIGINT, shutting down gracefully...')
      void server.stop().then(() => process.exit(0))
    })

    process.on('SIGTERM', () => {
      console.error('Received SIGTERM, shutting down gracefully...')
      void server.stop().then(() => process.exit(0))
    })

    // Keep the process alive
    process.stdin.resume()
  } catch (error) {
    console.error('Failed to start MCP server:', error)
    process.exit(1)
  }
}

// Run the server if this file is executed directly
if (require.main === module) {
  void main().catch((error) => {
    console.error('Unhandled error:', error)
    process.exit(1)
  })
}
