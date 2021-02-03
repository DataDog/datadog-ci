require('dd-trace').init({
  startupLogs: false,
})

module.exports = require('jest-environment-node')
