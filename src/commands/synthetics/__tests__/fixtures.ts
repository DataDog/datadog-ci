import {MainReporter, PollResult, Step, Test, User} from '../interfaces'

const mockUser: User = {
  email: '',
  handle: '',
  id: 42,
  name: '',
}

export const mockReporter: MainReporter = {
  error: jest.fn(),
  initErrors: jest.fn(),
  log: jest.fn(),
  reportStart: jest.fn(),
  runEnd: jest.fn(),
  testEnd: jest.fn(),
  testTrigger: jest.fn(),
  testWait: jest.fn(),
}

export const getApiTest = (publicId: string): Test => ({
  config: {
    assertions: [],
    request: {
      headers: {},
      method: 'GET',
      timeout: 60000,
      url: 'http://fake.url',
    },
    variables: [],
  },
  created_at: '',
  created_by: mockUser,
  locations: [],
  message: '',
  modified_at: '',
  modified_by: mockUser,
  monitor_id: 0,
  name: '',
  options: {
    device_ids: [],
    min_failure_duration: 0,
    min_location_failed: 0,
    tick_every: 3600,
  },
  overall_state: 0,
  overall_state_modified: '',
  public_id: publicId,
  status: '',
  stepCount: 0,
  subtype: 'http',
  tags: [],
  type: 'api',
})

export const getStep = (): Step => ({
  allowFailure: false,
  browserErrors: [],
  description: 'description',
  duration: 1000,
  skipped: false,
  stepId: -1,
  type: 'type',
  url: 'about:blank',
  value: 'value',
  vitalsMetrics: [
    {
      cls: 1,
      lcp: 1,
      url: 'http://fake.url',
    },
  ],
  warnings: [],
})

export const getResult = (): PollResult => ({
  dc_id: 1,
  result: {
    device: {
      height: 1,
      id: 'chrome',
      width: 1,
    },
    eventType: 'event',
    passed: true,
    stepDetails: [],
  },
  resultID: '123',
  timestamp: 1,
})
