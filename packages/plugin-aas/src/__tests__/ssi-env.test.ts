import {parseLinuxFxVersion} from '../ssi'
import {getStagedRoot, mergeAasSsiEnv, removeAasSsiEnv} from '../ssi-env'

const DIGEST = `sha256:${'a'.repeat(64)}`

describe('getStagedRoot', () => {
  it('strips the digest algorithm prefix so colon-delimited settings keep working', () => {
    const root = getStagedRoot(parseLinuxFxVersion('PYTHON|3.12'), '4.0.0', DIGEST)

    expect(root).toBe(`/home/data/datadog-tracer/python/4.0.0-${'a'.repeat(64)}`)
    expect(root).not.toContain('sha256:')
  })
})

describe('mergeAasSsiEnv and removeAasSsiEnv round-trips', () => {
  it('restores a colon-delimited PYTHONPATH exactly', () => {
    const root = getStagedRoot(parseLinuxFxVersion('PYTHON|3.12'), '4.0.0', DIGEST)
    const original = {PYTHONPATH: '/opt/customer/lib:/opt/other/lib'}
    const merged = mergeAasSsiEnv(original, parseLinuxFxVersion('PYTHON|3.12'), root)

    expect(merged.PYTHONPATH?.split(':')).toContain(root)

    expect(removeAasSsiEnv(merged).PYTHONPATH).toBe(original.PYTHONPATH)
  })

  it('removes the staged .NET profiler settings so the app cannot crash on startup', () => {
    const root = getStagedRoot(parseLinuxFxVersion('DOTNETCORE|8.0'), '1.2.3', DIGEST)
    const merged = mergeAasSsiEnv({}, parseLinuxFxVersion('DOTNETCORE|8.0'), root)
    expect(merged.CORECLR_ENABLE_PROFILING).toBe('1')
    expect(merged.CORECLR_PROFILER_PATH).toContain(root)

    const removed = removeAasSsiEnv(merged)
    expect(removed.CORECLR_ENABLE_PROFILING).toBeUndefined()
    expect(removed.CORECLR_PROFILER).toBeUndefined()
    expect(removed.CORECLR_PROFILER_PATH).toBeUndefined()
    expect(removed.DD_DOTNET_TRACER_HOME).toBeUndefined()
    expect(removed.LD_PRELOAD).toBeUndefined()
  })

  it('preserves customer-owned CLR profiling flags when no staged tracer is present', () => {
    const legacy = {
      CORECLR_ENABLE_PROFILING: '1',
      CORECLR_PROFILER: '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}',
      CORECLR_PROFILER_PATH: '/home/site/wwwroot/datadog/linux-x64/Datadog.Trace.ClrProfiler.Native.so',
    }

    expect(removeAasSsiEnv(legacy)).toMatchObject(legacy)
  })

  it('applies the injection mode tag idempotently and removes only that tag', () => {
    const root = getStagedRoot(parseLinuxFxVersion('NODE|22-lts'), '6.0.0', DIGEST)
    const once = mergeAasSsiEnv({DD_TAGS: 'team:checkout'}, parseLinuxFxVersion('NODE|22-lts'), root)
    const twice = mergeAasSsiEnv(once, parseLinuxFxVersion('NODE|22-lts'), root)

    expect(twice.DD_TAGS).toBe(once.DD_TAGS)
    expect(once.DD_TAGS).toContain('team:checkout')
    expect(once.DD_TAGS).toContain('_dd.injection.mode:serverless-single-lang')

    expect(removeAasSsiEnv(twice).DD_TAGS).toBe('team:checkout')
  })
})
