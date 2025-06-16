# Datadog CI MCP Integration

This document describes the Model Context Protocol (MCP) integration for Datadog CI, which exposes Lambda flare functionality as MCP tools for AI systems.

## Overview

The MCP integration allows AI systems like Claude to directly access Datadog CI's Lambda troubleshooting capabilities through a standardized protocol. This enables AI assistants to help debug Lambda functions by collecting diagnostic data programmatically.

## Architecture

```
AI System (Claude) → MCP Client → MCP Server (datadog-ci-mcp) → AWS Lambda APIs
```

### Components

- **MCP Server** (`src/mcp/server.ts`): Main server implementing the MCP protocol
- **Lambda Flare Tool** (`src/mcp/tools/lambda-flare-tool.ts`): MCP tool wrapping Lambda flare functionality
- **Type Definitions** (`src/mcp/types.ts`): TypeScript types for MCP protocol and Lambda flare data
- **Helper Functions** (`src/commands/lambda/mcp-helpers.ts`): Lambda-specific utilities for MCP

## Installation

### Prerequisites

- Node.js 18 or higher
- AWS credentials configured
- Datadog API key (optional, for sending data to Datadog support)

### Setup

1. **Install Datadog CI with MCP support:**
   ```bash
   npm install -g @datadog/datadog-ci
   ```

2. **Configure AWS credentials:**
   ```bash
   aws configure
   # OR set environment variables
   export AWS_ACCESS_KEY_ID=your-access-key
   export AWS_SECRET_ACCESS_KEY=your-secret-key
   export AWS_DEFAULT_REGION=us-east-1
   ```

3. **Optional: Set Datadog API key:**
   ```bash
   export DATADOG_API_KEY=your-datadog-api-key
   ```

## Usage

### Starting the MCP Server

The MCP server can be started in multiple ways:

1. **Standalone executable:**
   ```bash
   datadog-ci-mcp
   ```

2. **Via main CLI with flag:**
   ```bash
   datadog-ci --mcp-server
   ```

3. **Programmatically:**
   ```typescript
   import {createMCPServer} from '@datadog/datadog-ci/mcp/server'
   
   const server = await createMCPServer()
   ```

### MCP Client Configuration

For Claude Desktop, add the following to your MCP configuration:

```json
{
  "mcpServers": {
    "datadog-ci": {
      "command": "datadog-ci-mcp",
      "args": []
    }
  }
}
```

## Available Tools

### lambda-flare

Collects diagnostic data from AWS Lambda functions for troubleshooting.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `functionName` | string | Yes | Lambda function name or ARN |
| `region` | string | No* | AWS region (*required if functionName is not an ARN) |
| `withLogs` | boolean | No | Include CloudWatch logs (default: false) |
| `start` | number | No | Start time for logs (Unix timestamp in ms) |
| `end` | number | No | End time for logs (Unix timestamp in ms) |
| `dryRun` | boolean | No | Dry run mode (default: true) |
| `caseId` | string | No** | Datadog support case ID (**required when dryRun is false) |
| `email` | string | No** | Email for support case (**required when dryRun is false) |

#### Example Usage

```typescript
// Basic flare collection
{
  "functionName": "my-lambda-function",
  "region": "us-east-1",
  "dryRun": true
}

// With CloudWatch logs
{
  "functionName": "arn:aws:lambda:us-east-1:123456789012:function:my-function",
  "withLogs": true,
  "dryRun": true
}

// Specific time range
{
  "functionName": "my-lambda-function",
  "region": "us-west-2",
  "withLogs": true,
  "start": 1640995200000,
  "end": 1641081600000,
  "dryRun": true
}
```

#### Response Format

The tool returns a JSON object with the following structure:

```typescript
{
  "success": boolean,
  "data": {
    "functionConfig": { /* Lambda function configuration */ },
    "tags": { /* Function tags */ },
    "logs": { /* CloudWatch logs by stream */ },
    "projectFiles": [ /* Project files found */ ],
    "insights": {
      "lambdaConfig": { /* Summary of Lambda config */ },
      "cliContext": { /* CLI execution context */ },
      "summary": { /* Statistics */ }
    }
  },
  "dryRun": boolean,
  "warnings": [ /* Any warnings */ ]
}
```

## Required AWS Permissions

The MCP server requires the following AWS IAM permissions:

### Required
- `lambda:GetFunction` - Get Lambda function configuration
- `lambda:ListTags` - Get function tags

### Optional (for log collection)
- `logs:DescribeLogStreams` - List CloudWatch log streams
- `logs:GetLogEvents` - Retrieve log events

### Example IAM Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:GetFunction",
        "lambda:ListTags"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:DescribeLogStreams",
        "logs:GetLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/aws/lambda/*"
    }
  ]
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AWS_REGION` | No | Default AWS region |
| `AWS_DEFAULT_REGION` | No | Alternative to AWS_REGION |
| `DATADOG_API_KEY` | No* | Datadog API key (*required for non-dry-run mode) |
| `DD_API_KEY` | No | Alternative to DATADOG_API_KEY |
| `DEBUG` | No | Enable debug logging |

## Error Handling

The MCP server provides detailed error messages for common issues:

- **AWS Authentication Failed**: Check AWS credentials configuration
- **Function Not Found**: Verify function name/ARN and region
- **Insufficient Permissions**: Review IAM permissions
- **Invalid Time Range**: Check start/end timestamps
- **Logs Access Failed**: Verify CloudWatch permissions

## Troubleshooting

### Common Issues

1. **"No AWS region specified"**
   - Set `region` parameter or `AWS_DEFAULT_REGION` environment variable

2. **"Unable to obtain AWS credentials"**
   - Configure AWS credentials via `aws configure` or environment variables

3. **"Function not found"**
   - Verify function name/ARN spelling and region
   - Check if function exists in the specified region

4. **"Access denied"**
   - Ensure IAM permissions are properly configured
   - Check if credentials have access to the specific function

### Debug Mode

Enable debug logging by setting the `DEBUG` environment variable:

```bash
DEBUG=1 datadog-ci-mcp
```

## Security Considerations

- The MCP server runs locally and uses your AWS credentials
- Sensitive data in environment variables is automatically redacted
- All communication uses the secure MCP protocol over stdio
- Dry-run mode is enabled by default to prevent accidental data transmission

## Development

### Building

```bash
yarn build
yarn build:mcp
```

### Testing

```bash
yarn test
```

### Local Development

```bash
# Build and run
yarn build
./dist/mcp-server.js

# Or use ts-node for development
npx ts-node src/mcp-server.ts
```

## Contributing

When contributing to the MCP integration:

1. Follow existing code patterns and TypeScript conventions
2. Update type definitions in `src/mcp/types.ts`
3. Add comprehensive error handling
4. Include JSDoc documentation
5. Update this documentation for any API changes

## References

- [Model Context Protocol Specification](https://spec.modelcontextprotocol.io/)
- [Datadog CI Documentation](https://docs.datadoghq.com/developers/integrations/datadog_ci/)
- [AWS Lambda Troubleshooting](https://docs.datadoghq.com/serverless/troubleshooting/)