/**
 * @file Functions used to prompt the user for input.
 */

import inquirer from 'inquirer'

export const confirmationQuestion = (message: string, defaultValue = true): inquirer.ConfirmQuestion => ({
  message,
  name: 'confirmation',
  type: 'confirm',
  default: defaultValue,
})

export const requestConfirmation = async (message: string, defaultValue = true) => {
  try {
    const confirmationAnswer = await inquirer.prompt(confirmationQuestion(message, defaultValue))

    return confirmationAnswer.confirmation
  } catch (e) {
    if (e instanceof Error) {
      throw Error(`Couldn't receive confirmation. ${e.message}`)
    }
  }
}

export const requestFilePath = async () => {
  try {
    const filePathAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'filePath',
        message: 'Please enter a file path, or press Enter to finish:',
      },
    ])

    return filePathAnswer.filePath
  } catch (e) {
    if (e instanceof Error) {
      throw Error(`Couldn't receive file path. ${e.message}`)
    }
  }
}
