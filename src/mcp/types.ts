/**
 * Model Context Protocol (MCP) Type Definitions for Datadog CI
 *
 * This file contains TypeScript type definitions for the MCP server implementation
 * that exposes Datadog CI Lambda Flare functionality as MCP tools.
 *
 * @see https://spec.modelcontextprotocol.io/ - MCP Specification
 * @author Ryan Strat
 */

import {OutputLogEvent} from '@aws-sdk/client-cloudwatch-logs'
import {FunctionConfiguration} from '@aws-sdk/client-lambda'

/**
 * MCP Protocol Version supported by this server
 */
export const MCP_PROTOCOL_VERSION = '2024-11-05'

/**
 * Base MCP message interface following JSON-RPC 2.0 specification
 */
export interface MCPMessage {
  /** JSON-RPC version, always "2.0" */
  jsonrpc: '2.0'
  /** Unique identifier for the request */
  id?: string | number
  /** Method name being called */
  method?: string
  /** Parameters for the method call */
  params?: Record<string, unknown>
  /** Result of a successful method call */
  result?: unknown
  /** Error information if the method call failed */
  error?: MCPError
}

/**
 * MCP Error object following JSON-RPC 2.0 error format
 */
export interface MCPError {
  /** Error code indicating the type of error */
  code: number
  /** Human-readable error message */
  message: string
  /** Additional error data */
  data?: unknown
}

/**
 * MCP Tool definition interface
 */
export interface MCPTool {
  /** Unique identifier for the tool */
  name: string
  /** Human-readable description of what the tool does */
  description: string
  /** JSON Schema defining the tool's input parameters */
  inputSchema: JSONSchema
}

/**
 * JSON Schema interface for tool parameter validation
 */
export interface JSONSchema {
  type: 'object'
  properties: Record<string, JSONSchemaProperty>
  required?: string[]
  additionalProperties?: boolean
}

/**
 * JSON Schema property definition
 */
export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description?: string
  enum?: string[]
  default?: unknown
  items?: JSONSchemaProperty
  format?: string
  minimum?: number
  maximum?: number
}

/**
 * MCP Tool call request parameters
 */
export interface MCPToolCallParams {
  /** Name of the tool to execute */
  name: string
  /** Arguments to pass to the tool */
  arguments: Record<string, unknown>
}

/**
 * MCP Tool call response
 */
export interface MCPToolCallResponse {
  /** Content returned by the tool */
  content: MCPContent[]
  /** Whether the tool call was considered an error */
  isError?: boolean
}

/**
 * MCP Content types that can be returned by tools
 */
export type MCPContent = MCPTextContent | MCPResourceContent

/**
 * Text content type
 */
export interface MCPTextContent {
  type: 'text'
  text: string
}

/**
 * Resource content type (for binary data, files, etc.)
 */
export interface MCPResourceContent {
  type: 'resource'
  resource: {
    uri: string
    mimeType?: string
    text?: string
  }
}

/**
 * Server capabilities that this MCP server supports
 */
export interface MCPServerCapabilities {
  /** Tools that the server provides */
  tools?: {
    /** Whether the server supports listing available tools */
    listChanged?: boolean
  }
  /** Resources that the server provides */
  resources?: {
    /** Whether the server supports listing available resources */
    subscribe?: boolean
    /** Whether the server supports resource list changes */
    listChanged?: boolean
  }
  /** Prompts that the server provides */
  prompts?: {
    /** Whether the server supports listing available prompts */
    listChanged?: boolean
  }
  /** Logging capabilities */
  logging?: Record<string, unknown>
}

/**
 * Server information for MCP handshake
 */
export interface MCPServerInfo {
  /** Server name */
  name: string
  /** Server version */
  version: string
  /** Protocol version supported */
  protocolVersion: string
  /** Server capabilities */
  capabilities: MCPServerCapabilities
}

// ============================================================================
// Lambda Flare Specific Types
// ============================================================================

/**
 * Parameters for the lambda-flare MCP tool
 * Maps to the CLI arguments of `datadog-ci lambda flare`
 */
