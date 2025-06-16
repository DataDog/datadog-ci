/**
 * Datadog CI MCP Server
 *
 * Model Context Protocol server implementation for Datadog CI.
 * Exposes Lambda flare functionality as MCP tools for AI systems.
 *
 * @author Ryan Strat
 */

import {version} from '../helpers/version'

import {LAMBDA_FLARE_TOOL, executeLambdaFlareTool} from './tools/lambda-flare-tool'
import {MCP_PROTOCOL_VERSION, MCPToolCallParams} from './types'

// Dynamic imports to avoid ESLint import resolution issues with ES modules
let Server: any
let StdioServerTransport: any
let CallToolRequestSchema: any
let ListToolsRequestSchema: any
let ErrorCode: any
let McpError: any

/**
 * Datadog CI MCP Server
 *
 * This server provides MCP tools for Datadog CI functionality, starting with Lambda flare.
 * It follows the MCP specification and uses JSON-RPC 2.0 for communication.
 */
export class DatadogCIMCPServer {
  private server: any
  private initialized = false

  constructor() {
    // Server will be initialized in the init method
  }

  /**
   * Starts the MCP server with stdio transport
   */
  public async start(): Promise<void> {
    this.init()

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
    if (this.initialized && this.server) {
      await this.server.close()
    }
  }

  /**
   * Initialize the MCP server with dynamic imports
   */
  private init(): void {
    if (this.initialized) {
      return
    }

    // Use require to work around ESLint import resolution issues with ES modules
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const serverModule = require('@modelcontextprotocol/sdk/server/index.js')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const stdioModule = require('@modelcontextprotocol/sdk/server/stdio.js')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const typesModule = require('@modelcontextprotocol/sdk/types.js')

    Server = serverModule.Server
    StdioServerTransport = stdioModule.StdioServerTransport
    CallToolRequestSchema = typesModule.CallToolRequestSchema
    ListToolsRequestSchema = typesModule.ListToolsRequestSchema
    ErrorCode = typesModule.ErrorCode
    McpError = typesModule.McpError

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
    this.initialized = true
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
    this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
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
