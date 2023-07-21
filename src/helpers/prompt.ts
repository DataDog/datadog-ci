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
