import chalk from 'chalk';
import rc from 'rc';

import * as synthetics from './commands/synthetics';
import { GlobalConfig } from './helpers/interfaces';

const onError = (err: any) => {
  console.log(err);
  process.exitCode = 1;
};

process.on('uncaughtException', onError);
process.on('unhandledRejection', onError);

const defaultConfig: GlobalConfig = {
  apiKey: process.env.DD_API_KEY,
  appKey: process.env.DD_APP_KEY,
  datadogHost: 'https://dd.datad0g.com/api/v1',
  synthetics: {
    files: '{,!(node_modules)/**/}*.synthetics.json',
    global: { },
    timeout: 2 * 60 * 1000,
  },
};

export async function main () {
  const config = rc('synthetics', defaultConfig);

  const command = config._[0];

  if (!command || config.help || config.usage) {
    displayUsage();

    return;
  }

  if (!config.apiKey || !config.appKey) {
    console.log(`Missing ${chalk.red.bold('DD_API_KEY')} and/or ${chalk.red.bold('DD_APP_KEY')} in your environment.`);
    process.exitCode = 1;

    return;
  }

  try {
    if (command === 'synthetics') {
      process.exitCode = await synthetics.run(config);
    }
  } catch (error) {
    console.log(`\n${chalk.bgRed.bold(' ERROR ')}\n${error.toString()}\n`);
    // Exit the program accordingly.
    process.exitCode = 1;
  }
}

function displayUsage () {
  const usage = `Usage: datadog-ci [options] <command> [cmdOptions] <subCommand> [subCmdOptions]

  Options:
  --appKey   [appKey]    Application Key
  --apiKey   [apiKey]    API Key
  --apiUrl   [url]       API URL (default: "${defaultConfig.datadogHost}")
  --files    [files]     Files to include (default: "${defaultConfig.synthetics!.files}")
  --timeout  [timeout]   Timeout in ms (default: ${defaultConfig.synthetics!.timeout})
  --config   [file]      Path to config file`;

  console.log(usage);
}

if (require.main === module) {
  main();
}
