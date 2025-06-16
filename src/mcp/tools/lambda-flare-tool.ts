/**
 * Lambda Flare MCP Tool
 *
 * MCP tool implementation for Lambda flare functionality.
 * This tool wraps the existing Lambda flare logic and exposes it through the MCP protocol.
 *
 * @author Ryan Strat
 */

import * as fs from 'fs'
import {promisify} from 'util'

import {OutputLogEvent} from '@aws-sdk/client-cloudwatch-logs'
import {FunctionConfiguration, LambdaClient, LambdaClientConfig} from '@aws-sdk/client-lambda'
import * as upath from 'upath'

import {
  AWS_DEFAULT_REGION_ENV_VAR,
  LAMBDA_PROJECT_FILES,
  EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
} from '../../commands/lambda/constants'
import {getAllLogs, getTags, getFramework} from '../../commands/lambda/flare'
import {
  getAWSCredentials,
  getLambdaFunctionConfig,
  getLayerNameWithVersion,
  getRegion,
  maskConfig,
} from '../../commands/lambda/functions/commons'
import {createMCPError, validateParameters, validateFunctionName} from '../../commands/lambda/mcp-helpers'
import {getProjectFiles, validateStartEndFlags} from '../../helpers/flare'
import {formatBytes} from '../../helpers/utils'
import {version} from '../../helpers/version'

import {
  MCPTool,
  MCPToolCallParams,
  MCPToolCallResponse,
  LambdaFlareToolParams,
  LambdaFlareToolResult,
  LambdaFlareData,
  LambdaFlareProjectFile,
  LambdaFlareInsights,
  LambdaFlareErrorCode,
  MCPErrorCode,
} from '../types'

/**
 * Lambda Flare MCP Tool Definition
 */
export const LAMBDA_FLARE_TOOL: MCPTool = {
  name: 'lambda-flare',
  description:
    'Collect diagnostic data from AWS Lambda functions for troubleshooting. Gathers function configuration, tags, CloudWatch logs, and project files.',
  inputSchema: {
    type: 'object',
    properties: {
      functionName: {
        type: 'string',
        description: 'AWS Lambda function name or ARN. Can be either a function name (requires region) or full ARN.',
      },
      region: {
        type: 'string',
        description: 'AWS region where the function is located. Required if functionName is not an ARN.',
      },
      withLogs: {
        type: 'boolean',
        description: 'Whether to include CloudWatch logs in the diagnostic data.',
        default: false,
      },
      start: {
        type: 'number',
        description: 'Start time for log collection (Unix timestamp in milliseconds). Requires end parameter.',
      },
      end: {
        type: 'number',
        description: 'End time for log collection (Unix timestamp in milliseconds). Requires start parameter.',
      },
      dryRun: {
        type: 'boolean',
        description: 'Whether to run in dry-run mode (collect data but do not send to Datadog support).',
        default: true,
      },
      caseId: {
        type: 'string',
        description: 'Datadog support case ID. Required when dryRun is false.',
      },
      email: {
        type: 'string',
        description: 'Email address associated with the support case. Required when dryRun is false.',
      },
    },
    required: ['functionName'],
    additionalProperties: false,
  },
}

/**
 * Executes the Lambda Flare tool
 */
export const executeLambdaFlareTool = async (params: MCPToolCallParams): Promise<MCPToolCallResponse> => {
  try {
    // Validate parameters
    const validation = validateParameters(params.arguments, LAMBDA_FLARE_TOOL.inputSchema)
    if (!validation.valid) {
      throw createMCPError(MCPErrorCode.INVALID_PARAMS, `Invalid parameters: ${validation.errors.join(', ')}`)
    }

    const toolParams = (params.arguments as unknown) as LambdaFlareToolParams

    // Validate function name
    const functionValidation = validateFunctionName(toolParams.functionName)
    if (!functionValidation.valid) {
      throw createMCPError(LambdaFlareErrorCode.INVALID_FUNCTION, functionValidation.error || 'Invalid function name')
    }

    // Collect flare data
    const flareData = await collectLambdaFlareData(toolParams)

    const result: LambdaFlareToolResult = {
      success: true,
      data: flareData,
      dryRun: toolParams.dryRun ?? true,
      warnings: [],
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, undefined, 2),
        },
      ],
    }
  } catch (error) {
    // Handle specific AWS errors
    if (error instanceof Error) {
      const result: LambdaFlareToolResult = {
        success: false,
        error: error.message,
        dryRun: true,
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, undefined, 2),
          },
        ],
        isError: true,
      }
    }

    throw error
  }
}

/**
 * Collects Lambda flare data using existing flare.ts functions
 */
