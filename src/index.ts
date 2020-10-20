import {CommandClass} from 'clipanion/lib/advanced/Command'
import fs from 'fs'

import {Cli} from 'clipanion'

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
  const commandPath = `${commandsPath}/${commandFolder}`
  if (fs.statSync(commandPath).isDirectory()) {
    // tslint:disable-next-line: no-var-requires
    require(commandPath).forEach((command: CommandClass) => cli.register(command))
  }
}

if (require.main === module) {
  cli.runExit(process.argv.slice(2), {
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
  })
}
