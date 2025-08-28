const makeMockSpinner = () => {
  return () => ({
    fail: jest.fn(),
    start: jest.fn(),
    succeed: jest.fn(),
    warn: jest.fn(),
  })
}

export = {
  ...jest.requireActual('../instrument-uninstrument-renderer'),
  fetchingFunctionsConfigSpinner: makeMockSpinner(),
  fetchingFunctionsSpinner: makeMockSpinner(),
  updatingFunctionsConfigFromRegionSpinner: makeMockSpinner(),
  updatingFunctionsSpinner: makeMockSpinner(),
}
