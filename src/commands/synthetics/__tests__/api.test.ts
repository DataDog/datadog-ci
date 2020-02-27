import request from 'request-promise-native';

import { apiConstructor } from '../api';
import { PollResult, Result } from '../interfaces';

jest.mock('request');

describe('dd-api', () => {
  const RESULT_ID = '123';
  const RESULTS: { results: PollResult[] } = {
    results: [
      {
        dc_id: 0,
        result: { } as Result,
        resultID: RESULT_ID,
      },
    ],
  };

  test('should get results from api', async () => {
    jest.spyOn(request, 'defaults').mockImplementation((() => () => RESULTS) as any);
    const api = apiConstructor({ apiKey: '123', appKey: '123', baseUrl: 'base' });
    const { pollResults } = api;
    const { results } = await pollResults([RESULT_ID]);
    expect(results[0].resultID).toBe(RESULT_ID);
  });
});
