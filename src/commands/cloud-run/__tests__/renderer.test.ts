import {renderAuthenticationInstructions} from '../renderer'

test('renderAuthenticationInstructions', () => {
  expect(renderAuthenticationInstructions()).toMatchSnapshot()
})
