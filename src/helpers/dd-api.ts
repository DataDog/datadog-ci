import { Options } from 'request';
import { defaults as requestDefaults, RequestPromise } from 'request-promise-native';
import { Config, PollResult, Test, Trigger } from './interfaces';

const triggerTests = (request: (args: Options) => RequestPromise<Trigger>) => (testIds: string[], config?: Config) =>
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

export const apiConstructor = ({ appKey, apiKey, baseUrl }: { apiKey: string; appKey: string; baseUrl: string}) => {
  const request = (args: Options) =>
    requestDefaults({
        baseUrl,
        json: true,
      })({
        ...args,
        qs: {
          api_key: apiKey,
          application_key: appKey,
          ...args.qs,
        },
      });

  return {
    getTest: getTest(request),
    pollResults: pollResults(request),
    triggerTests: triggerTests(request),
  };
};
