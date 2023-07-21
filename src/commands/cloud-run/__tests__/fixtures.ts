import {Cli} from 'clipanion'

import {CloudRunFlareCommand} from '../flare'

export const makeCli = () => {
  const cli = new Cli()
  cli.register(CloudRunFlareCommand)

  return cli
}
