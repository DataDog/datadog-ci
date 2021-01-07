require('dd-trace').init({
  logLevel: 'debug',
  debug: true,
})

module.exports = require('jest-environment-node')
