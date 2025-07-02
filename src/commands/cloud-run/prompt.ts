import inquirer from 'inquirer'

import {CI_SITE_ENV_VAR, DATADOG_SITES} from '../../constants'

const checkboxPlusPrompt = require('inquirer-checkbox-plus-prompt')
inquirer.registerPrompt('checkbox-plus', checkboxPlusPrompt)

export const requestGCPProject = async (): Promise<string> => {
  const answer = await inquirer.prompt({
    message: 'Enter GCP Project ID:',
    name: 'project',
    type: 'input',
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return 'Project ID is required.'
      }

      return true
    },
  })

  return answer.project
}

export const requestGCPRegion = async (defaultRegion?: string): Promise<string> => {
  const answer = await inquirer.prompt({
    default: defaultRegion || 'us-central1',
    message: 'Enter GCP Region:',
    name: 'region',
    type: 'input',
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return 'Region is required.'
      }

      return true
    },
  })

  return answer.region
}

export const requestServiceName = async (): Promise<string> => {
  const answer = await inquirer.prompt({
    message: 'Enter Cloud Run service name:',
    name: 'serviceName',
    type: 'input',
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return 'Service name is required.'
      }

      return true
    },
  })

  return answer.serviceName
}

export const requestSite = async (): Promise<string> => {
  const answer = await inquirer.prompt({
    choices: DATADOG_SITES,
    message: 'Select a Datadog Site:',
    name: 'site',
    type: 'list',
  })

  return answer.site
}

export const requestConfirmation = async (message: string, defaultValue = true) => {
  const confirmationAnswer = await inquirer.prompt({
    message,
    name: 'confirmation',
    type: 'confirm',
    default: defaultValue,
  })

  return confirmationAnswer.confirmation !== false
}
