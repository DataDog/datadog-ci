if (process.env.CI) {
  require('dd-trace').init({
    startupLogs: false,
    debug: true,
    logLevel: 'error',
  })
}

module.exports = require('jest-environment-node')
