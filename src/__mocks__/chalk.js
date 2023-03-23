const chalk = jest.createMockFromModule('chalk')

const spit = (text) => text

const colors = ['red', 'green', 'yellow', 'cyan', 'blue', 'magenta', 'gray', 'blueBright', 'bgRed', 'bgGreen']
const modifiers = ['bold', 'underline', 'italic', 'dim', 'inverse', 'strikethrough']

for (const modifier of modifiers) {
  chalk[modifier] = spit
  for (const anotherModifier of modifiers) {
    if (modifier !== anotherModifier) {
      chalk[modifier][anotherModifier] = spit
    }
  }
}

for (const color of colors) {
  chalk[color] = spit
  for (const modifier of modifiers) {
    chalk[color][modifier] = spit
    chalk[modifier][color] = spit
  }
}

chalk.hex = (_) => ({
  bold: spit,
})

module.exports = chalk
