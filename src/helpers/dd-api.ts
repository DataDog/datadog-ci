import { defaults as requestDefaults, RequestPromise } from 'request-promise-native';
import { GetResultsResponse, ResultContainer, Test, Trigger } from './interfaces';

const triggerTests = (request: (arg: any) => RequestPromise<any>) => (testIds: string[]): RequestPromise<Trigger> =>
  request({
    body: {
      public_ids: testIds,
    },
    method: 'POST',
    uri: '/synthetics/tests/trigger',
  });

const getTest = (request: (arg: any) => RequestPromise<any>) => (testId: string): RequestPromise<Test> =>
  request({
    uri: `/synthetics/tests/${testId}`,
  });

const getTestResults = (request: (arg: any) => RequestPromise<any>) =>
  (testId: string): RequestPromise<GetResultsResponse> =>
    request({
      uri: `/synthetics/tests/${testId}/results`,
    });

const getTestResult = (request: (arg: any) => RequestPromise<any>) =>
  (testId: string, resultId: string): RequestPromise<ResultContainer> =>
    request({
      uri: `/synthetics/tests/${testId}/results/${resultId}`,
    });

const getLatestResult = (request: (arg: any) => RequestPromise<any>) =>
  async (id: string): Promise<ResultContainer | undefined> =>
    (await getTestResults(request)(id)).results
      .sort((result: ResultContainer) => result.check_time)
      .shift();

export const apiConstructor = ({ appKey, apiKey, baseUrl }: { apiKey: string; appKey: string; baseUrl: string}) => {
  const request = (params: any) =>
    requestDefaults({
        baseUrl,
        json: true,
      })({
        ...params,
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
