import {
  AxiosError,
  AxiosPromise,
  AxiosRequestConfig,
  default as axios,
} from 'axios';

import {
  APIConfiguration,
  Payload,
  PollResult,
  Test,
  TestSearchResult,
  Trigger,
} from './interfaces';

interface BackendError {
  errors: string[];
}

export const formatBackendErrors = (requestError: AxiosError<BackendError>) => {
  if (requestError.response && requestError.response.data.errors) {
    const errors = requestError.response.data.errors.map((message: string) => `  - ${message}`);
    const serverHead = `query on ${requestError.config.baseURL}${requestError.config.url} returned:`;

    return `${serverHead}\n${errors.join('\n')}`;
  }

  return requestError.name;
};

const triggerTests = (request: (args: AxiosRequestConfig) => AxiosPromise<Trigger>) =>
  async (tests: Payload[]) => {
    const resp = await request({
      data: { tests },
      method: 'POST',
      url: '/synthetics/tests/trigger/ci',
    });

    return resp.data;
  };

const getTest = (request: (args: AxiosRequestConfig) => AxiosPromise<Test>) => async (testId: string) => {
  const resp = await request({
    url: `/synthetics/tests/${testId}`,
  });

  return resp.data;
};

const searchTests = (request: (args: AxiosRequestConfig) => AxiosPromise<TestSearchResult>) =>
  async (query: string) => {
    const resp = await request({
      params: {
        text: query,
      },
      url: '/synthetics/tests/search',
    });

    return resp.data;
  };

const pollResults = (request: (args: AxiosRequestConfig) => AxiosPromise<{ results: PollResult[] }>) =>
  async (resultIds: string[]) => {
    const resp = await request({
      params: {
        result_ids: JSON.stringify(resultIds),
      },
      url: '/synthetics/tests/poll_results',
    });

    return resp.data;
  };

export const apiConstructor = ({ appKey, apiKey, baseUrl, baseIntakeUrl }: APIConfiguration) => {
  const overrideArgs = (args: AxiosRequestConfig) => ({
    ...args,
    params: {
      api_key: apiKey,
      application_key: appKey,
      ...args.params,
    },
  });
  const request = (args: AxiosRequestConfig) => axios.create({ baseURL: baseUrl })(overrideArgs(args));
  const requestTrigger = (args: AxiosRequestConfig) => axios.create({ baseURL: baseIntakeUrl })(overrideArgs(args));

  return {
    getTest: getTest(request),
    pollResults: pollResults(request),
    searchTests: searchTests(request),
    triggerTests: triggerTests(requestTrigger),
  };
};
