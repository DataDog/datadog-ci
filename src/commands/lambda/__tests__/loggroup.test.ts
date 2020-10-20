import {CloudWatchLogs} from 'aws-sdk'
import {applyLogGroupConfig, calculateLogGroupUpdateRequest} from '../loggroup'

const makeMockCloudWatch = (
  logGroups: Record<
    string,
    {config: CloudWatchLogs.DescribeLogGroupsResponse; filters?: CloudWatchLogs.DescribeSubscriptionFiltersResponse}
  >
) => ({
  createLogGroup: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
  deleteSubscriptionFilter: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
  describeLogGroups: jest.fn().mockImplementation(({logGroupNamePrefix}) => {
    const groups = logGroups[logGroupNamePrefix]?.config ?? {logGroups: []}

    return {
      promise: () => Promise.resolve(groups),
    }
  }),
  describeSubscriptionFilters: jest.fn().mockImplementation(({logGroupName}) => {
    const groups = logGroups[logGroupName]?.filters ?? {subscriptionFilters: []}

    return {
      promise: () => Promise.resolve(groups),
    }
  }),
  putSubscriptionFilter: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
})

describe('loggroup', () => {
  describe('calculateLogGroupUpdateRequest', () => {
    test("creates a new log group when one doesn't exist", async () => {
      const logs = makeMockCloudWatch({})
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
      const logs = makeMockCloudWatch({
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
      const logs = makeMockCloudWatch({
        '/aws/lambda/my-func': {
          config: {
            logGroups: [{logGroupName: '/aws/lambda/my-func'}],
          },
          filters: {
            subscriptionFilters: [
              {
                destinationArn: 'wrong-destination',
                filterName: 'datadog-ci-filter',
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
      const logs = makeMockCloudWatch({
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
      const logs = makeMockCloudWatch({
        '/aws/lambda/my-func': {
          config: {
            logGroups: [{logGroupName: '/aws/lambda/my-func'}],
          },
          filters: {
            subscriptionFilters: [
              {
                destinationArn: 'my-forwarder',
                filterName: 'datadog-ci-filter',
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
  describe('applyLogGroupConfiguration', () => {
    test('applies specified changes', async () => {
      const logs = makeMockCloudWatch({})

      const config = {
        createLogGroupRequest: {
          logGroupName: '/aws/lambda/my-func',
        },
        deleteSubscriptionFilterRequest: {
          filterName: 'datadog-ci-filter',
          logGroupName: '/aws/lambda/my-func',
        },
        logGroupName: '/aws/lambda/my-func',
        subscriptionFilterRequest: {
          destinationArn: 'my-forwarder',
          filterName: 'datadog-ci-filter',
          filterPattern: '',
          logGroupName: '/aws/lambda/my-func',
        },
      }

      await applyLogGroupConfig(logs as any, config)
      expect(logs.createLogGroup).toHaveBeenCalledWith({
        logGroupName: '/aws/lambda/my-func',
      })
      expect(logs.deleteSubscriptionFilter).toHaveBeenCalledWith({
        filterName: 'datadog-ci-filter',
        logGroupName: '/aws/lambda/my-func',
      })
      expect(logs.putSubscriptionFilter).toHaveBeenCalledWith({
        destinationArn: 'my-forwarder',
        filterName: 'datadog-ci-filter',
        filterPattern: '',
        logGroupName: '/aws/lambda/my-func',
      })
    })
    test("doesn't apply unspecified changes", async () => {
      const logs = makeMockCloudWatch({})

      const config = {
        logGroupName: '/aws/lambda/my-func',
        subscriptionFilterRequest: {
          destinationArn: 'my-forwarder',
          filterName: 'datadog-ci-filter',
          filterPattern: '',
          logGroupName: '/aws/lambda/my-func',
        },
      }

      await applyLogGroupConfig(logs as any, config)
      expect(logs.createLogGroup).not.toHaveBeenCalled()
      expect(logs.deleteSubscriptionFilter).not.toHaveBeenCalled()
      expect(logs.putSubscriptionFilter).toHaveBeenCalledWith({
        destinationArn: 'my-forwarder',
        filterName: 'datadog-ci-filter',
        filterPattern: '',
        logGroupName: '/aws/lambda/my-func',
      })
    })
  })
})
