require('dd-trace').init({
  startupLogs: false,
  enabled: !!process.env.CI,
})

module.exports = require('jest-environment-node')
