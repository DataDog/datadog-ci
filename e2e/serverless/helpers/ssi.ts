export const SSI_CASES = [
  {
    language: 'csharp',
    fixtureImageName: 'dotnet-ssi',
    tracerRepository: 'dotnet',
    nativeEnv: {name: 'CORECLR_PROFILER_PATH', value: '/datadog-lib/Datadog.Trace.ClrProfiler.Native.so'},
  },
  {
    language: 'java',
    fixtureImageName: 'java-ssi',
    tracerRepository: 'java',
    nativeEnv: {name: 'JAVA_TOOL_OPTIONS', value: '-javaagent:/datadog-lib/dd-java-agent.jar'},
  },
  {
    language: 'nodejs',
    fixtureImageName: 'node-ssi',
    tracerRepository: 'js',
    nativeEnv: {name: 'NODE_OPTIONS', value: '--require /datadog-lib/node_modules/dd-trace/init.js'},
  },
  {
    language: 'php',
    fixtureImageName: 'php-ssi',
    tracerRepository: 'php',
    nativeEnv: {name: 'PHP_INI_SCAN_DIR', value: '/datadog-lib/linux-gnu/loader'},
  },
  {
    language: 'python',
    fixtureImageName: 'python-ssi',
    tracerRepository: 'python',
    nativeEnv: {name: 'PYTHONPATH', value: '/datadog-lib'},
  },
  {
    language: 'ruby',
    fixtureImageName: 'ruby-ssi',
    tracerRepository: 'ruby',
    nativeEnv: {name: 'RUBYOPT', value: '-r/datadog-lib/auto_inject'},
  },
] as const
