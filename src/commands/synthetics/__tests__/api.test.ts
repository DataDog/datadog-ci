import axios from 'axios';

import { apiConstructor } from '../api';
import { Payload, PollResult, Result, Trigger } from '../interfaces';

describe('dd-api', () => {
  const RESULT_ID = '123';
  const POLL_RESULTS: { results: PollResult[] } = {
    results: [
      {
        dc_id: 0,
        result: { } as Result,
        resultID: RESULT_ID,
      },
    ],
  };
  const TRIGGERED_TEST_ID = 'fakeId';
  const TRIGGER_RESULTS: Trigger = {
    results: [
      {
        device: 'laptop_large',
        location: 42,
        public_id: TRIGGERED_TEST_ID,
        result_id: RESULT_ID,
      },
    ],
    triggered_check_ids: [TRIGGERED_TEST_ID],
  };

  test('should get results from api', async () => {
    jest.spyOn(axios, 'create').mockImplementation((() => () => ({ data: POLL_RESULTS })) as any);
    const api = apiConstructor({ apiKey: '123', appKey: '123', baseIntakeUrl: 'baseintake', baseUrl: 'base' });
    const { pollResults } = api;
    const { results } = await pollResults([RESULT_ID]);
    expect(results[0].resultID).toBe(RESULT_ID);
  });

  test('should trigger tests using api', async () => {
    jest.spyOn(axios, 'create').mockImplementation((() => () => ({ data: TRIGGER_RESULTS })) as any);
    const api = apiConstructor({ apiKey: '123', appKey: '123', baseIntakeUrl: 'baseintake', baseUrl: 'base' });
    const { triggerTests } = api;
    const testsToTrigger: Payload[] = [{ public_id: TRIGGERED_TEST_ID }];
    const { results, triggered_check_ids } = await triggerTests(testsToTrigger);
    expect(triggered_check_ids).toEqual([TRIGGERED_TEST_ID]);
    expect(results[0].public_id).toBe(TRIGGERED_TEST_ID);
    expect(results[0].result_id).toBe(RESULT_ID);
  });
});
