export const RUNTIME_LAYER_LOOKUP = {
  'nodejs10.x': 'Datadog-Node10-x',
  'nodejs12.x': 'Datadog-Node12-x',
  'python2.7': 'Datadog-Python27',
  'python3.6': 'Datadog-Python36',
  'python3.7': 'Datadog-Python37',
  'python3.8': 'Datadog-Python38',
} as const
export type Runtime = keyof typeof RUNTIME_LAYER_LOOKUP

const PYTHON_HANDLER_LOCATION = 'datadog_lambda.handler.handler'
const NODE_HANDLER_LOCATION = '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler'
export const HANDLER_LOCATION = {
  'nodejs10.x': NODE_HANDLER_LOCATION,
  'nodejs12.x': NODE_HANDLER_LOCATION,
  'python2.7': PYTHON_HANDLER_LOCATION,
  'python3.6': PYTHON_HANDLER_LOCATION,
  'python3.7': PYTHON_HANDLER_LOCATION,
  'python3.8': PYTHON_HANDLER_LOCATION,
}

export const DEFAULT_LAYER_AWS_ACCOUNT = '464622532012'
export const SUBSCRIPTION_FILTER_NAME = 'datadog-ci-filter'
