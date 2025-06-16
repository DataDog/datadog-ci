/**
 * Unit tests for Lambda MCP Helper Functions
 *
 * @author Ryan Strat
 */

import {MCPErrorCode, LambdaFlareErrorCode} from '../../../mcp/types'

import {createMCPError, validateParameters, validateFunctionName} from '../mcp-helpers'

describe('Lambda MCP Helpers', () => {
  describe('createMCPError', () => {
    it('should create an MCP error with code and message', () => {
      const error = createMCPError(MCPErrorCode.INVALID_PARAMS, 'Test error message')

      expect(error).toEqual({
        code: MCPErrorCode.INVALID_PARAMS,
        message: 'Test error message',
      })
    })

    it('should create an MCP error with additional data', () => {
      const errorData = {details: 'Additional error details'}
      const error = createMCPError(LambdaFlareErrorCode.AWS_AUTH_FAILED, 'Auth failed', errorData)

      expect(error).toEqual({
        code: LambdaFlareErrorCode.AWS_AUTH_FAILED,
        message: 'Auth failed',
        data: errorData,
      })
    })

    it('should work with Lambda-specific error codes', () => {
      const error = createMCPError(LambdaFlareErrorCode.FUNCTION_NOT_FOUND, 'Function not found')

      expect(error.code).toBe(LambdaFlareErrorCode.FUNCTION_NOT_FOUND)
      expect(error.message).toBe('Function not found')
    })
  })

  describe('validateParameters', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        functionName: {
          type: 'string' as const,
          description: 'Function name',
        },
        region: {
          type: 'string' as const,
          description: 'AWS region',
        },
        withLogs: {
          type: 'boolean' as const,
          description: 'Include logs',
        },
        timeout: {
          type: 'number' as const,
          description: 'Timeout value',
        },
      },
      required: ['functionName'],
      additionalProperties: false,
    }

    it('should validate valid parameters successfully', () => {
      const params = {
        functionName: 'my-function',
        region: 'us-east-1',
        withLogs: true,
        timeout: 30,
      }

      const result = validateParameters(params, schema)

      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('should detect missing required parameters', () => {
      const params = {
        region: 'us-east-1',
      }

      const result = validateParameters(params, schema)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Missing required parameter: functionName')
    })

    it('should validate parameter types correctly', () => {
      const params = {
        functionName: 'my-function',
        region: 123, // Wrong type
        withLogs: 'true', // Wrong type
        timeout: 'thirty', // Wrong type
      }

      const result = validateParameters(params, schema)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Parameter region must be a string')
      expect(result.errors).toContain('Parameter withLogs must be a boolean')
      expect(result.errors).toContain('Parameter timeout must be a number')
    })

    it('should handle undefined and missing optional parameters', () => {
      const params = {
        functionName: 'my-function',
        region: undefined,
      }

      const result = validateParameters(params, schema)

      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('should handle empty schema requirements', () => {
      const emptySchema = {
        type: 'object' as const,
        properties: {},
        additionalProperties: false,
      }

      const result = validateParameters({}, emptySchema)

      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })
  })

  describe('validateFunctionName', () => {
    it('should validate a simple function name', () => {
      const result = validateFunctionName('my-lambda-function')

      expect(result.valid).toBe(true)
      expect(result.isArn).toBe(false)
      expect(result.error).toBeUndefined()
      expect(result.region).toBeUndefined()
    })

    it('should validate function names with hyphens and underscores', () => {
      const result = validateFunctionName('my-function_name-123')

      expect(result.valid).toBe(true)
      expect(result.isArn).toBe(false)
    })

    it('should validate a complete Lambda ARN', () => {
      const arn = 'arn:aws:lambda:us-east-1:123456789012:function:my-function'
      const result = validateFunctionName(arn)

      expect(result.valid).toBe(true)
      expect(result.isArn).toBe(true)
      expect(result.region).toBe('us-east-1')
      expect(result.error).toBeUndefined()
    })

    it('should validate a Lambda ARN with qualifier', () => {
      const arn = 'arn:aws:lambda:us-west-2:123456789012:function:my-function:LATEST'
      const result = validateFunctionName(arn)

      expect(result.valid).toBe(true)
      expect(result.isArn).toBe(true)
      expect(result.region).toBe('us-west-2')
    })

    it('should reject empty function names', () => {
      const result = validateFunctionName('')

      expect(result.valid).toBe(false)
      expect(result.isArn).toBe(false)
      expect(result.error).toBe('Function name cannot be empty')
    })

    it('should reject whitespace-only function names', () => {
      const result = validateFunctionName('   ')

      expect(result.valid).toBe(false)
      expect(result.isArn).toBe(false)
      expect(result.error).toBe('Function name cannot be empty')
    })

    it('should reject malformed ARNs', () => {
      const badArn = 'arn:aws:lambda:us-east-1:invalid:function'
      const result = validateFunctionName(badArn)

      expect(result.valid).toBe(false)
      expect(result.isArn).toBe(true)
      expect(result.error).toBe('Invalid Lambda function ARN format')
    })

    it('should reject ARNs without region', () => {
      const badArn = 'arn:aws:lambda::123456789012:function:my-function'
      const result = validateFunctionName(badArn)

      expect(result.valid).toBe(false)
      expect(result.isArn).toBe(true)
      expect(result.error).toBe('Invalid Lambda function ARN format')
    })

    it('should reject ARNs with wrong service', () => {
      const badArn = 'arn:aws:s3:us-east-1:123456789012:function:my-function'
      const result = validateFunctionName(badArn)

      expect(result.valid).toBe(true) // This would pass as a simple function name, not treated as ARN
      expect(result.isArn).toBe(false)
    })
  })
})
