const renderer = jest.requireActual('../renderer')

const makeMockSpinner = () => {
  const f = jest.fn()
  return jest.fn(() => ({
    fail: f,
    start: f,
    succeed: f,
  }))
}

renderer['fetchingFunctionsConfigSpinner'] = makeMockSpinner()
renderer['fetchingFunctionsSpinner'] = makeMockSpinner()
renderer['updatingFunctionsSpinner'] = makeMockSpinner()

module.exports = renderer
