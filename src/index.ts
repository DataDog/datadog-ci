import { Cli, Command } from 'clipanion';
import rc from 'rc';

import { CommandImport, GlobalConfig } from './helpers/interfaces';
import { getCommandFileNames } from './helpers/utils';

const onError = (err: any) => {
  console.log(err);
  process.exitCode = 1;
};

process.on('uncaughtException', onError);
process.on('unhandledRejection', onError);

let defaultConfig: GlobalConfig = {
  apiKey: process.env.DD_API_KEY,
  appKey: process.env.DD_APP_KEY,
  datadogHost: 'https://dd.datad0g.com/api/v1',
};

const cli = new Cli({
  binaryLabel: 'Datadog CI',
  binaryName: 'datadog-ci',
  binaryVersion: '0.0.1',
});

export abstract class MainCommand extends Command {
  protected apiKey?: string;
  protected appKey?: string;
  protected config: GlobalConfig;

  constructor () {
    super();

    // Pass an empty argv to disable its parsing by rc as clipanion already does it
    this.config = rc('datadog-ci', defaultConfig, { }) as GlobalConfig;
  }
}
MainCommand.addOption('apiKey', Command.String('--apiKey'));
MainCommand.addOption('appKey', Command.String('--appKey'));

const commandsPath = `${__dirname}/commands`;
for (const commandFileName of getCommandFileNames(commandsPath)) {
  // tslint:disable-next-line: no-var-requires
  const commandImport: CommandImport = require(commandFileName);
  for (const command of Object.values(commandImport)) {
    if (command.defaultConfig) {
      defaultConfig = { ...defaultConfig, ...command.defaultConfig };
    }
    cli.register(command);
  }
}

if (require.main === module) {
  cli.runExit(process.argv.slice(2), {
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
  });
}