export interface LambdaFlareToolParams {
  /** Lambda function name or ARN (required) */
  functionName: string
  /** AWS region (optional if function is specified by ARN) */
  region?: string
  /** Whether to include CloudWatch logs */
  withLogs?: boolean
  /** Start time for log collection (Unix timestamp in milliseconds) */
  start?: number
  /** End time for log collection (Unix timestamp in milliseconds) */
  end?: number
  /** Whether to run in dry-run mode (collect data but don't send to Datadog) */
  dryRun?: boolean
  /** Datadog case ID for support ticket */
  caseId?: string
  /** Email associated with the support case */
  email?: string
}

/**
 * Collected Lambda function data from flare operation
 */
export interface LambdaFlareData {
  /** Lambda function configuration */
  functionConfig: FunctionConfiguration
  /** Function tags */
  tags: Record<string, string>
  /** CloudWatch log streams and events */
  logs: Record<string, OutputLogEvent[]>
  /** Project files found in the current directory */
  projectFiles: LambdaFlareProjectFile[]
  /** Additional files specified by the user */
  additionalFiles: LambdaFlareProjectFile[]
  /** Auto-generated insights about the function */
  insights: LambdaFlareInsights
}

/**
 * Represents a project file collected during flare
 */
export interface LambdaFlareProjectFile {
  /** Original file path */
  path: string
  /** File name */
  name: string
  /** File content (base64 encoded for binary files) */
  content: string
  /** MIME type of the file */
  mimeType: string
  /** Size of the file in bytes */
  size: number
}

/**
 * Auto-generated insights about the Lambda function
 */
export interface LambdaFlareInsights {
  /** AWS Lambda configuration summary */
  lambdaConfig: {
    functionName: string
    functionArn: string
    runtime: string
    handler: string
    timeout: number
    memorySize: number
    architecture: string[]
    packageSize: string
    environmentVariables: Record<string, string>
    layers: string[]
  }
  /** CLI execution context */
  cliContext: {
    runLocation: string
    cliVersion: string
    timestamp: string
    framework: string
  }
  /** Summary statistics */
  summary: {
    totalProjectFiles: number
    totalAdditionalFiles: number
    totalLogStreams: number
    totalLogEvents: number
    tagsCount: number
  }
}

/**
 * MCP tool result for lambda-flare
 */
export interface LambdaFlareToolResult {
  /** Whether the operation was successful */
  success: boolean
  /** Collected flare data */
  data?: LambdaFlareData
  /** Error message if operation failed */
  error?: string
  /** Warnings encountered during execution */
  warnings?: string[]
  /** Whether this was a dry run */
  dryRun: boolean
  /** Path where files would be saved (for dry run) */
  outputPath?: string
}

/**
 * Error codes specific to Lambda Flare MCP tool
 */
export enum LambdaFlareErrorCode {
  /** Missing required parameters */
  MISSING_PARAMETERS = -32001,
  /** Invalid function name or ARN */
  INVALID_FUNCTION = -32002,
  /** AWS authentication failed */
  AWS_AUTH_FAILED = -32003,
  /** Function not found */
  FUNCTION_NOT_FOUND = -32004,
  /** Insufficient permissions */
  INSUFFICIENT_PERMISSIONS = -32005,
  /** CloudWatch logs access failed */
  LOGS_ACCESS_FAILED = -32006,
  /** Invalid time range */
  INVALID_TIME_RANGE = -32007,
  /** Datadog API error */
  DATADOG_API_ERROR = -32008,
  /** General AWS error */
  AWS_ERROR = -32009,
  /** Internal server error */
  INTERNAL_ERROR = -32010,
}

/**
 * Standard MCP error codes as defined in the specification
 */
export enum MCPErrorCode {
  /** Parse error */
  PARSE_ERROR = -32700,
  /** Invalid request */
  INVALID_REQUEST = -32600,
  /** Method not found */
  METHOD_NOT_FOUND = -32601,
  /** Invalid parameters */
  INVALID_PARAMS = -32602,
  /** Internal error */
  INTERNAL_ERROR = -32603,
}
