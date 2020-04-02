import {
  AxiosError,
  AxiosPromise,
  AxiosRequestConfig,
  default as axios,
} from 'axios';

import {
  APIConstructor,
  Payload,
  PollResult,
  Test,
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
    try {
      const resp = await request({
        data: { tests },
        method: 'POST',
        url: '/synthetics/tests/trigger/ci',
      });

      return resp.data;
    } catch (e) {
      const errorMessage = formatBackendErrors(e);
      // Rewrite the error.
      const testIds = tests.map(t => t.public_id);

      throw new Error(`Could not trigger [${testIds}]. ${errorMessage}`);
    }
  };

const getTest = (request: (args: AxiosRequestConfig) => AxiosPromise<Test>) => async (testId: string) => {
  const resp = await request({
    url: `/synthetics/tests/${testId}`,
  });

  return resp.data;
};

const pollResults = (request: (args: AxiosRequestConfig) => AxiosPromise<{ results: PollResult[] }>) =>
  async (resultIds: string[]) => {
    try {
      const resp = await request({
        params: {
          result_ids: JSON.stringify(resultIds),
        },
        url: '/synthetics/tests/poll_results',
      });

      return resp.data;
    } catch (e) {
      const errorMessage = formatBackendErrors(e);
      // Rewrite the error.
      throw new Error(`Could not poll results [${resultIds}]. ${errorMessage}`);
    }
  };

export const apiConstructor: APIConstructor = ({ appKey, apiKey, baseUrl, baseIntakeUrl }) => {
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
    triggerTests: triggerTests(requestTrigger),
  };
};
