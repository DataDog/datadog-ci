#!/usr/bin/env node

/**
 * Make MCP Server Executable
 * 
 * This script makes the compiled MCP server executable by adding a shebang line.
 * It's run as part of the build process to ensure the MCP server can be executed directly.
 */

const fs = require('fs')
const path = require('path')

const mcpServerPath = path.join(__dirname, '..', 'dist', 'mcp-server.js')

if (fs.existsSync(mcpServerPath)) {
  const content = fs.readFileSync(mcpServerPath, 'utf8')
  
  // Add shebang if not present
  if (!content.startsWith('#!')) {
    const newContent = '#!/usr/bin/env node\n' + content
    fs.writeFileSync(mcpServerPath, newContent, 'utf8')
    
    // Make executable on Unix systems
    if (process.platform !== 'win32') {
      fs.chmodSync(mcpServerPath, '755')
    }
    
    console.log('✅ Made mcp-server.js executable')
  } else {
    console.log('✅ mcp-server.js is already executable')
  }
} else {
  console.warn('⚠️  mcp-server.js not found, skipping executable setup')
}