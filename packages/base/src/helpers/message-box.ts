import chalk, {ForegroundColor} from 'chalk'

const messageBoxString = (title: string, color: typeof ForegroundColor, message: string | string[]): string => {
  let result = ''
  result += chalk.bold[color](`┏━ [${title}]\n`)
  if (typeof message === 'string') {
    message.split('\n').forEach((line) => {
      result += `${chalk.bold[color]('┃ ') + line}\n`
    })
  } else {
    message.forEach((line) => {
      result += `${chalk.bold[color]('┃ ') + line}\n`
    })
  }
  result += chalk.bold[color]('┗━')

  return result
}

export const messageBox = (title: string, color: typeof ForegroundColor, message: string | string[]): void => {
  console.log(messageBoxString(title, color, message))
}