const collectLambdaFlareData = async (params: LambdaFlareToolParams): Promise<LambdaFlareData> => {
  // Validate and get region
  const region = getRegion(params.functionName) ?? params.region ?? process.env[AWS_DEFAULT_REGION_ENV_VAR]
  if (!region) {
    throw new Error('No AWS region specified. Provide region parameter or set AWS_DEFAULT_REGION environment variable.')
  }

  // Validate time range if provided
  let startMillis: number | undefined
  let endMillis: number | undefined
  if (params.start !== undefined || params.end !== undefined) {
    try {
      ;[startMillis, endMillis] = validateStartEndFlags(params.start?.toString(), params.end?.toString())
    } catch (err) {
      throw new Error(`Invalid time range: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // Get AWS credentials
  const credentials = await getAWSCredentials()
  if (!credentials) {
    throw new Error('Unable to obtain AWS credentials')
  }

  // Create Lambda client
  const lambdaClientConfig: LambdaClientConfig = {
    region,
    credentials,
    retryStrategy: EXPONENTIAL_BACKOFF_RETRY_STRATEGY,
  }
  const lambdaClient = new LambdaClient(lambdaClientConfig)

  // Get Lambda function configuration
  let config: FunctionConfiguration
  try {
    config = await getLambdaFunctionConfig(lambdaClient, params.functionName)
  } catch (err) {
    throw new Error(
      `Unable to get Lambda function configuration: ${err instanceof Error ? err.message : 'Unknown error'}`
    )
  }

  // Mask sensitive configuration data
  config = maskConfig(config)

  // Get function tags
  let tags: Record<string, string>
  try {
    tags = await getTags(lambdaClient, region, config.FunctionArn!)
  } catch (err) {
    // Tags are not critical - continue with empty tags if there's an error
    console.warn(`Warning: Could not retrieve function tags: ${err instanceof Error ? err.message : 'Unknown error'}`)
    tags = {}
  }

  // Get project files
  const projectFilePaths = await getProjectFiles(LAMBDA_PROJECT_FILES)
  const projectFiles: LambdaFlareProjectFile[] = []

  for (const filePath of projectFilePaths) {
    try {
      const file = await readFileAsProjectFile(filePath)
      projectFiles.push(file)
    } catch (err) {
      // Continue on file read errors - don't fail the entire operation
      console.warn(
        `Warning: Could not read project file ${filePath}: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    }
  }

  // Get CloudWatch logs if requested
  let logs: Map<string, OutputLogEvent[]> = new Map()
  if (params.withLogs) {
    try {
      logs = await getAllLogs(region, params.functionName, startMillis, endMillis)
    } catch (err) {
      throw new Error(`Unable to get CloudWatch logs: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // Generate insights
  const insights = generateInsights(config, projectFiles.length, 0, logs, Object.keys(tags).length)

  // Convert Map to object for JSON serialization
  const logsObject: Record<string, OutputLogEvent[]> = {}
  for (const [key, value] of logs.entries()) {
    logsObject[key] = value
  }

  return {
    functionConfig: config,
    tags,
    logs: logsObject,
    projectFiles,
    additionalFiles: [], // MCP version doesn't support interactive additional files
    insights,
  }
}

/**
 * Reads a file and converts it to LambdaFlareProjectFile format
 */
const readFileAsProjectFile = async (filePath: string): Promise<LambdaFlareProjectFile> => {
  const stat = await promisify(fs.stat)(filePath)
  const content = await promisify(fs.readFile)(filePath, 'utf-8')

  return {
    path: filePath,
    name: upath.basename(filePath),
    content,
    mimeType: getMimeType(filePath),
    size: stat.size,
  }
}

/**
 * Determines MIME type based on file extension
 */
const getMimeType = (filePath: string): string => {
  const ext = upath.extname(filePath).toLowerCase()

  const mimeTypes: Record<string, string> = {
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
    '.json': 'application/json',
    '.yaml': 'application/x-yaml',
    '.yml': 'application/x-yaml',
    '.py': 'text/x-python',
    '.java': 'text/x-java-source',
    '.go': 'text/x-go',
    '.rb': 'text/x-ruby',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
  }

  return mimeTypes[ext] || 'text/plain'
}

/**
 * Generates insights about the Lambda function and flare data
 */
const generateInsights = (
  config: FunctionConfiguration,
  projectFilesCount: number,
  additionalFilesCount: number,
  logs: Map<string, OutputLogEvent[]>,
  tagsCount: number
): LambdaFlareInsights => {
  // Calculate total log events
  let totalLogEvents = 0
  for (const logEvents of logs.values()) {
    totalLogEvents += logEvents.length
  }

  // Extract layer information
  const layers = config.Layers ?? []
  const layerNames = layers.map((layer) => getLayerNameWithVersion(layer.Arn ?? '')).filter(Boolean) as string[]

  // Calculate total package size
  let totalCodeSize = config.CodeSize ?? 0
  layers.forEach((layer) => {
    totalCodeSize += layer.CodeSize ?? 0
  })

  // Sanitize environment variables
  const envVars = config.Environment?.Variables ?? {}
  const sanitizedEnvVars: Record<string, string> = {}
  for (const [key, value] of Object.entries(envVars)) {
    const lowerKey = key.toLowerCase()
    const isSensitive = ['key', 'secret', 'password', 'token'].some((word) => lowerKey.includes(word))
    sanitizedEnvVars[key] = isSensitive ? '***REDACTED***' : value
  }

  return {
    lambdaConfig: {
      functionName: config.FunctionName ?? 'Unknown',
      functionArn: config.FunctionArn ?? 'Unknown',
      runtime: config.Runtime ?? 'Unknown',
      handler: config.Handler ?? 'Unknown',
      timeout: config.Timeout ?? 0,
      memorySize: config.MemorySize ?? 0,
      architecture: config.Architectures ?? ['Unknown'],
      packageSize: formatBytes(totalCodeSize),
      environmentVariables: sanitizedEnvVars,
      layers: layerNames,
    },
    cliContext: {
      runLocation: process.cwd(),
      cliVersion: version,
      timestamp: new Date().toISOString().replace('T', ' ').replace('Z', '') + ' UTC',
      framework: getFramework(),
    },
    summary: {
      totalProjectFiles: projectFilesCount,
      totalAdditionalFiles: additionalFilesCount,
      totalLogStreams: logs.size,
      totalLogEvents,
      tagsCount,
    },
  }
}
