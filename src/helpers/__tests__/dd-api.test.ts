import { apiConstructor } from '../dd-api';
import { PollResult, Result } from '../interfaces';

jest.unmock('glob');

const api = apiConstructor({ apiKey: '123', appKey: '123', baseUrl: 'base' });
const { pollResults } = api;

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

  beforeEach(() => {
    require('request-promise-native')._mockRequest('/synthetics/tests/poll_results', RESULTS);
  });

  test('should get results from api', async () => {
    const { results } = await pollResults([RESULT_ID]);
    expect(results[0].resultID).toBe(RESULT_ID);
  });
});
