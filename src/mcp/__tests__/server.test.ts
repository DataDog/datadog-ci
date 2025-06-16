/**
 * Integration tests for MCP Server
 *
 * @author Ryan Strat
 */

import {DatadogCIMCPServer, createMCPServer} from '../server'
import {LAMBDA_FLARE_TOOL} from '../tools/lambda-flare-tool'

// Mock the MCP SDK
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}))

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(),
}))

jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: 'list-tools',
  CallToolRequestSchema: 'call-tool',
  ErrorCode: {
    InternalError: -32603,
    MethodNotFound: -32601,
  },
  McpError: jest.fn().mockImplementation((code, message) => ({
    code,
    message,
    name: 'McpError',
  })),
}))

// Mock the lambda flare tool
jest.mock('../tools/lambda-flare-tool', () => ({
  LAMBDA_FLARE_TOOL: {
    name: 'lambda-flare',
    description: 'Test lambda flare tool',
    inputSchema: {type: 'object'},
  },
  executeLambdaFlareTool: jest.fn(),
}))

const mockExecuteLambdaFlareTool = require('../tools/lambda-flare-tool').executeLambdaFlareTool

describe('DatadogCIMCPServer', () => {
  let server: DatadogCIMCPServer
  let mockInternalServer: any
  let mockTransport: any

  beforeEach(() => {
    jest.clearAllMocks()

    const {Server} = require('@modelcontextprotocol/sdk/server/index.js')
    const {StdioServerTransport} = require('@modelcontextprotocol/sdk/server/stdio.js')

    mockInternalServer = {
      setRequestHandler: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    }

    mockTransport = {
      connect: jest.fn(),
    }

    Server.mockImplementation(() => mockInternalServer)
    StdioServerTransport.mockImplementation(() => mockTransport)

    server = new DatadogCIMCPServer()
  })

  describe('constructor', () => {
    it('should create server instance without initializing MCP components', () => {
      const {Server} = require('@modelcontextprotocol/sdk/server/index.js')

      // Server should not be called in constructor since we use lazy initialization
      expect(Server).not.toHaveBeenCalled()
      expect(mockInternalServer.setRequestHandler).not.toHaveBeenCalled()
    })
  })

  describe('request handlers', () => {
    let listToolsHandler: () => Promise<unknown>
    let callToolHandler: (request: any) => Promise<unknown>

    beforeEach(async () => {
      // Initialize the server to set up handlers
      await server.start()

      const calls = mockInternalServer.setRequestHandler.mock.calls
      listToolsHandler = calls.find((call: any) => call[0] === 'list-tools')?.[1]
      callToolHandler = calls.find((call: any) => call[0] === 'call-tool')?.[1]
    })

    describe('list tools handler', () => {
      it('should return available tools', async () => {
        const result = await listToolsHandler()

        expect(result).toEqual({
          tools: [LAMBDA_FLARE_TOOL],
        })
      })
    })

    describe('call tool handler', () => {
      it('should execute lambda-flare tool successfully', async () => {
        const mockResult = {
          content: [{type: 'text', text: 'Test result'}],
          isError: false,
        }
        mockExecuteLambdaFlareTool.mockResolvedValue(mockResult)

        const request = {
          params: {
            name: 'lambda-flare',
            arguments: {functionName: 'test-function'},
          },
        }

        const result = await callToolHandler(request)

        expect(mockExecuteLambdaFlareTool).toHaveBeenCalledWith({
          name: 'lambda-flare',
          arguments: {functionName: 'test-function'},
        })
        expect(result).toEqual({
          content: mockResult.content,
          isError: mockResult.isError,
        })
      })

      it('should handle tool execution errors', async () => {
        mockExecuteLambdaFlareTool.mockRejectedValue(new Error('Tool execution failed'))

        const {McpError, ErrorCode} = require('@modelcontextprotocol/sdk/types.js')

        const request = {
          params: {
            name: 'lambda-flare',
            arguments: {functionName: 'test-function'},
          },
        }

        await expect(callToolHandler(request)).rejects.toEqual(
          new McpError(ErrorCode.InternalError, 'Lambda flare tool execution failed: Tool execution failed')
        )
      })

      it('should handle unknown tool names', async () => {
        const {McpError, ErrorCode} = require('@modelcontextprotocol/sdk/types.js')

        const request = {
          params: {
            name: 'unknown-tool',
            arguments: {},
          },
        }

        await expect(callToolHandler(request)).rejects.toEqual(
          new McpError(ErrorCode.MethodNotFound, 'Unknown tool: unknown-tool')
        )
      })

      it('should handle missing arguments', async () => {
        const mockResult = {
          content: [{type: 'text', text: 'Test result'}],
          isError: false,
        }
        mockExecuteLambdaFlareTool.mockResolvedValue(mockResult)

        const request = {
          params: {
            name: 'lambda-flare',
            // arguments is missing
          },
        }

        const result = await callToolHandler(request)

        expect(mockExecuteLambdaFlareTool).toHaveBeenCalledWith({
          name: 'lambda-flare',
          arguments: {},
        })
        expect(result).toEqual({
          content: mockResult.content,
          isError: mockResult.isError,
        })
      })
    })
  })

  describe('start', () => {
    it('should initialize server, set up handlers, and connect to stdio transport', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      const {Server} = require('@modelcontextprotocol/sdk/server/index.js')

      await server.start()

      // Check that server was created with correct configuration
      expect(Server).toHaveBeenCalledWith(
        {
          name: 'datadog-ci-mcp-server',
          version: expect.any(String),
        },
        {
          capabilities: {
            tools: {},
          },
        }
      )

      // Check that request handlers were set up
      expect(mockInternalServer.setRequestHandler).toHaveBeenCalledTimes(2)
      expect(mockInternalServer.setRequestHandler).toHaveBeenCalledWith('list-tools', expect.any(Function))
      expect(mockInternalServer.setRequestHandler).toHaveBeenCalledWith('call-tool', expect.any(Function))

      // Check that transport was connected
      expect(mockInternalServer.connect).toHaveBeenCalledWith(mockTransport)

      // Check startup logs
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Datadog CI MCP Server'))
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Protocol version:'))
      expect(consoleSpy).toHaveBeenCalledWith('Available tools: lambda-flare')

      consoleSpy.mockRestore()
    })
  })

  describe('stop', () => {
    it('should close the server connection if initialized', async () => {
      // First start the server to initialize it
      await server.start()

      await server.stop()

      expect(mockInternalServer.close).toHaveBeenCalled()
    })

    it('should handle stop without initialization gracefully', async () => {
      // Don't start the server first
      await expect(server.stop()).resolves.not.toThrow()

      // Should not try to close uninitialized server
      expect(mockInternalServer.close).not.toHaveBeenCalled()
    })
  })
})

describe('createMCPServer', () => {
  it('should create and start a new server instance', async () => {
    const server = await createMCPServer()

    expect(server).toBeInstanceOf(DatadogCIMCPServer)
    // Server start is tested in the DatadogCIMCPServer tests above
  })
})

// Note: The main function tests are complex due to process mocking
// In a real environment, these would be integration tests
describe('main function integration', () => {
  it('should be properly exported', () => {
    const {main} = require('../server')
    expect(typeof main).toBe('function')
  })
})
