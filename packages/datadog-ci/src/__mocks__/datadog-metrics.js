const metrics = require('datadog-metrics')

const BufferedMetricsLogger = metrics.BufferedMetricsLogger

function NullReporter() {}
NullReporter.prototype.report = jest.fn((metrics, onSuccess, onError) => {
  if (typeof onSuccess === 'function') {
    onSuccess()
  }
})

function NullBufferedMetricsLogger(opts = {}) {
  BufferedMetricsLogger.call(this, {...opts, reporter: new NullReporter()})
}
NullBufferedMetricsLogger.prototype = Object.create(BufferedMetricsLogger.prototype)
NullBufferedMetricsLogger.prototype.constructor = NullBufferedMetricsLogger

module.exports = metrics
module.exports.BufferedMetricsLogger = NullBufferedMetricsLogger
