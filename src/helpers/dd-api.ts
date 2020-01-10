import { Options } from 'request';
import { defaults as requestDefaults, RequestPromise } from 'request-promise-native';
import { APIConstructor, Payload, PollResult, Test, Trigger } from './interfaces';

const triggerTests = (request: (args: Options) => RequestPromise<Trigger>) => (testIds: string[], config?: Payload) =>
  request({
    body: {
      config,
      public_ids: testIds,
    },
    method: 'POST',
    uri: '/synthetics/tests/trigger',
  });

const getTest = (request: (args: Options) => RequestPromise<Test>) => (testId: string) =>
  request({
    uri: `/synthetics/tests/${testId}`,
  });

const pollResults = (request: (args: Options) => RequestPromise<{ results: PollResult[] }>) => (resultIds: string[]) =>
  request({
    qs: {
      result_ids: JSON.stringify(resultIds),
    },
    uri: '/synthetics/tests/poll_results',
  });

export const apiConstructor: APIConstructor = ({ appKey, apiKey, baseUrl }) => {
  const request = (args: Options) =>
    requestDefaults({
        baseUrl,
        json: true,
      })({
        ...args,
        headers: { 'X-Requested-With': 'synthetics-ci' },
        qs: { api_key: apiKey, application_key: appKey, ...args.qs },
      });

  return {
    getTest: getTest(request),
    pollResults: pollResults(request),
    triggerTests: triggerTests(request),
  };
};
