/**
 * Lambda MCP Helper Functions
 *
 * Lambda-specific helper functions for MCP server integration.
 * These functions support the MCP tool implementation for lambda flare.
 *
 * @author Ryan Strat
 */

import {MCPError, MCPErrorCode, LambdaFlareErrorCode, JSONSchema} from '../../mcp/types'

/**
 * Creates a standardized MCP error object
 */
export const createMCPError = (
  code: MCPErrorCode | LambdaFlareErrorCode,
  message: string,
  data?: unknown
): MCPError => {
  const error: MCPError = {
    code,
    message,
  }
  if (data) {
    error.data = data
  }

  return error
}

/**
 * Validates parameters against a JSON schema
 */
export const validateParameters = (
  params: Record<string, unknown>,
  schema: JSONSchema
): {
  valid: boolean
  errors: string[]
} => {
  const errors: string[] = []

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in params) || params[field] === undefined) {
        errors.push(`Missing required parameter: ${field}`)
      }
    }
  }

  // Basic type validation for each property
  for (const [key, value] of Object.entries(params)) {
    const propertySchema = schema.properties[key]
    if (!propertySchema || value === undefined) {
      continue
    }

    // Type validation
    switch (propertySchema.type) {
      case 'string':
        if (typeof value !== 'string') {
          errors.push(`Parameter ${key} must be a string`)
        }
        break
      case 'number':
        if (typeof value !== 'number' || isNaN(value)) {
          errors.push(`Parameter ${key} must be a number`)
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push(`Parameter ${key} must be a boolean`)
        }
        break
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validates Lambda function name or ARN format
 */
export const validateFunctionName = (
  functionName: string
): {
  valid: boolean
  error?: string
  isArn: boolean
  region?: string
} => {
  if (!functionName || functionName.trim().length === 0) {
    return {
      valid: false,
      error: 'Function name cannot be empty',
      isArn: false,
    }
  }

  // Check if it's an ARN
  if (functionName.startsWith('arn:aws:lambda:')) {
    const arnPattern = /^arn:aws:lambda:([^:]+):(\d+):function:([^:]+)(?::([^:]+))?$/
    const match = functionName.match(arnPattern)

    if (!match) {
      return {
        valid: false,
        error: 'Invalid Lambda function ARN format',
        isArn: true,
      }
    }

    return {
      valid: true,
      isArn: true,
      region: match[1],
    }
  }

  return {
    valid: true,
    isArn: false,
  }
}
