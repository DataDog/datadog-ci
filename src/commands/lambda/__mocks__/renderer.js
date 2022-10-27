const renderer = jest.requireActual('../renderer')

const makeMockSpinner = () => ({
  fail: () => jest.fn(),
  start: () => jest.fn(),
  succeed: () => jest.fn(),
})

;(renderer['fetchingFunctionsConfigSpinner'] = () => makeMockSpinner()),
  (renderer['fetchingFunctionsSpinner'] = () => makeMockSpinner()),
  (renderer['updatingFunctionsSpinner'] = () => makeMockSpinner()),
  (module.exports = renderer)
