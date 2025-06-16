/**
 * Unit tests for Lambda Flare MCP Tool
 *
 * @author Ryan Strat
 */

import {executeLambdaFlareTool, LAMBDA_FLARE_TOOL} from '../lambda-flare-tool'

// Mock AWS SDK and other dependencies
jest.mock('@aws-sdk/client-lambda')
jest.mock('@aws-sdk/client-cloudwatch-logs')
jest.mock('../../../commands/lambda/functions/commons')
jest.mock('../../../commands/lambda/flare')
jest.mock('../../../helpers/flare')

const mockGetAWSCredentials = jest.fn()
const mockGetLambdaFunctionConfig = jest.fn()
const mockGetTags = jest.fn()
const mockGetAllLogs = jest.fn()
const mockGetProjectFiles = jest.fn()
const mockValidateStartEndFlags = jest.fn()
const mockMaskConfig = jest.fn()

// Setup mocks
beforeEach(() => {
  jest.clearAllMocks()

  // Mock the imported functions
  require('../../../commands/lambda/functions/commons').getAWSCredentials = mockGetAWSCredentials
  require('../../../commands/lambda/functions/commons').getLambdaFunctionConfig = mockGetLambdaFunctionConfig
  require('../../../commands/lambda/functions/commons').maskConfig = mockMaskConfig
  require('../../../commands/lambda/functions/commons').getRegion = jest.fn().mockReturnValue('us-east-1')
  require('../../../commands/lambda/flare').getTags = mockGetTags
  require('../../../commands/lambda/flare').getAllLogs = mockGetAllLogs
  require('../../../commands/lambda/flare').getFramework = jest.fn().mockReturnValue('Unknown')
  require('../../../helpers/flare').getProjectFiles = mockGetProjectFiles
  require('../../../helpers/flare').validateStartEndFlags = mockValidateStartEndFlags

  // Setup default successful mocks
  mockGetAWSCredentials.mockResolvedValue({
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
  })

  mockGetLambdaFunctionConfig.mockResolvedValue({
    FunctionName: 'test-function',
    FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    Runtime: 'nodejs18.x',
    Handler: 'index.handler',
    CodeSize: 1024,
    Timeout: 30,
    MemorySize: 128,
    Environment: {
      Variables: {
        NODE_ENV: 'production',
        API_KEY: 'secret-key',
      },
    },
    Layers: [],
    Architectures: ['x86_64'],
  })

  mockMaskConfig.mockImplementation((config) => config)
  mockGetTags.mockResolvedValue({environment: 'test', team: 'backend'})
  mockGetAllLogs.mockResolvedValue(new Map())
  mockGetProjectFiles.mockResolvedValue(new Set())
})

