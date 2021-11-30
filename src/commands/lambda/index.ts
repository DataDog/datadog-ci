import { Command } from 'clipanion/lib/advanced'
import { prompt } from 'inquirer'
import {InstrumentCommand} from './instrument'
import {UninstrumentCommand} from './uninstrument'

class LambdaCommand extends Command {
  static paths = [[`lambda`]];
  public async execute() {
    prompt({
      type: 'input',
      name: 'test',
      message: 'How would you define the datadog-ci package?',
      default: "It's lit!",
    }).then((answers) => {
      console.log('\nNoted chief!');
      console.log(JSON.stringify(answers, null, '  '));
    });
  }
}

module.exports = [InstrumentCommand, LambdaCommand, UninstrumentCommand]
