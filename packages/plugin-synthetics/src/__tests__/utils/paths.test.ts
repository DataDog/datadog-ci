import {pickPaths, withPaths} from '../../utils/paths'

describe('pickPaths', () => {
  test('picks a top-level field', () => {
    expect(pickPaths({name: 'a', other: 'b'}, ['name'])).toEqual({name: 'a'})
  })

  test('picks a nested field, preserving its nested shape', () => {
    const source = {test: {name: 'a', type: 'api', unused: 'x'}}
    expect(pickPaths(source, ['test.name', 'test.type'])).toEqual({test: {name: 'a', type: 'api'}})
  })

  test('omits a path missing from the source', () => {
    expect(pickPaths({test: {name: 'a'}}, ['test.name', 'test.missing', 'other.missing'])).toEqual({
      test: {name: 'a'},
    })
  })

  test('omits a path through a missing intermediate object', () => {
    expect(pickPaths({}, ['a.b.c'])).toEqual({})
  })

  test('does not leave a stray empty object for an intermediate key whose leaf is missing', () => {
    const source = {test: {name: 'a', options: {device_ids: []}}}
    expect(pickPaths(source, ['test.name', 'test.options.ci.executionRule'])).toEqual({test: {name: 'a'}})
  })

  test('omits a path through a null intermediate value', () => {
    // eslint-disable-next-line no-null/no-null
    expect(pickPaths({a: null}, ['a.b'])).toEqual({})
  })

  test('picks a whole array as-is when the path stops at it', () => {
    const source = {tags: ['a', 'b']}
    expect(pickPaths(source, ['tags'])).toEqual({tags: ['a', 'b']})
  })

  test('projects a field across every element of a wildcard array', () => {
    const source = {
      steps: [
        {status: 'passed', other: 1},
        {status: 'failed', other: 2},
      ],
    }
    expect(pickPaths(source, ['steps[*].status'])).toEqual({steps: [{status: 'passed'}, {status: 'failed'}]})
  })

  test('omits a missing field for one element without dropping the others', () => {
    const source = {steps: [{failure: {message: 'oops'}}, {}]}
    expect(pickPaths(source, ['steps[*].failure.message'])).toEqual({steps: [{failure: {message: 'oops'}}, {}]})
  })

  test('returns an empty array for a wildcard path over an empty array', () => {
    expect(pickPaths({steps: []}, ['steps[*].status'])).toEqual({steps: []})
  })

  test('omits a wildcard path entirely when the array itself is missing', () => {
    expect(pickPaths({}, ['steps[*].status'])).toEqual({})
  })

  test('accumulates multiple fields picked from the same wildcard array element', () => {
    const source = {steps: [{status: 'passed', name: 'step 1', unused: true}]}
    expect(pickPaths(source, ['steps[*].status', 'steps[*].name'])).toEqual({
      steps: [{status: 'passed', name: 'step 1'}],
    })
  })

  test('supports nested wildcard arrays', () => {
    const source = {steps: [{browserErrors: [{type: 'x', message: 'boom'}]}]}
    expect(pickPaths(source, ['steps[*].browserErrors[*].type'])).toEqual({
      steps: [{browserErrors: [{type: 'x'}]}],
    })
  })
})

describe('withPaths', () => {
  test('overrides only the given paths, keeping the rest of the base object untouched', () => {
    const base = {name: 'base', type: 'api', subtype: 'http'}
    expect(withPaths(base, {subtype: 'dns'}, ['subtype'])).toEqual({name: 'base', type: 'api', subtype: 'dns'})
  })

  test('leaves the base value when the source is missing the path', () => {
    const base = {config: {request: {method: 'GET'}}}
    expect(withPaths(base, {}, ['config.request.method'])).toEqual(base)
  })

  test('merges into a nested object without dropping sibling fields', () => {
    const base = {config: {assertions: [], request: {method: 'GET', url: 'http://a'}}}
    const source = {config: {request: {method: 'POST'}}}
    expect(withPaths(base, source, ['config.request.method'])).toEqual({
      config: {assertions: [], request: {method: 'POST', url: 'http://a'}},
    })
  })

  test('does not mutate the base object', () => {
    const base = {config: {request: {method: 'GET'}}}
    withPaths(base, {config: {request: {method: 'POST'}}}, ['config.request.method'])
    expect(base.config.request.method).toBe('GET')
  })

  test('replaces a whole array rather than merging it element-wise', () => {
    const base = {config: {steps: [{subtype: 'http'}, {subtype: 'http'}]}}
    const source = {config: {steps: [{subtype: 'dns'}]}}
    expect(withPaths(base, source, ['config.steps[*].subtype'])).toEqual({config: {steps: [{subtype: 'dns'}]}})
  })
})
