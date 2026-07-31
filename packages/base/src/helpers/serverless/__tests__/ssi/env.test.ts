import {
  EnvFragmentConflictError,
  SINGLE_LANGUAGE_INJECTION_MODE_TAG,
  hasEnvFragment,
  hasInjectionModeTag,
  mergeEnvFragment,
  mergeInjectionModeTag,
  removeEnvFragment,
  removeInjectionModeTag,
  type EnvFragment,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'

describe('environment fragment merging', () => {
  const appendFragment: EnvFragment = {
    name: 'NODE_OPTIONS',
    value: '--require /datadog-lib/node_modules/dd-trace/init.js',
    separator: ' ',
    direction: 'append',
  }
  const prependFragment: EnvFragment = {
    name: 'RUBYOPT',
    value: '-r/datadog-lib/auto_inject',
    separator: ' ',
    direction: 'prepend',
  }
  const scalarFragment: EnvFragment = {
    name: 'CORECLR_ENABLE_PROFILING',
    value: '1',
    direction: 'set-if-absent',
  }

  test.each([
    {fragment: appendFragment, current: undefined, merged: appendFragment.value},
    {fragment: appendFragment, current: '', merged: appendFragment.value},
    {fragment: appendFragment, current: '--inspect', merged: `--inspect ${appendFragment.value}`},
    {fragment: prependFragment, current: undefined, merged: prependFragment.value},
    {fragment: prependFragment, current: '', merged: prependFragment.value},
    {fragment: prependFragment, current: '-w', merged: `${prependFragment.value} -w`},
    {fragment: scalarFragment, current: undefined, merged: '1'},
    {fragment: scalarFragment, current: '', merged: '1'},
    {fragment: scalarFragment, current: '1', merged: '1'},
  ])('merges $fragment.direction fragments', ({fragment, current, merged}) => {
    expect(mergeEnvFragment(current, fragment)).toBe(merged)
  })

  test.each([
    {fragment: appendFragment, current: `--inspect ${appendFragment.value}`},
    {fragment: prependFragment, current: `${prependFragment.value} -w`},
    {fragment: appendFragment, current: `${appendFragment.value} --inspect ${appendFragment.value}`},
    {fragment: prependFragment, current: `${prependFragment.value} -w ${prependFragment.value}`},
  ])('deduplicates exact $fragment.direction fragments', ({fragment, current}) => {
    const merged = mergeEnvFragment(current, fragment)
    expect(merged.split(fragment.value)).toHaveLength(2)
    expect(merged.startsWith(fragment.value)).toBe(fragment.direction === 'prepend')
    expect(merged.endsWith(fragment.value)).toBe(fragment.direction === 'append')
  })

  test.each([
    {fragment: appendFragment, current: appendFragment.value, present: true},
    {fragment: appendFragment, current: `${appendFragment.value}.backup`, present: false},
    {fragment: prependFragment, current: `${prependFragment.value} -w`, present: true},
    {fragment: scalarFragment, current: '1', present: true},
    {fragment: scalarFragment, current: '0', present: false},
    {fragment: scalarFragment, current: undefined, present: false},
  ])('detects exact $fragment.direction fragments', ({fragment, current, present}) => {
    expect(hasEnvFragment(current, fragment)).toBe(present)
  })

  test('does not match similarly named substrings', () => {
    const similar = `${appendFragment.value}.backup`
    expect(mergeEnvFragment(similar, appendFragment)).toBe(`${similar} ${appendFragment.value}`)
    expect(removeEnvFragment(similar, appendFragment)).toBe(similar)
  })

  test.each([
    {fragment: appendFragment, current: '--inspect'},
    {fragment: prependFragment, current: '-w'},
    {
      fragment: {name: 'PYTHONPATH', value: '/datadog-lib', separator: ':', direction: 'append'} as EnvFragment,
      current: '/app:/vendor',
    },
    {
      fragment: {name: 'PHP_INI_SCAN_DIR', value: ':/datadog-lib/linux-gnu/loader', direction: 'append'} as EnvFragment,
      current: '/etc/php/conf.d',
    },
  ])('merge then remove restores $current for $fragment.name', ({fragment, current}) => {
    expect(removeEnvFragment(mergeEnvFragment(current, fragment), fragment)).toBe(current)
  })

  test('deduplicates and exactly removes PHP config from the middle of a path list', () => {
    const fragment: EnvFragment = {
      name: 'PHP_INI_SCAN_DIR',
      value: ':/datadog-lib/linux-gnu/loader',
      direction: 'append',
    }
    const current = `/etc/php${fragment.value}:/custom/php${fragment.value}`
    expect(mergeEnvFragment(current, fragment)).toBe(`/etc/php:/custom/php${fragment.value}`)
    expect(removeEnvFragment(`/etc/php${fragment.value}:/custom/php`, fragment)).toBe('/etc/php:/custom/php')
    expect(removeEnvFragment(`/etc/php${fragment.value}.backup`, fragment)).toBe(`/etc/php${fragment.value}.backup`)
  })

  test('preserves pre-existing separator formatting', () => {
    const current = '--inspect  --trace-warnings '
    const merged = mergeEnvFragment(current, appendFragment)
    expect(merged).toBe(`${current} ${appendFragment.value}`)
    expect(removeEnvFragment(merged, appendFragment)).toBe(current)
  })

  test('preserves a changed owned scalar during removal', () => {
    expect(removeEnvFragment('0', scalarFragment)).toBe('0')
  })

  test('reports a scalar conflict instead of overwriting it', () => {
    expect(() => mergeEnvFragment('0', scalarFragment)).toThrow(EnvFragmentConflictError)
  })

  const dotnetPreloadFragment: EnvFragment = {
    name: 'LD_PRELOAD',
    value: '/datadog-lib/continuousprofiler/Datadog.Linux.ApiWrapper.x64.so',
    separator: ' ',
    direction: 'prepend',
    maxLength: 1024,
  }

  test('enforces the .NET LD_PRELOAD byte limit after prepending', () => {
    const fragment = dotnetPreloadFragment
    expect(mergeEnvFragment('x'.repeat(1024 - Buffer.byteLength(fragment.value) - 1), fragment)).toHaveLength(1024)
    expect(() => mergeEnvFragment('x'.repeat(1024 - Buffer.byteLength(fragment.value)), fragment)).toThrow(
      '1024-byte limit'
    )
  })

  test.each([undefined, 'libother.so', '/datadog-lib/continuousprofiler/Datadog.Linux.ApiWrapper.x64.so'])(
    'prepends and deduplicates the .NET wrapper for %p',
    (current) => {
      const fragment = dotnetPreloadFragment
      const merged = mergeEnvFragment(current, fragment)
      expect(merged.startsWith(fragment.value)).toBe(true)
      expect(merged.split(fragment.value)).toHaveLength(2)
    }
  )

  test('treats an empty current value as absent during removal', () => {
    expect(removeEnvFragment('', appendFragment)).toBeUndefined()
    expect(removeEnvFragment('', scalarFragment)).toBeUndefined()
  })

  test.each(['line\nbreak', 'nul\0value'])('rejects malformed current value %p', (current) => {
    expect(() => hasEnvFragment(current, appendFragment)).toThrow('Existing value')
    expect(() => mergeEnvFragment(current, appendFragment)).toThrow('Existing value')
    expect(() => removeEnvFragment(current, appendFragment)).toThrow('Existing value')
  })

  test.each([
    {...appendFragment, name: ''},
    {...appendFragment, value: ''},
    {...appendFragment, value: 'line\nbreak'},
    {...appendFragment, maxLength: 0},
    {...scalarFragment, separator: ' ' as const},
  ])('rejects malformed fragment %#', (fragment) => {
    expect(() => hasEnvFragment(undefined, fragment)).toThrow()
    expect(() => mergeEnvFragment(undefined, fragment)).toThrow()
  })
})

describe('injection mode tag', () => {
  const tag = SINGLE_LANGUAGE_INJECTION_MODE_TAG

  test.each([
    {current: undefined, merged: tag},
    {current: 'env:prod', merged: `${tag},env:prod`},
    {current: tag, merged: tag},
    {current: `${tag},env:prod`, merged: `${tag},env:prod`},
    {current: `env:prod,${tag}`, merged: `${tag},env:prod`},
    {current: `env:prod,${tag},team:serverless`, merged: `${tag},env:prod,team:serverless`},
    {current: `${tag},env:prod,${tag}`, merged: `${tag},env:prod`},
  ])('merges exactly once into $current', ({current, merged}) => {
    expect(mergeInjectionModeTag(current)).toBe(merged)
    expect(mergeInjectionModeTag(merged)).toBe(merged)
  })

  test.each([
    {current: undefined, present: false},
    {current: tag, present: true},
    {current: `${tag},env:prod`, present: true},
    {current: `env:prod,${tag}`, present: true},
    {current: `${tag}-other`, present: false},
  ])('detects the exact tag in $current', ({current, present}) => {
    expect(hasInjectionModeTag(current)).toBe(present)
  })

  test.each([
    {current: undefined, removed: undefined},
    {current: tag, removed: undefined},
    {current: `${tag},env:prod`, removed: 'env:prod'},
    {current: `env:prod,${tag}`, removed: 'env:prod'},
    {current: `env:prod,${tag},team:serverless`, removed: 'env:prod,team:serverless'},
  ])('removes only the exact tag from $current', ({current, removed}) => {
    expect(removeInjectionModeTag(current)).toBe(removed)
  })

  test('preserves similarly named and whitespace-prefixed tags', () => {
    const current = `${tag}-other, ${tag},env:prod`
    expect(removeInjectionModeTag(current)).toBe(current)
    expect(mergeInjectionModeTag(current)).toBe(`${tag},${current}`)
  })
})
