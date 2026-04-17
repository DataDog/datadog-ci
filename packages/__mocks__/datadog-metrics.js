const metrics = require('datadog-metrics')

const BufferedMetricsLogger = metrics.BufferedMetricsLogger

function NullReporter() {}
NullReporter.prototype.report = jest.fn(async () => {})

class NullBufferedMetricsLogger extends BufferedMetricsLogger {
  constructor(opts = {}) {
    super({...opts, reporter: new NullReporter()})
  }
}

module.exports = metrics
module.exports.BufferedMetricsLogger = NullBufferedMetricsLogger
