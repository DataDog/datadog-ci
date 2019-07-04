import { GetResultsResponse, ResultContainer, Test, Trigger } from './interfaces';
import { requestConstructor } from './request';

const triggerTests = (request: (arg: any) => Promise<any>) => (testIds: string[]): Promise<Trigger> =>
    request({
        body: {
            public_ids: testIds,
        },
        endpoint: '/synthetics/tests/trigger',
        method: 'POST',
    });

const getTest = (request: (arg: any) => Promise<any>) => (testId: string): Promise<Test> =>
    request({
        endpoint: `/synthetics/tests/${testId}`,
    });

const getTestResults = (request: (arg: any) => Promise<any>) => (testId: string): Promise<GetResultsResponse> =>
    request({
        endpoint: `/synthetics/tests/${testId}/results`,
    });

const getTestResult = (request: (arg: any) => Promise<any>) =>
    (testId: string, resultId: string): Promise<ResultContainer> =>
        request({
            endpoint: `/synthetics/tests/${testId}/results/${resultId}`,
        });

const getLatestResult = (request: (arg: any) => Promise<any>) =>
    async (id: string): Promise<ResultContainer | undefined> =>
        (await getTestResults(request)(id)).results
            .sort((result: ResultContainer) => result.check_time)
            .shift();

export default ({ appKey, apiKey, baseUrl }: { apiKey: string; appKey: string; baseUrl: string}) => {
    const request = (params: any) =>
        requestConstructor({
            BASE_URL: baseUrl,
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
