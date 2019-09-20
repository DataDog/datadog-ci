import { Options } from 'request';
import { defaults as requestDefaults, RequestPromise } from 'request-promise-native';
import { Config, GetResultsResponse, ResultContainer, Test, Trigger } from './interfaces';

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

const getTestResults = (request: (args: Options) => RequestPromise<GetResultsResponse>) =>
  (testId: string) =>
    request({
      uri: `/synthetics/tests/${testId}/results`,
    });

const getTestResult = (request: (args: Options) => RequestPromise<ResultContainer>) =>
  (testId: string, resultId: string) =>
    request({
      uri: `/synthetics/tests/${testId}/results/${resultId}`,
    });

const getLatestResult = (request: (args: Options) => RequestPromise<GetResultsResponse>) =>
  async (id: string): Promise<ResultContainer | undefined> =>
    (await getTestResults(request)(id)).results
      .sort((result: ResultContainer) => result.check_time)
      .shift();

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
        },
      });

  return {
    getLatestResult: getLatestResult(request),
    getTest: getTest(request),
    getTestResult: getTestResult(request),
    getTestResults: getTestResults(request),
    triggerTests: triggerTests(request),
  };
};
