/**
 * Summarize relevant information about a Cloud Run log.
 * Also used to build CSV log files.
 * @typedef {Object} CloudRunLog
 * @property {string} severity - The level of severity of the log. It can be values such as 'DEBUG', 'INFO', 'ERROR', etc.
 * @property {string} timestamp - The timestamp of when the log was generated.
 * @property {string} logName - The name of the log
 * @property {string} message - The actual log message detailing what event occurred.
 */
export interface CloudRunLog {
  severity: string
  timestamp: string
  logName: string
  message: string
}

/**
 * Contains all the information used to create a log file.
 * @typedef {Object} LogConfig
 * @property {string} type - string name of the type of log. Used when printing CLI messages.
 * @property {string} fileName - The name of the log file (such as 'all_logs.csv' or 'error_logs.csv')
 * @property {string} [severityFilter] - Optional filter to modify the Logging query. Example: ' AND severity="DEBUG"'
 */
export interface LogConfig {
  type: string
  fileName: string
  severityFilter?: string
}

/**
 * Interface for Unified Service Tagging.
 *
 * See more at: https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/?tab=kubernetes#overview
 */
interface InstrumentationTags {
  environment?: string
  extraTags?: string
  service?: string
  version?: string
}

/**
 * Basic settings to use in every specified
 * cloud run service to be instrumented.
 */
export interface InstrumentationSettings extends InstrumentationTags {
  interactive?: boolean
  loggingEnabled?: boolean
  logLevel?: string
  tracingEnabled: boolean
  llmobsEnabled?: boolean
  llmobsMlApp?: string
}
