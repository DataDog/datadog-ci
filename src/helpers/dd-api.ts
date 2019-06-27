import req from './request';

const triggerTests = (request: (arg: any) => Promise<any>) => (testIds: string[]) =>
    request({
        body: {
            public_ids: testIds,
        },
        endpoint: '/synthetics/tests/trigger',
        method: 'POST',
    });

const getTest = (request: (arg: any) => Promise<any>) => (testId: string) =>
    request({
        endpoint: `/synthetics/tests/${testId}`,
    });

const getTestResults = (request: (arg: any) => Promise<any>) => (testId: string) =>
    request({
        endpoint: `/synthetics/tests/${testId}/results`,
    });

const getTestResult = (request: (arg: any) => Promise<any>) => (testId: string, resultId: string) =>
    request({
        endpoint: `/synthetics/tests/${testId}/results/${resultId}`,
    });

export default ({ appKey, apiKey, baseUrl }: { appKey: string, apiKey: string, baseUrl: string}) => {
    const request = (params: any) =>
        req({
            BASE_URL: baseUrl,
        })({
            ...params,
            qs: {
                api_key: apiKey,
                application_key: appKey,
            },
        });

    return {
        getTest: getTest(request),
        getTestResult: getTestResult(request),
        getTestResults: getTestResults(request),
        triggerTests: triggerTests(request),
    };
};
