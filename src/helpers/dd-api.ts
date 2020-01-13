import { Options } from 'request';
import { defaults as requestDefaults, RequestPromise } from 'request-promise-native';
import { Payload, PollResult, Test, Trigger } from './interfaces';

const triggerTests = (request: (args: Options) => RequestPromise<Trigger>) => (testIds: string[], config?: Payload) =>
  request({
    body: {
      config,
      public_ids: testIds,
    },
    method: 'POST',
    uri: '/synthetics/tests/trigger',
  }).catch(e => {
    throw new Error(`Could not trigger [${testIds}].
${e.statusCode}: ${e.name}`);
  });

const getTest = (request: (args: Options) => RequestPromise<Test>) => (testId: string) =>
  request({
    uri: `/synthetics/tests/${testId}`,
  }).catch(e => {
    throw new Error(`Could not get test ${testId}.
${e.statusCode}: ${e.name}`);
  });

const pollResults = (request: (args: Options) => RequestPromise<{ results: PollResult[] }>) => (resultIds: string[]) =>
  request({
    qs: {
      result_ids: JSON.stringify(resultIds),
    },
    uri: '/synthetics/tests/poll_results',
  }).catch(e => {
    throw new Error(`Could not poll results [${resultIds}].
${e.statusCode}: ${e.name}`);
  });

export const apiConstructor: any = ({ appKey, apiKey, baseUrl }: any) => {
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
