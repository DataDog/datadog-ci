import * as axios from 'axios';

import {
  APIConstructor,
  Payload,
  PollResult,
  Test,
  Trigger,
} from './interfaces';

const triggerTests = (request: (args: axios.AxiosRequestConfig) => axios.AxiosPromise<Trigger>) =>
  async (testIds: string[], config?: Payload) => {
    try {
      const resp = await request({
        data: {
          config,
          public_ids: testIds,
        },
        method: 'POST',
        url: '/synthetics/tests/trigger/ci',
      });

      return resp.data;
    } catch (e) {
      // Rewrite the error.
      throw new Error(`Could not trigger [${testIds}]. ${e.statusCode}: ${e.name}`);
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
    throw new Error(`Could not get test ${testId}. ${e.statusCode}: ${e.name}`);
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
      throw new Error(`Could not poll results [${resultIds}]. ${e.statusCode}: ${e.name}`);
    }
  };

export const apiConstructor: APIConstructor = ({ appKey, apiKey, baseURL }) => {
  const request = (args: axios.AxiosRequestConfig) => axios.default.create({
    baseURL,
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
