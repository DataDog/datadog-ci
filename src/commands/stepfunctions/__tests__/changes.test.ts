import {createLogGroup, enableStepFunctionLogs, putSubscriptionFilter, tagResource} from '../aws'
import {displayChanges, applyChanges} from '../changes'

import {
  cloudWatchLogsClientFixture,
  logGroupFixture,
  stepFunctionsClientFixture,
  stepFunctionFixture,
  stepFunctionTagListFixture,
  subscriptionFilterFixture,
} from './fixtures/aws-resources'
import {contextFixture, testContext} from './fixtures/cli'
describe('changes', () => {
  test('test changes1', () => {
    expect(1).toBeTruthy()
  })
})
// describe('changes', () => {
//   let context: testContext
//   beforeEach(() => {
//     context = contextFixture()
//   })

  describe('displayChanges', () => {
    test('displays changes for dry run true', () => {
      const stepFunctionsClient = stepFunctionsClientFixture()
      const stepFunction = stepFunctionFixture()
      const stepFunctionTagList = stepFunctionTagListFixture()

      const tagStepFunctionRequest = tagResource(stepFunctionsClient, stepFunction.stateMachineArn, stepFunctionTagList)

      const requestsByStepFunction = {
        [stepFunction.stateMachineArn]: [tagStepFunctionRequest],
      }
      const dryRun = true
      displayChanges(requestsByStepFunction, dryRun, context)

      expect(context.toString()).toMatchSnapshot()
    })

    test('displays changes for dry run false', () => {
      const stepFunctionsClient = stepFunctionsClientFixture()
      const stepFunction = stepFunctionFixture()
      const stepFunctionTagList = stepFunctionTagListFixture()

      const tagStepFunctionRequest = tagResource(stepFunctionsClient, stepFunction.stateMachineArn, stepFunctionTagList)

      const requestsByStepFunction = {
        [stepFunction.stateMachineArn]: [tagStepFunctionRequest],
      }
      const dryRun = false
      displayChanges(requestsByStepFunction, dryRun, context)

      expect(context.toString()).toMatchSnapshot()
    })

    test('displays changes for an update request', () => {
      const stepFunctionsClient = stepFunctionsClientFixture()
      const stepFunction = stepFunctionFixture({
        loggingConfiguration: {
          level: 'OFF',
          includeExecutionData: false,
        },
      })
      const logGroupArn =
        'arn:aws:logs:us-east-1:000000000000:log-group:/aws/vendedlogs/states/ExampleStepFunction-Logs-test:*'

      const enableStepFunctionLogsRequest = enableStepFunctionLogs(stepFunctionsClient, stepFunction, logGroupArn)

      const requestsByStepFunction = {
        [stepFunction.stateMachineArn]: [enableStepFunctionLogsRequest],
      }
      const dryRun = false
      displayChanges(requestsByStepFunction, dryRun, context)

      expect(context.toString()).toMatchSnapshot()
    })

    test('displays changes for multiple step functions with multiple requests', () => {
      const stepFunctionsClient = stepFunctionsClientFixture()
      const stepFunction1 = stepFunctionFixture({
        stateMachineArn: 'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction1',
        name: 'ExampleStepFunction1',
        loggingConfiguration: {
          level: 'OFF',
          includeExecutionData: false,
        },
      })
      const stepFunction2 = stepFunctionFixture({
        stateMachineArn: 'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction2',
        name: 'ExampleStepFunction2',
      })
      const stepFunctionTagList = stepFunctionTagListFixture()
      const logGroupArn =
        'arn:aws:logs:us-east-1:000000000000:log-group:/aws/vendedlogs/states/ExampleStepFunction-Logs-test:*'

      const tagStepFunctionRequest1 = tagResource(
        stepFunctionsClient,
        stepFunction1.stateMachineArn,
        stepFunctionTagList
      )
      const tagStepFunctionRequest2 = tagResource(
        stepFunctionsClient,
        stepFunction2.stateMachineArn,
        stepFunctionTagList
      )
      const enableStepFunctionLogsRequest = enableStepFunctionLogs(stepFunctionsClient, stepFunction1, logGroupArn)

      const requestsByStepFunction = {
        [stepFunction1.stateMachineArn]: [tagStepFunctionRequest1, enableStepFunctionLogsRequest],
        [stepFunction2.stateMachineArn]: [tagStepFunctionRequest2],
      }
      const dryRun = false
      displayChanges(requestsByStepFunction, dryRun, context)

      expect(context.toString()).toMatchSnapshot()
    })
  })

  describe('applyChanges', () => {
    beforeAll(() => {
      const aws = require('../aws')

      aws.tagResource = jest.fn().mockImplementation(() => ({
        function: {operation: 'tagResource', promise: () => Promise.resolve()},
      }))

      const resourceAlreadyExistsException = new Error('The specified log group already exists')
      resourceAlreadyExistsException.name = 'ResourceAlreadyExistsException'
      aws.createLogGroup = jest.fn().mockImplementation(() => ({
        function: {
          operation: 'createLogGroup',
          promise: () => Promise.reject(resourceAlreadyExistsException),
        },
      }))

      const limitExceededException = new Error('Resource limit exceeded.')
      limitExceededException.name = 'LimitExceededException'
      aws.putSubscriptionFilter = jest.fn().mockImplementation(() => ({
        function: {
          operation: 'putSubscriptionFilter',
          promise: () => Promise.reject(limitExceededException),
        },
      }))

      const stepFunction = stepFunctionFixture()
      aws.enableStepFunctionLogs = jest.fn().mockImplementation(() => ({
        function: {
          operation: 'updateStateMachine',
          previousParams: {
            stateMachineArn: stepFunction.stateMachineArn,
            loggingConfiguration: stepFunction.loggingConfiguration,
          },
          promise: () => Promise.resolve(),
        },
      }))
    })

    test('applies changes with no warnings or errors', async () => {
      const stepFunctionsClient = stepFunctionsClientFixture()
      const stepFunction = stepFunctionFixture()

      const tagStepFunctionRequest = tagResource(
        stepFunctionsClient,
        stepFunction.stateMachineArn,
        stepFunctionTagListFixture()
      )

      const requestsByStepFunction = {
        [stepFunction.stateMachineArn]: [tagStepFunctionRequest],
      }
      await applyChanges(requestsByStepFunction, context)

      expect(context.toString()).toMatchSnapshot()
    })

    test('applies changes with a warning', async () => {
      const cloudWatchLogsClient = cloudWatchLogsClientFixture()
      const logGroup = logGroupFixture()
      const stepFunction = stepFunctionFixture()

      const createLogGroupRequest = createLogGroup(cloudWatchLogsClient, logGroup.logGroupName ?? '')

      const requestsByStepFunction = {
        [stepFunction.stateMachineArn]: [createLogGroupRequest],
      }
      await applyChanges(requestsByStepFunction, context)

      expect(context.toString()).toMatchSnapshot()
    })

    test('applies changes with an error', async () => {
      const cloudWatchLogsClient = cloudWatchLogsClientFixture()
      const logGroup = logGroupFixture()
      const subscriptionFilter = subscriptionFilterFixture()
      const stepFunction = stepFunctionFixture()

      const putSubscriptionFilterRequest = putSubscriptionFilter(
        cloudWatchLogsClient,
        subscriptionFilter.destinationArn ?? '',
        subscriptionFilter.filterName ?? '',
        logGroup.logGroupName ?? ''
      )

      const requestsByStepFunction = {
        [stepFunction.stateMachineArn]: [putSubscriptionFilterRequest],
      }
      await applyChanges(requestsByStepFunction, context)

      expect(context.toString()).toMatchSnapshot()
    })

    test('applies changes for multiple step functions', async () => {
      const stepFunctionsClient = stepFunctionsClientFixture()
      const stepFunction1 = stepFunctionFixture({
        stateMachineArn: 'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction1',
        name: 'ExampleStepFunction1',
        loggingConfiguration: {
          level: 'OFF',
          includeExecutionData: false,
        },
      })
      const stepFunction2 = stepFunctionFixture({
        stateMachineArn: 'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction2',
        name: 'ExampleStepFunction2',
      })
      const stepFunctionTagList = stepFunctionTagListFixture()
      const logGroupArn =
        'arn:aws:logs:us-east-1:000000000000:log-group:/aws/vendedlogs/states/ExampleStepFunction-Logs-test:*'

      const tagStepFunctionRequest1 = tagResource(
        stepFunctionsClient,
        stepFunction1.stateMachineArn,
        stepFunctionTagList
      )
      const tagStepFunctionRequest2 = tagResource(
        stepFunctionsClient,
        stepFunction2.stateMachineArn,
        stepFunctionTagList
      )
      const enableStepFunctionLogsRequest = enableStepFunctionLogs(stepFunctionsClient, stepFunction1, logGroupArn)

      const requestsByStepFunction = {
        [stepFunction1.stateMachineArn]: [tagStepFunctionRequest1, enableStepFunctionLogsRequest],
        [stepFunction2.stateMachineArn]: [tagStepFunctionRequest2],
      }

      await applyChanges(requestsByStepFunction, context)

      expect(context.toString()).toMatchSnapshot()
    })

    test('continues applying changes after a warning or error', async () => {
      const stepFunctionsClient = stepFunctionsClientFixture()
      const cloudWatchLogsClient = cloudWatchLogsClientFixture()
      const stepFunction = stepFunctionFixture()
      const logGroup = logGroupFixture()
      const createLogGroupRequest = createLogGroup(cloudWatchLogsClient, logGroup.logGroupName ?? '')
      const subscriptionFilter = subscriptionFilterFixture()
      const logGroupArn =
        'arn:aws:logs:us-east-1:000000000000:log-group:/aws/vendedlogs/states/ExampleStepFunction-Logs-test:*'

      const tagStepFunctionRequest = tagResource(
        stepFunctionsClient,
        stepFunction.stateMachineArn,
        stepFunctionTagListFixture()
      )
      const putSubscriptionFilterRequest = putSubscriptionFilter(
        cloudWatchLogsClient,
        subscriptionFilter.destinationArn ?? '',
        subscriptionFilter.filterName ?? '',
        logGroup.logGroupName ?? ''
      )
      const enableStepFunctionLogsRequest = enableStepFunctionLogs(stepFunctionsClient, stepFunction, logGroupArn)

      const requestsByStepFunction = {
        [stepFunction.stateMachineArn]: [
          tagStepFunctionRequest,
          createLogGroupRequest,
          putSubscriptionFilterRequest,
          enableStepFunctionLogsRequest,
        ],
      }
      await applyChanges(requestsByStepFunction, context)

      expect(context.toString()).toMatchSnapshot()
    })
  })
})
