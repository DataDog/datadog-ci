import * as crypto from 'crypto'

import {Command} from 'clipanion'

class TestFipsCommand extends Command {
  public static paths = [['TestFips']]

  public async execute() {
    console.log('before', crypto.getFips())
    crypto.setFips(true)
    console.log('after', crypto.getFips())
    crypto.createHash('md5')

    return 0
  }
}

module.exports = [TestFipsCommand]
