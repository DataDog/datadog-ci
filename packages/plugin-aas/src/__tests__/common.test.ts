import {Site} from '@azure/arm-appservice'
import {AasConfigOptions} from '@datadog/datadog-ci-base/commands/aas/common'

import {getWindowsRuntime, getEnvVars, SITE_EXTENSION_IDS, isDotnet, isLinuxContainer, isWindows} from '../common'

const DEFAULT_CONFIG: AasConfigOptions = {
  subscriptionId: '00000000-0000-0000-0000-000000000000',
  resourceGroup: 'my-resource-group',
  aasName: 'my-web-app',
  service: undefined,
  environment: undefined,
  isInstanceLoggingEnabled: false,
  logPath: undefined,
  isDotnet: false,
}

describe('aas common', () => {
  describe('getEnvVars', () => {
    let originalEnv: NodeJS.ProcessEnv
    beforeAll(() => {
      originalEnv = {...process.env}
    })

    beforeEach(() => {
      process.env.DD_API_KEY = 'test-api-key'
      delete process.env.DD_SITE
    })

    afterEach(() => {
      delete process.env.DD_API_KEY
      delete process.env.DD_SITE
    })

    afterAll(() => {
      process.env = originalEnv
    })

    test('returns required env vars with default DD_SITE', () => {
      const envVars = getEnvVars(DEFAULT_CONFIG, false)
      expect(envVars).toEqual({
        DD_API_KEY: 'test-api-key',
        DD_SITE: 'datadoghq.com',
        DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
      })
    })

    test('uses DD_SITE from environment if set', () => {
      process.env.DD_SITE = 'datadoghq.eu'
      const config: AasConfigOptions = {
        ...DEFAULT_CONFIG,
        isInstanceLoggingEnabled: true,
      }
      const envVars = getEnvVars(config, false)
      expect(envVars.DD_SITE).toEqual('datadoghq.eu')
      expect(envVars.DD_AAS_INSTANCE_LOGGING_ENABLED).toEqual('true')
    })

    test('includes DD_SERVICE if provided in config', () => {
      const config: AasConfigOptions = {
        ...DEFAULT_CONFIG,
        service: 'my-service',
      }
      const envVars = getEnvVars(config, false)
      expect(envVars.DD_SERVICE).toEqual('my-service')
    })

    test('includes DD_ENV if provided in config', () => {
      const config: AasConfigOptions = {
        ...DEFAULT_CONFIG,
        isInstanceLoggingEnabled: false,
        environment: 'prod',
      }
      const envVars = getEnvVars(config, false)
      expect(envVars.DD_ENV).toEqual('prod')
    })

    test('includes DD_SERVERLESS_LOG_PATH if provided in config', () => {
      const config: AasConfigOptions = {
        ...DEFAULT_CONFIG,
        isInstanceLoggingEnabled: false,
        logPath: '/tmp/logs',
      }
      const envVars = getEnvVars(config, false)
      expect(envVars.DD_SERVERLESS_LOG_PATH).toEqual('/tmp/logs')
    })

    test('includes all optional vars if provided', () => {
      const config: AasConfigOptions = {
        ...DEFAULT_CONFIG,
        isInstanceLoggingEnabled: true,
        service: 'svc',
        environment: 'dev',
        logPath: '/var/log',
      }
      const envVars = getEnvVars(config, false)
      expect(envVars).toMatchObject({
        DD_SERVICE: 'svc',
        DD_ENV: 'dev',
        DD_SERVERLESS_LOG_PATH: '/var/log',
        DD_AAS_INSTANCE_LOGGING_ENABLED: 'true',
      })
    })

    describe('isWindows', () => {
      test('returns true if site.kind includes "windows"', () => {
        const site: Site = {
          kind: 'app,windows',
          location: 'East US',
          siteConfig: {},
        }
        expect(isWindows(site)).toBe(true)
      })

      test('returns false if site.kind does not include "windows"', () => {
        const site: Site = {
          kind: 'app,linux',
          location: 'East US',
          siteConfig: {},
        }
        expect(isWindows(site)).toBe(false)
      })

      test('returns true if site.kind is undefined but siteConfig.windowsFxVersion is set', () => {
        const site: Site = {
          kind: undefined,
          location: 'East US',
          siteConfig: {
            windowsFxVersion: 'DOTNET|6.0',
          },
        }
        expect(isWindows(site)).toBe(true)
      })

      test('returns false if site.kind is undefined and siteConfig.windowsFxVersion is not set', () => {
        const site: Site = {
          kind: undefined,
          location: 'East US',
          siteConfig: {},
        }
        expect(isWindows(site)).toBe(false)
      })

      test('returns false if site.kind is undefined and siteConfig is undefined', () => {
        const site: Site = {
          kind: undefined,
          location: 'East US',
          siteConfig: undefined,
        }
        expect(isWindows(site)).toBe(false)
      })
    })

    test('includes .NET specific env vars when isDotnet is true', () => {
      const envVars = getEnvVars({...DEFAULT_CONFIG, isDotnet: true}, false)
      expect(envVars).toMatchObject({
        DD_DOTNET_TRACER_HOME: '/home/site/wwwroot/datadog',
        DD_TRACE_LOG_DIRECTORY: '/home/LogFiles/dotnet',
        CORECLR_ENABLE_PROFILING: '1',
        CORECLR_PROFILER: '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}',
        CORECLR_PROFILER_PATH: '/home/site/wwwroot/datadog/linux-x64/Datadog.Trace.ClrProfiler.Native.so',
      })
    })

    test('includes all .NET and optional env vars', () => {
      const config: AasConfigOptions = {
        ...DEFAULT_CONFIG,
        isDotnet: true,
        service: 'svc',
        environment: 'qa',
        logPath: '/dotnet/logs',
        isInstanceLoggingEnabled: true,
      }
      const envVars = getEnvVars(config, false)
      expect(envVars).toMatchObject({
        DD_SERVICE: 'svc',
        DD_ENV: 'qa',
        DD_SERVERLESS_LOG_PATH: '/dotnet/logs',
        DD_AAS_INSTANCE_LOGGING_ENABLED: 'true',
        DD_DOTNET_TRACER_HOME: '/home/site/wwwroot/datadog',
        DD_TRACE_LOG_DIRECTORY: '/home/LogFiles/dotnet',
        CORECLR_ENABLE_PROFILING: '1',
        CORECLR_PROFILER: '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}',
        CORECLR_PROFILER_PATH: '/home/site/wwwroot/datadog/linux-x64/Datadog.Trace.ClrProfiler.Native.so',
      })
    })

    test('.NET options sets musl path when specified', () => {
      const config: AasConfigOptions = {
        ...DEFAULT_CONFIG,
        isDotnet: true,
        isMusl: true,
        service: 'svc',
        environment: 'qa',
        logPath: '/dotnet/logs',
        isInstanceLoggingEnabled: true,
      }
      const envVars = getEnvVars(config, false)
      expect(envVars).toMatchObject({
        DD_SERVICE: 'svc',
        DD_ENV: 'qa',
        DD_SERVERLESS_LOG_PATH: '/dotnet/logs',
        DD_AAS_INSTANCE_LOGGING_ENABLED: 'true',
        DD_DOTNET_TRACER_HOME: '/home/site/wwwroot/datadog',
        DD_TRACE_LOG_DIRECTORY: '/home/LogFiles/dotnet',
        CORECLR_ENABLE_PROFILING: '1',
        CORECLR_PROFILER: '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}',
        CORECLR_PROFILER_PATH: '/home/site/wwwroot/datadog/linux-musl-x64/Datadog.Trace.ClrProfiler.Native.so',
      })
    })

    test('includes all .NET and optional env vars properly for containers', () => {
      const config: AasConfigOptions = {
        ...DEFAULT_CONFIG,
        isDotnet: true,
        service: 'svc',
        environment: 'qa',
        logPath: '/dotnet/logs',
        isInstanceLoggingEnabled: true,
      }
      const envVars = getEnvVars(config, true)
      expect(envVars).toMatchObject({
        DD_SERVICE: 'svc',
        DD_ENV: 'qa',
        DD_SERVERLESS_LOG_PATH: '/dotnet/logs',
        DD_AAS_INSTANCE_LOGGING_ENABLED: 'true',
        DD_DOTNET_TRACER_HOME: '/datadog/tracer',
        DD_TRACE_LOG_DIRECTORY: '/home/LogFiles/dotnet',
        CORECLR_ENABLE_PROFILING: '1',
        CORECLR_PROFILER: '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}',
        CORECLR_PROFILER_PATH: '/datadog/tracer/linux-x64/Datadog.Trace.ClrProfiler.Native.so',
      })
    })

    test('.NET options sets musl path when specified properly for containers', () => {
      const config: AasConfigOptions = {
        ...DEFAULT_CONFIG,
        isDotnet: true,
        isMusl: true,
        service: 'svc',
        environment: 'qa',
        logPath: '/dotnet/logs',
        isInstanceLoggingEnabled: true,
      }
      const envVars = getEnvVars(config, true)
      expect(envVars).toMatchObject({
        DD_SERVICE: 'svc',
        DD_ENV: 'qa',
        DD_SERVERLESS_LOG_PATH: '/dotnet/logs',
        DD_AAS_INSTANCE_LOGGING_ENABLED: 'true',
        DD_DOTNET_TRACER_HOME: '/datadog/tracer',
        DD_TRACE_LOG_DIRECTORY: '/home/LogFiles/dotnet',
        CORECLR_ENABLE_PROFILING: '1',
        CORECLR_PROFILER: '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}',
        CORECLR_PROFILER_PATH: '/datadog/tracer/linux-musl-x64/Datadog.Trace.ClrProfiler.Native.so',
      })
    })

    test('includes DD_TAGS when extraTags is provided', () => {
      const config: AasConfigOptions = {
        ...DEFAULT_CONFIG,
        extraTags: 'custom:tag,another:value',
      }
      const envVars = getEnvVars(config, false)
      expect(envVars.DD_TAGS).toEqual('custom:tag,another:value')
    })

    test('does not include DD_TAGS when extraTags is not provided', () => {
      const envVars = getEnvVars(DEFAULT_CONFIG, false)
      expect(envVars.DD_TAGS).toBeUndefined()
    })
  })

  describe('isDotnet', () => {
    test('returns true if linuxFxVersion starts with "dotnet"', () => {
      const site: Site = {
        kind: 'app,linux',
        location: 'East US',
        siteConfig: {
          linuxFxVersion: 'dotnet|6.0',
        },
      }
      expect(isDotnet(site)).toBe(true)
    })

    test('returns true if windowsFxVersion starts with "dotnet"', () => {
      const site: Site = {
        kind: 'app,windows',
        location: 'East US',
        siteConfig: {
          windowsFxVersion: 'dotnet|7.0',
        },
      }
      expect(isDotnet(site)).toBe(true)
    })

    test('returns false if linuxFxVersion does not start with "dotnet"', () => {
      const site: Site = {
        kind: 'app,linux',
        location: 'East US',
        siteConfig: {
          linuxFxVersion: 'node|18-lts',
        },
      }
      expect(isDotnet(site)).toBe(false)
    })

    test('returns false if windowsFxVersion does not start with "dotnet"', () => {
      const site: Site = {
        kind: 'app,windows',
        location: 'East US',
        siteConfig: {
          windowsFxVersion: 'node|18-lts',
        },
      }
      expect(isDotnet(site)).toBe(false)
    })

    test('returns false if siteConfig is undefined', () => {
      const site: Site = {
        kind: 'app,windows',
        location: 'East US',
        siteConfig: undefined,
      }
      expect(isDotnet(site)).toBe(false)
    })
  })

  describe('isLinuxContainer', () => {
    test('returns true if linuxFxVersion is "sitecontainers"', () => {
      const site: Site = {
        kind: 'app,linux',
        location: 'East US',
        siteConfig: {
          linuxFxVersion: 'sitecontainers',
        },
      }
      expect(isLinuxContainer(site)).toBe(true)
    })

    test('returns true if linuxFxVersion is "SITECONTAINERS" (case insensitive)', () => {
      const site: Site = {
        kind: 'app,linux',
        location: 'East US',
        siteConfig: {
          linuxFxVersion: 'SITECONTAINERS',
        },
      }
      expect(isLinuxContainer(site)).toBe(true)
    })

    test('returns true if linuxFxVersion starts with "docker|"', () => {
      const site: Site = {
        kind: 'app,linux',
        location: 'East US',
        siteConfig: {
          linuxFxVersion: 'docker|myregistry.azurecr.io/myimage:latest',
        },
      }
      expect(isLinuxContainer(site)).toBe(true)
    })

    test('returns true if linuxFxVersion starts with "DOCKER|" (case insensitive)', () => {
      const site: Site = {
        kind: 'app,linux',
        location: 'East US',
        siteConfig: {
          linuxFxVersion: 'DOCKER|myregistry.azurecr.io/myimage:latest',
        },
      }
      expect(isLinuxContainer(site)).toBe(true)
    })

    test('returns true if linuxFxVersion starts with "compose|"', () => {
      const site: Site = {
        kind: 'app,linux',
        location: 'East US',
        siteConfig: {
          linuxFxVersion: 'compose|base64encodedcomposefile',
        },
      }
      expect(isLinuxContainer(site)).toBe(true)
    })

    test('returns true if linuxFxVersion starts with "COMPOSE|" (case insensitive)', () => {
      const site: Site = {
        kind: 'app,linux',
        location: 'East US',
        siteConfig: {
          linuxFxVersion: 'COMPOSE|base64encodedcomposefile',
        },
      }
      expect(isLinuxContainer(site)).toBe(true)
    })

    test('returns false if linuxFxVersion is a non-container value', () => {
      const site: Site = {
        kind: 'app,linux',
        location: 'East US',
        siteConfig: {
          linuxFxVersion: 'node|18-lts',
        },
      }
      expect(isLinuxContainer(site)).toBe(false)
    })

    test('returns false if linuxFxVersion is undefined', () => {
      const site: Site = {
        kind: 'app,linux',
        location: 'East US',
        siteConfig: {
          linuxFxVersion: undefined,
        },
      }
      expect(isLinuxContainer(site)).toBe(false)
    })

    test('returns false if siteConfig is undefined', () => {
      const site: Site = {
        kind: 'app,linux',
        location: 'East US',
        siteConfig: undefined,
      }
      expect(isLinuxContainer(site)).toBe(false)
    })

    test('returns false if siteConfig.linuxFxVersion is empty string', () => {
      const site: Site = {
        kind: 'app,linux',
        location: 'East US',
        siteConfig: {
          linuxFxVersion: '',
        },
      }
      expect(isLinuxContainer(site)).toBe(false)
    })
  })

  describe('getWindowsRuntime', () => {
    test('returns "node" if nodeVersion is set', () => {
      const site: Site = {
        kind: 'app,windows',
        location: 'East US',
        siteConfig: {
          nodeVersion: '18',
        },
      }
      expect(getWindowsRuntime(site)).toBe('node')
    })

    test('returns "node" if WEBSITE_NODE_DEFAULT_VERSION is set', () => {
      const site: Site = {
        kind: 'app,windows',
        location: 'East US',
        siteConfig: {
          appSettings: [{name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '18'}],
        },
      }
      expect(getWindowsRuntime(site)).toBe('node')
    })

    test('returns "dotnet" if netFrameworkVersion is set', () => {
      const site: Site = {
        kind: 'app,windows',
        location: 'East US',
        siteConfig: {
          netFrameworkVersion: 'v6.0',
        },
      }
      expect(getWindowsRuntime(site)).toBe('dotnet')
    })

    test('returns "dotnet" if netFrameworkVersion is set (case check)', () => {
      const site: Site = {
        kind: 'app,windows',
        location: 'East US',
        siteConfig: {
          netFrameworkVersion: 'v7.0',
        },
      }
      expect(getWindowsRuntime(site)).toBe('dotnet')
    })

    test('returns "java" if javaVersion is set', () => {
      const site: Site = {
        kind: 'app,windows',
        location: 'East US',
        siteConfig: {
          javaVersion: '11',
        },
      }
      expect(getWindowsRuntime(site)).toBe('java')
    })

    test('returns "java" if javaVersion is set (another version)', () => {
      const site: Site = {
        kind: 'app,windows',
        location: 'East US',
        siteConfig: {
          javaVersion: '17',
        },
      }
      expect(getWindowsRuntime(site)).toBe('java')
    })

    test('returns undefined if no runtime version is set', () => {
      const site: Site = {
        kind: 'app,windows',
        location: 'East US',
        siteConfig: {},
      }
      expect(getWindowsRuntime(site)).toBeUndefined()
    })

    test('returns undefined if siteConfig is not set', () => {
      const site: Site = {
        kind: 'app,windows',
        location: 'East US',
      }
      expect(getWindowsRuntime(site)).toBeUndefined()
    })
  })
})
