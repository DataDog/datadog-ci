require('dd-trace').init({
  startupLogs: false,
  logLevel: 'debug',
  debug: true,
})

module.exports = require('jest-environment-node')
