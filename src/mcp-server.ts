#!/usr/bin/env node

/**
 * Datadog CI MCP Server Executable
 *
 * Entry point for the Datadog CI Model Context Protocol server.
 * This executable can be run standalone to provide MCP tools for Datadog CI functionality.
 *
 * Usage:
 *   datadog-ci-mcp
 *
 * The server communicates via stdio and follows the MCP specification.
 *
 * @author Ryan Strat
 */

import {main} from './mcp/server'

// Enable TypeScript source map support for better error reporting
import 'source-map-support/register'

// Run the MCP server
main().catch((error: unknown) => {
  console.error('Fatal error starting Datadog CI MCP server:', error)
  process.exit(1)
})
