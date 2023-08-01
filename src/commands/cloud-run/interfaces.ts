// Info that will be used to build the CSV file
export interface CloudRunLog {
  severity: string
  timestamp: string
  logName: string
  message: string
}

// Defines what log files will be created
export interface LogConfig {
  type: string
  fileName: string
  isTextLog: boolean
  severityFilter?: string
}
