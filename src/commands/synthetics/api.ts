import * as axios from 'axios';

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

const formatBackendErrors = (requestError: axios.AxiosError<BackendError>) => {
  if (requestError.response && requestError.response.data.errors) {
    const errors = requestError.response.data.errors.map((message: string) => `  - ${message}`);

    return `\n${errors.join('\n')}`;
  }

  return requestError.name;
};

const triggerTests = (request: (args: axios.AxiosRequestConfig) => axios.AxiosPromise<Trigger>) =>
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
      throw new Error(`Could not trigger [${testIds}]. ${e.response.status}: ${errorMessage}`);
    }
  };

const getTest = (request: (args: axios.AxiosRequestConfig) => axios.AxiosPromise<Test>) => async (testId: string) => {
  try {
    const resp = await request({
      url: `/synthetics/tests/${testId}`,
    });

    return resp.data;
  } catch (e) {
    // Rewrite the error.
    throw new Error(`Could not get test ${testId}. ${e.response.status}: ${e.name}`);
  }
};

const pollResults = (request: (args: axios.AxiosRequestConfig) => axios.AxiosPromise<{ results: PollResult[] }>) =>
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
      // Rewrite the error.
      throw new Error(`Could not poll results [${resultIds}]. ${e.response.status}: ${e.name}`);
    }
  };

export const apiConstructor: APIConstructor = ({ appKey, apiKey, baseUrl }) => {
  const request = (args: axios.AxiosRequestConfig) => axios.default.create({
    baseURL: baseUrl,
  })({
    ...args,
    params: {
      api_key: apiKey,
      application_key: appKey,
      ...args.params,
    },
  });

  return {
    getTest: getTest(request),
    pollResults: pollResults(request),
    triggerTests: triggerTests(request),
  };
};
