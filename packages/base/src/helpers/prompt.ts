/**
 * @file Functions used to prompt the user for input.
 */

import type {ConfirmConfig, InputConfig} from './inquirer'

import {loadPrompts} from './inquirer'

export const confirmationQuestion = (message: string, defaultValue = true): ConfirmConfig => ({
  message,
  default: defaultValue,
})

export const requestConfirmation = async (message: string, defaultValue = true) => {
  try {
    const {confirm} = await loadPrompts()

    return await confirm(confirmationQuestion(message, defaultValue))
  } catch (err) {
    if (err instanceof Error) {
      throw Error(`Couldn't receive confirmation. ${err.message}`)
    }
    throw err
  }
}

export const requestFilePath = async () => {
  try {
    const question: InputConfig = {
      message: 'Please enter a file path, or press Enter to finish:',
    }
    const {input} = await loadPrompts()

    return await input(question)
  } catch (err) {
    if (err instanceof Error) {
      throw Error(`Couldn't receive file path. ${err.message}`)
    }
    throw err
  }
}
