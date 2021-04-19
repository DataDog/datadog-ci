require('dd-trace').init({
  startupLogs: false,
  enabled: !!process.env.CI,
  debug: true,
  logLevel: 'error',
})

module.exports = require('jest-environment-node')
