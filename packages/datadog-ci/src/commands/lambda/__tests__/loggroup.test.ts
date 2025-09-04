import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  DeleteSubscriptionFilterCommand,
  PutSubscriptionFilterCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import {mockClient} from 'aws-sdk-client-mock'
import 'aws-sdk-client-mock-jest'

import {SUBSCRIPTION_FILTER_NAME} from '../constants'
import {LogGroupConfiguration} from '../interfaces'
import {applyLogGroupConfig, calculateLogGroupRemoveRequest, calculateLogGroupUpdateRequest} from '../loggroup'

import {mockCloudWatchLogsClientCommands, mockLogGroups} from './fixtures'

describe('loggroup', () => {
  const cloudWatchLogsClientMock = mockClient(CloudWatchLogsClient)

  beforeEach(() => {
    cloudWatchLogsClientMock.reset()
    mockCloudWatchLogsClientCommands(cloudWatchLogsClientMock)
  })

  describe('calculateLogGroupUpdateRequest', () => {
    test("creates a new log group when one doesn't exist", async () => {
      const result = await calculateLogGroupUpdateRequest(
        cloudWatchLogsClientMock as any,
        '/aws/lambda/my-func',
        'my-forwarder'
      )
      expect(result).toMatchInlineSnapshot(`
        {
          "createLogGroupCommandInput": {
            "logGroupName": "/aws/lambda/my-func",
          },
          "logGroupName": "/aws/lambda/my-func",
          "putSubscriptionFilterCommandInput": {
            "destinationArn": "my-forwarder",
            "filterName": "datadog-ci-filter",
            "filterPattern": "",
            "logGroupName": "/aws/lambda/my-func",
          },
        }
      `)
    })

    test("adds a subscription filter when one doesn't exist", async () => {
      mockLogGroups(cloudWatchLogsClientMock, {
        'aws/lambda/my-func': {
          config: {
            logGroups: [{logGroupName: '/aws/lambda/my-func'}],
          },
          filters: {},
        },
      })

      const result = await calculateLogGroupUpdateRequest(
        cloudWatchLogsClientMock as any,
        '/aws/lambda/my-func',
        'my-forwarder'
      )
      expect(result).toMatchInlineSnapshot(`
        {
          "createLogGroupCommandInput": {
            "logGroupName": "/aws/lambda/my-func",
          },
          "logGroupName": "/aws/lambda/my-func",
          "putSubscriptionFilterCommandInput": {
            "destinationArn": "my-forwarder",
            "filterName": "datadog-ci-filter",
            "filterPattern": "",
            "logGroupName": "/aws/lambda/my-func",
          },
        }
      `)
    })

    test('updates a subscription filter when an owned one already exists', async () => {
      mockLogGroups(cloudWatchLogsClientMock, {
        '/aws/lambda/my-func': {
          config: {
            logGroups: [{logGroupName: '/aws/lambda/my-func'}],
          },
          filters: {
            subscriptionFilters: [
              {
                destinationArn: 'wrong-destination',
                filterName: SUBSCRIPTION_FILTER_NAME,
                logGroupName: '/aws/lambda/my-func',
              },
            ],
          },
        },
      })

      const result = await calculateLogGroupUpdateRequest(
        cloudWatchLogsClientMock as any,
        '/aws/lambda/my-func',
        'my-forwarder'
      )
      expect(result).toMatchInlineSnapshot(`
        {
          "logGroupName": "/aws/lambda/my-func",
          "putSubscriptionFilterCommandInput": {
            "destinationArn": "my-forwarder",
            "filterName": "datadog-ci-filter",
            "filterPattern": "",
            "logGroupName": "/aws/lambda/my-func",
          },
        }
      `)
    })

    test('adds the DD filter if an unowned filter exists but another slot is still open', async () => {
      mockLogGroups(cloudWatchLogsClientMock, {
        '/aws/lambda/my-func': {
          config: {
            logGroups: [{logGroupName: '/aws/lambda/my-func'}],
          },
          filters: {
            subscriptionFilters: [
              {
                destinationArn: 'wrong-destination',
                filterName: 'wrong-filter-name',
                logGroupName: '/aws/lambda/my-func',
              },
            ],
          },
        },
      })
      const result = await calculateLogGroupUpdateRequest(
        cloudWatchLogsClientMock as any,
        '/aws/lambda/my-func',
        'my-forwarder'
      )
      expect(result).toEqual({
        logGroupName: '/aws/lambda/my-func',
        putSubscriptionFilterCommandInput: {
          destinationArn: 'my-forwarder',
          filterName: 'datadog-ci-filter',
          filterPattern: '',
          logGroupName: '/aws/lambda/my-func',
        },
      })
    })

    test('updates the DD filter if it exists alongside an unowned filter', async () => {
      mockLogGroups(cloudWatchLogsClientMock, {
        '/aws/lambda/my-func': {
          config: {
            logGroups: [{logGroupName: '/aws/lambda/my-func'}],
          },
          filters: {
            subscriptionFilters: [
              {
                destinationArn: 'unowned-wrong-destination',
                filterName: 'wrong-filter-name',
                logGroupName: '/aws/lambda/my-func',
              },
              {
                destinationArn: 'wrong-destination',
                filterName: SUBSCRIPTION_FILTER_NAME,
                logGroupName: '/aws/lambda/my-func',
              },
            ],
          },
        },
      })
      const result = await calculateLogGroupUpdateRequest(
        cloudWatchLogsClientMock as any,
        '/aws/lambda/my-func',
        'my-forwarder'
      )
      expect(result).toEqual({
        logGroupName: '/aws/lambda/my-func',
        putSubscriptionFilterCommandInput: {
          destinationArn: 'my-forwarder',
          filterName: 'datadog-ci-filter',
          filterPattern: '',
          logGroupName: '/aws/lambda/my-func',
        },
      })
    })

    test('throws an exception when unowned subscriptions are already at AWS max', async () => {
      mockLogGroups(cloudWatchLogsClientMock, {
        '/aws/lambda/my-func': {
          config: {
            logGroups: [{logGroupName: '/aws/lambda/my-func'}],
          },
          filters: {
            subscriptionFilters: [
              {
                destinationArn: 'wrong-destination',
                filterName: 'wrong-filter-name',
                logGroupName: '/aws/lambda/my-func',
              },
              {
                destinationArn: 'wrong-destination-2',
                filterName: 'wrong-filter-name-2',
                logGroupName: '/aws/lambda/my-func',
              },
            ],
          },
        },
      })
      const promise = calculateLogGroupUpdateRequest(
        cloudWatchLogsClientMock as any,
        '/aws/lambda/my-func',
        'my-forwarder'
      )
      await expect(promise).rejects.toEqual(
        Error(
          'Maximum of 2 subscription filters already exist on log group /aws/lambda/my-func. Cannot add Datadog forwarder subscription.'
        )
      )
    })

    test("doesn't update a subscription when filter is already correct", async () => {
      mockLogGroups(cloudWatchLogsClientMock, {
        '/aws/lambda/my-func': {
          config: {
            logGroups: [{logGroupName: '/aws/lambda/my-func'}],
          },
          filters: {
            subscriptionFilters: [
              {
                destinationArn: 'my-forwarder',
                filterName: SUBSCRIPTION_FILTER_NAME,
                logGroupName: '/aws/lambda/my-func',
              },
            ],
          },
        },
      })
      const result = await calculateLogGroupUpdateRequest(
        cloudWatchLogsClientMock as any,
        '/aws/lambda/my-func',
        'my-forwarder'
      )
      expect(result).toMatchInlineSnapshot(`undefined`)
    })
  })
  describe('calculateLogGroupRemoveRequest', () => {
    test('deletes the subscription filter that matches the forwarder', async () => {
      mockLogGroups(cloudWatchLogsClientMock, {
        '/aws/lambda/my-func': {
          config: {
            logGroups: [{logGroupName: '/aws/lambda/my-func'}],
          },
          filters: {
            subscriptionFilters: [
              {
                destinationArn: 'my-forwarder',
                filterName: SUBSCRIPTION_FILTER_NAME,
                logGroupName: '/aws/lambda/my-func',
              },
            ],
          },
        },
      })
      const result = await calculateLogGroupRemoveRequest(
        cloudWatchLogsClientMock as any,
        '/aws/lambda/my-func',
        'my-forwarder'
      )
      expect(result.deleteSubscriptionFilterCommandInput).toMatchInlineSnapshot(`
        {
          "filterName": "datadog-ci-filter",
          "logGroupName": "/aws/lambda/my-func",
        }
      `)
    })

    test('deletes the subscription filter that matches the datadog subscription filter constant name', async () => {
      mockLogGroups(cloudWatchLogsClientMock, {
        '/aws/lambda/my-func': {
          config: {
            logGroups: [{logGroupName: '/aws/lambda/my-func'}],
          },
          filters: {
            subscriptionFilters: [
              {
                destinationArn: 'wrong-destination',
                filterName: SUBSCRIPTION_FILTER_NAME,
                logGroupName: '/aws/lambda/my-func',
              },
            ],
          },
        },
      })
      const result = await calculateLogGroupRemoveRequest(
        cloudWatchLogsClientMock as any,
        '/aws/lambda/my-func',
        'my-forwarder'
      )
      expect(result.deleteSubscriptionFilterCommandInput).toMatchInlineSnapshot(`
        {
          "filterName": "datadog-ci-filter",
          "logGroupName": "/aws/lambda/my-func",
        }
      `)
    })

    test('returns log group configuration without delete request when forwarder and filter name does not match', async () => {
      mockLogGroups(cloudWatchLogsClientMock, {
        '/aws/lambda/my-func': {
          config: {
            logGroups: [{logGroupName: '/aws/lambda/my-func'}],
          },
          filters: {
            subscriptionFilters: [
              {
                destinationArn: 'some-destination',
                filterName: 'not-datadog',
                logGroupName: '/aws/lambda/my-func',
              },
              {
                destinationArn: 'some-other-destination',
                filterName: 'not-datadog-either',
                logGroupName: '/aws/lambda/my-func',
              },
            ],
          },
        },
      })
      const result = await calculateLogGroupRemoveRequest(
        cloudWatchLogsClientMock as any,
        '/aws/lambda/my-func',
        'my-forwarder'
      )
      expect(result).toMatchInlineSnapshot(`
        {
          "logGroupName": "/aws/lambda/my-func",
        }
      `)
    })
  })
  describe('applyLogGroupConfiguration', () => {
    test('applies specified changes', async () => {
      const config: LogGroupConfiguration = {
        createLogGroupCommandInput: {
          logGroupName: '/aws/lambda/my-func',
        },
        deleteSubscriptionFilterCommandInput: {
          filterName: SUBSCRIPTION_FILTER_NAME,
          logGroupName: '/aws/lambda/my-func',
        },
        logGroupName: '/aws/lambda/my-func',
        putSubscriptionFilterCommandInput: {
          destinationArn: 'my-forwarder',
          filterName: SUBSCRIPTION_FILTER_NAME,
          filterPattern: '',
          logGroupName: '/aws/lambda/my-func',
        },
      }

      await applyLogGroupConfig(cloudWatchLogsClientMock as any, config)
      expect(cloudWatchLogsClientMock).toHaveReceivedCommandWith(CreateLogGroupCommand, {
        logGroupName: '/aws/lambda/my-func',
      })
      expect(cloudWatchLogsClientMock).toHaveReceivedCommandWith(DeleteSubscriptionFilterCommand, {
        filterName: SUBSCRIPTION_FILTER_NAME,
        logGroupName: '/aws/lambda/my-func',
      })
      expect(cloudWatchLogsClientMock).toHaveReceivedCommandWith(PutSubscriptionFilterCommand, {
        destinationArn: 'my-forwarder',
        filterName: SUBSCRIPTION_FILTER_NAME,
        filterPattern: '',
        logGroupName: '/aws/lambda/my-func',
      })
    })

    test("doesn't apply unspecified changes", async () => {
      const config: LogGroupConfiguration = {
        logGroupName: '/aws/lambda/my-func',
        putSubscriptionFilterCommandInput: {
          destinationArn: 'my-forwarder',
          filterName: SUBSCRIPTION_FILTER_NAME,
          filterPattern: '',
          logGroupName: '/aws/lambda/my-func',
        },
      }

      await applyLogGroupConfig(cloudWatchLogsClientMock as any, config)
      expect(cloudWatchLogsClientMock).toHaveReceivedCommandTimes(CreateLogGroupCommand, 0)
      expect(cloudWatchLogsClientMock).toHaveReceivedCommandTimes(DeleteSubscriptionFilterCommand, 0)
      expect(cloudWatchLogsClientMock).toHaveReceivedCommandWith(PutSubscriptionFilterCommand, {
        destinationArn: 'my-forwarder',
        filterName: SUBSCRIPTION_FILTER_NAME,
        filterPattern: '',
        logGroupName: '/aws/lambda/my-func',
      })
    })
  })
})
