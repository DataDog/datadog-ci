import fs from 'fs'

import {Cli} from 'clipanion'
import {CommandClass} from 'clipanion/lib/advanced/Command'

const BETA_COMMANDS = ['']

const onError = (err: any) => {
  console.log(err)
  process.exitCode = 1
}

process.on('uncaughtException', onError)
process.on('unhandledRejection', onError)

const cli = new Cli({
  binaryLabel: 'Datadog CI',
  binaryName: 'datadog-ci',
  binaryVersion: require('../package.json').version,
})

const commandsPath = `${__dirname}/commands`
for (const commandFolder of fs.readdirSync(commandsPath)) {
  if (BETA_COMMANDS.includes(commandFolder)) {
    continue
  }
  const commandPath = `${commandsPath}/${commandFolder}`
  if (fs.statSync(commandPath).isDirectory()) {
    require(`${commandPath}/cli`).forEach((command: CommandClass) => cli.register(command))
  }
}

if (require.main === module) {
  void cli.runExit(process.argv.slice(2), {
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
  })
}