describe('Lambda Flare MCP Tool', () => {
  describe('LAMBDA_FLARE_TOOL definition', () => {
    it('should have correct tool metadata', () => {
      expect(LAMBDA_FLARE_TOOL.name).toBe('lambda-flare')
      expect(LAMBDA_FLARE_TOOL.description).toContain('Collect diagnostic data from AWS Lambda functions')
      expect(LAMBDA_FLARE_TOOL.inputSchema.type).toBe('object')
      expect(LAMBDA_FLARE_TOOL.inputSchema.required).toContain('functionName')
    })

    it('should have correct parameter schema', () => {
      const schema = LAMBDA_FLARE_TOOL.inputSchema

      expect(schema.properties.functionName).toEqual({
        type: 'string',
        description: 'AWS Lambda function name or ARN. Can be either a function name (requires region) or full ARN.',
      })

      expect(schema.properties.withLogs).toEqual({
        type: 'boolean',
        description: 'Whether to include CloudWatch logs in the diagnostic data.',
        default: false,
      })

      expect(schema.properties.dryRun).toEqual({
        type: 'boolean',
        description: 'Whether to run in dry-run mode (collect data but do not send to Datadog support).',
        default: true,
      })
    })
  })

  describe('executeLambdaFlareTool', () => {
    it('should successfully execute with minimal parameters', async () => {
      const params = {
        name: 'lambda-flare',
        arguments: {
          functionName: 'test-function',
        },
      }

      const result = await executeLambdaFlareTool(params)

      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')

      const responseData = JSON.parse((result.content[0] as any).text)
      expect(responseData.success).toBe(true)
      expect(responseData.dryRun).toBe(true)
      expect(responseData.data).toBeDefined()
      expect(responseData.data.functionConfig.FunctionName).toBe('test-function')
    })

    it('should successfully execute with all parameters', async () => {
      const params = {
        name: 'lambda-flare',
        arguments: {
          functionName: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
          withLogs: true,
          start: Date.now() - 3600000, // 1 hour ago
          end: Date.now(),
          dryRun: false,
          caseId: 'CASE-123',
          email: 'test@example.com',
        },
      }

      mockValidateStartEndFlags.mockReturnValue([params.arguments.start, params.arguments.end])

      const result = await executeLambdaFlareTool(params)

      expect(result.content).toHaveLength(1)
      const responseData = JSON.parse((result.content[0] as any).text)
      expect(responseData.success).toBe(true)
      expect(responseData.dryRun).toBe(false)
      expect(mockGetAllLogs).toHaveBeenCalledWith(
        'us-east-1',
        'arn:aws:lambda:us-east-1:123456789012:function:test-function',
        params.arguments.start,
        params.arguments.end
      )
    })

    it('should handle missing required parameters', async () => {
      const params = {
        name: 'lambda-flare',
        arguments: {
          region: 'us-east-1', // Missing functionName
        },
      }

      // This should throw an error, not return an error result
      await expect(executeLambdaFlareTool(params)).rejects.toMatchObject({
        message: expect.stringContaining('Missing required parameter: functionName'),
      })
    })

    it('should handle invalid function name', async () => {
      const params = {
        name: 'lambda-flare',
        arguments: {
          functionName: '', // Empty function name
        },
      }

      // This should throw an error, not return an error result
      await expect(executeLambdaFlareTool(params)).rejects.toMatchObject({
        message: expect.stringContaining('Function name cannot be empty'),
      })
    })

    it('should handle AWS authentication errors', async () => {
      mockGetAWSCredentials.mockRejectedValue(new Error('No credentials found'))

      const params = {
        name: 'lambda-flare',
        arguments: {
          functionName: 'test-function',
        },
      }

      const result = await executeLambdaFlareTool(params)

      expect(result.isError).toBe(true)
      const responseData = JSON.parse((result.content[0] as any).text)
      expect(responseData.success).toBe(false)
      expect(responseData.error).toContain('No credentials found')
    })

    it('should handle function not found errors', async () => {
      mockGetLambdaFunctionConfig.mockRejectedValue(new Error('Function not found: ResourceNotFoundException'))

      const params = {
        name: 'lambda-flare',
        arguments: {
          functionName: 'nonexistent-function',
        },
      }

      const result = await executeLambdaFlareTool(params)

      expect(result.isError).toBe(true)
      const responseData = JSON.parse((result.content[0] as any).text)
      expect(responseData.success).toBe(false)
      expect(responseData.error).toContain('Function not found')
    })

    it('should handle access denied errors', async () => {
      mockGetLambdaFunctionConfig.mockRejectedValue(new Error('AccessDenied: Insufficient permissions'))

      const params = {
        name: 'lambda-flare',
        arguments: {
          functionName: 'restricted-function',
        },
      }

      const result = await executeLambdaFlareTool(params)

      expect(result.isError).toBe(true)
      const responseData = JSON.parse((result.content[0] as any).text)
      expect(responseData.success).toBe(false)
      expect(responseData.error).toContain('AccessDenied')
    })

    it('should handle invalid time range', async () => {
      mockValidateStartEndFlags.mockImplementation(() => {
        throw new Error('Start time must be before end time')
      })

      const params = {
        name: 'lambda-flare',
        arguments: {
          functionName: 'test-function',
          start: Date.now(),
          end: Date.now() - 3600000, // End before start
        },
      }

      const result = await executeLambdaFlareTool(params)

      expect(result.isError).toBe(true)
      const responseData = JSON.parse((result.content[0] as any).text)
      expect(responseData.success).toBe(false)
      expect(responseData.error).toContain('Invalid time range')
    })

    it('should include CloudWatch logs when requested', async () => {
      const mockLogs = new Map([
        [
          '2024/01/01/[$LATEST]abc123',
          [
            {
              timestamp: Date.now(),
              message: 'START RequestId: test-request-id',
            },
          ],
        ],
      ])
      mockGetAllLogs.mockResolvedValue(mockLogs)

      const params = {
        name: 'lambda-flare',
        arguments: {
          functionName: 'test-function',
          withLogs: true,
        },
      }

      const result = await executeLambdaFlareTool(params)

      const responseData = JSON.parse((result.content[0] as any).text)
      expect(responseData.success).toBe(true)
      // logs is serialized as an object, not a Map
      expect(Object.keys(responseData.data.logs).length).toBe(1)
      expect(mockGetAllLogs).toHaveBeenCalledWith('us-east-1', 'test-function', undefined, undefined)
    })

    it('should sanitize environment variables', async () => {
      const params = {
        name: 'lambda-flare',
        arguments: {
          functionName: 'test-function',
        },
      }

      const result = await executeLambdaFlareTool(params)

      const responseData = JSON.parse((result.content[0] as any).text)
      expect(responseData.data.insights.lambdaConfig.environmentVariables).toEqual({
        NODE_ENV: 'production',
        API_KEY: '***REDACTED***', // Should be redacted because it contains 'key'
      })
    })

    it('should handle tag retrieval errors gracefully', async () => {
      // Mock tags to fail but continue execution
      mockGetTags.mockRejectedValue(new Error('Unable to get tags'))

      // Mock console.warn to avoid test output
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      const params = {
        name: 'lambda-flare',
        arguments: {
          functionName: 'test-function',
        },
      }

      const result = await executeLambdaFlareTool(params)

      const responseData = JSON.parse((result.content[0] as any).text)
      expect(responseData.success).toBe(true)
      expect(responseData.data.tags).toEqual({}) // Empty tags due to error
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Warning: Could not retrieve function tags'))

      consoleSpy.mockRestore()
    })
  })
})
