import {SUBSCRIPTION_FILTER_NAME} from '../constants'
import {applyLogGroupConfig, calculateLogGroupRemoveRequest, calculateLogGroupUpdateRequest} from '../loggroup'
import {makeMockCloudWatchLogs} from './fixtures'

describe('loggroup', () => {
  describe('calculateLogGroupUpdateRequest', () => {
    test("creates a new log group when one doesn't exist", async () => {
      const logs = makeMockCloudWatchLogs({})
      const result = await calculateLogGroupUpdateRequest(logs as any, '/aws/lambda/my-func', 'my-forwarder')
      expect(result).toMatchInlineSnapshot(`
                        Object {
                          "createLogGroupRequest": Object {
                            "logGroupName": "/aws/lambda/my-func",
                          },
                          "logGroupName": "/aws/lambda/my-func",
                          "subscriptionFilterRequest": Object {
                            "destinationArn": "my-forwarder",
                            "filterName": "datadog-ci-filter",
                            "filterPattern": "",
                            "logGroupName": "/aws/lambda/my-func",
                          },
                        }
                  `)
    })
    test("adds a subscription filter when one doesn't exist", async () => {
      const logs = makeMockCloudWatchLogs({
        '/aws/lambda/my-func': {
          config: {
            logGroups: [{logGroupName: '/aws/lambda/my-func'}],
          },
          filters: {},
        },
      })
      const result = await calculateLogGroupUpdateRequest(logs as any, '/aws/lambda/my-func', 'my-forwarder')
      expect(result).toMatchInlineSnapshot(`
                Object {
                  "logGroupName": "/aws/lambda/my-func",
                  "subscriptionFilterRequest": Object {
                    "destinationArn": "my-forwarder",
                    "filterName": "datadog-ci-filter",
                    "filterPattern": "",
                    "logGroupName": "/aws/lambda/my-func",
                  },
                }
            `)
    })
    test('updates a subscription filter when an owned one already exists', async () => {
      const logs = makeMockCloudWatchLogs({
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
      const result = await calculateLogGroupUpdateRequest(logs as any, '/aws/lambda/my-func', 'my-forwarder')
      expect(result).toMatchInlineSnapshot(`
                Object {
                  "logGroupName": "/aws/lambda/my-func",
                  "subscriptionFilterRequest": Object {
                    "destinationArn": "my-forwarder",
                    "filterName": "datadog-ci-filter",
                    "filterPattern": "",
                    "logGroupName": "/aws/lambda/my-func",
                  },
                }
            `)
    })
    test('throws an exception when an unowned subscription filter exists', async () => {
      const logs = makeMockCloudWatchLogs({
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
      const promise = calculateLogGroupUpdateRequest(logs as any, '/aws/lambda/my-func', 'my-forwarder')
      await expect(promise).rejects.toEqual(
        Error('Unknown subscription filter already on log group /aws/lambda/my-func. Only one subscription is allowed.')
      )
    })
    test("doesn't update a subscription when filter is already correct", async () => {
      const logs = makeMockCloudWatchLogs({
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
      const result = await calculateLogGroupUpdateRequest(logs as any, '/aws/lambda/my-func', 'my-forwarder')
      expect(result).toMatchInlineSnapshot('undefined')
    })
  })
  describe('calculateLogGroupRemoveRequest', () => {
    test('deletes the subscription filter that matches the forwarder', async () => {
      const logs = makeMockCloudWatchLogs({
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
      const result = await calculateLogGroupRemoveRequest(logs as any, '/aws/lambda/my-func', 'my-forwarder')
      expect(result.deleteSubscriptionFilterRequest).toMatchInlineSnapshot(`
        Object {
          "filterName": "datadog-ci-filter",
          "logGroupName": "/aws/lambda/my-func",
        }
      `)
    })
    test('deletes the subscription filter that matches the datadog subscription filter constant name', async () => {
      const logs = makeMockCloudWatchLogs({
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
      const result = await calculateLogGroupRemoveRequest(logs as any, '/aws/lambda/my-func', 'my-forwarder')
      expect(result.deleteSubscriptionFilterRequest).toMatchInlineSnapshot(`
        Object {
          "filterName": "datadog-ci-filter",
          "logGroupName": "/aws/lambda/my-func",
        }
      `)
    })
    test('returns log group configuration without delete request when forwarder and filter name does not match', async () => {
      const logs = makeMockCloudWatchLogs({
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
      const result = await calculateLogGroupRemoveRequest(logs as any, '/aws/lambda/my-func', 'my-forwarder')
      expect(result).toMatchInlineSnapshot(`
        Object {
          "logGroupName": "/aws/lambda/my-func",
        }
      `)
    })
  })
  describe('applyLogGroupConfiguration', () => {
    test('applies specified changes', async () => {
      const logs = makeMockCloudWatchLogs({})

      const config = {
        createLogGroupRequest: {
          logGroupName: '/aws/lambda/my-func',
        },
        deleteSubscriptionFilterRequest: {
          filterName: SUBSCRIPTION_FILTER_NAME,
          logGroupName: '/aws/lambda/my-func',
        },
        logGroupName: '/aws/lambda/my-func',
        subscriptionFilterRequest: {
          destinationArn: 'my-forwarder',
          filterName: SUBSCRIPTION_FILTER_NAME,
          filterPattern: '',
          logGroupName: '/aws/lambda/my-func',
        },
      }

      await applyLogGroupConfig(logs as any, config)
      expect(logs.createLogGroup).toHaveBeenCalledWith({
        logGroupName: '/aws/lambda/my-func',
      })
      expect(logs.deleteSubscriptionFilter).toHaveBeenCalledWith({
        filterName: SUBSCRIPTION_FILTER_NAME,
        logGroupName: '/aws/lambda/my-func',
      })
      expect(logs.putSubscriptionFilter).toHaveBeenCalledWith({
        destinationArn: 'my-forwarder',
        filterName: SUBSCRIPTION_FILTER_NAME,
        filterPattern: '',
        logGroupName: '/aws/lambda/my-func',
      })
    })
    test("doesn't apply unspecified changes", async () => {
      const logs = makeMockCloudWatchLogs({})

      const config = {
        logGroupName: '/aws/lambda/my-func',
        subscriptionFilterRequest: {
          destinationArn: 'my-forwarder',
          filterName: SUBSCRIPTION_FILTER_NAME,
          filterPattern: '',
          logGroupName: '/aws/lambda/my-func',
        },
      }

      await applyLogGroupConfig(logs as any, config)
      expect(logs.createLogGroup).not.toHaveBeenCalled()
      expect(logs.deleteSubscriptionFilter).not.toHaveBeenCalled()
      expect(logs.putSubscriptionFilter).toHaveBeenCalledWith({
        destinationArn: 'my-forwarder',
        filterName: SUBSCRIPTION_FILTER_NAME,
        filterPattern: '',
        logGroupName: '/aws/lambda/my-func',
      })
    })
  })
})
