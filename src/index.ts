import fs from 'fs';

import { Cli } from 'clipanion';
import rc from 'rc';

import { CommandImport, ContextWithConfig, GlobalConfig } from './helpers/interfaces';

const onError = (err: any) => {
  console.log(err);
  process.exitCode = 1;
};

process.on('uncaughtException', onError);
process.on('unhandledRejection', onError);

const cli = new Cli<ContextWithConfig>({
  binaryLabel: 'Datadog CI',
  binaryName: 'datadog-ci',
  binaryVersion: require('../package.json').version,
});

let defaultConfig: GlobalConfig = {
  apiKey: process.env.DD_API_KEY,
  appKey: process.env.DD_APP_KEY,
  datadogHost: 'https://dd.datad0g.com/api/v1',
};

const commandsPath = `${__dirname}/commands`;
for (const commandFolder of fs.readdirSync(commandsPath)) {
  // tslint:disable-next-line: no-var-requires
  const commandImport: CommandImport[] = require(`${commandsPath}/${commandFolder}`);
  for (const command of commandImport) {
    if (command.defaultConfig) {
      defaultConfig = { ...defaultConfig, ...command.defaultConfig };
    }
    cli.register(command);
  }
}

const config = rc('datadogci', defaultConfig, { }) as GlobalConfig;

if (require.main === module) {
  cli.runExit(process.argv.slice(2), {
    config,
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
  });
}
