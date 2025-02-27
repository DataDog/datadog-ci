/**
 * @file Functions used to prompt the user for input.
 */

import inquirer from 'inquirer'

export const confirmationQuestion = (
  message: string,
  defaultValue = true
): inquirer.ConfirmQuestion<{confirmation: boolean}> => ({
  message,
  name: 'confirmation',
  type: 'confirm',
  default: defaultValue,
})

export const requestConfirmation = async (message: string, defaultValue = true) => {
  try {
    const confirmationAnswer = await inquirer.prompt(confirmationQuestion(message, defaultValue))

    return confirmationAnswer.confirmation
  } catch (err) {
    if (err instanceof Error) {
      throw Error(`Couldn't receive confirmation. ${err.message}`)
    }
    throw err
  }
}

export const requestFilePath = async () => {
  try {
    const question: inquirer.InputQuestion<{filePath: string}> = {
      type: 'input',
      name: 'filePath',
      message: 'Please enter a file path, or press Enter to finish:',
    }
    const filePathAnswer = await inquirer.prompt([question])

    return filePathAnswer.filePath
  } catch (err) {
    if (err instanceof Error) {
      throw Error(`Couldn't receive file path. ${err.message}`)
    }
    throw err
  }
}
