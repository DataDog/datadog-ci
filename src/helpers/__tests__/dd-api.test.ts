import { apiConstructor } from '../dd-api';
jest.mock('../request');
const api = apiConstructor({ apiKey: '123', appKey: '123', baseUrl: 'base' });
const { getLatestResult } = api;

describe('dd-api', () => {
  const RESULT_ID = '123';
  const RESULTS = {
    results: [
      { status: 'first result', check_time: 1 },
      { status: 'last result', check_time: 2 },
    ],
  };

  beforeEach(() => {
    require('../request')._mockRequest(`/synthetics/tests/${RESULT_ID}/results`, RESULTS);
  });

  test('should get latest results from api', async () => {
    const result = await getLatestResult(RESULT_ID);
    expect(result!.status).toBe('last result');
  });
});
