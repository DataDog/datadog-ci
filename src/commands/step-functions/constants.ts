export enum Operation {
  CreateLogGroup = 'createLogGroup',
  DeleteSubscriptionFilter = 'deleteSubscriptionFilter',
  PutSubscriptionFilter = 'putSubscriptionFilter',
  TagLogGroup = 'tagLogGroup',
  TagResource = 'tagResource',
  UntagLogGroup = 'untagLogGroup',
  UpdateStateMachine = 'updateStateMachine',
}

export const instrumentationSourceTagKey = 'DD_INSTRUMENTATION_SOURCE'
export const instrumentationSourceTagValue = 'datadog-ci'
