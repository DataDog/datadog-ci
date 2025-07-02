import inquirer from 'inquirer'

import {CI_SITE_ENV_VAR, DATADOG_SITES} from '../../constants'
import {isValidDatadogSite} from '../../helpers/validation'

const checkboxPlusPrompt = require('inquirer-checkbox-plus-prompt')
inquirer.registerPrompt('checkbox-plus', checkboxPlusPrompt)

// Question definitions
const gcpProjectQuestion: inquirer.InputQuestion = {
  message: 'Enter GCP Project ID:',
  name: 'project',
  type: 'input',
  validate: (value: string) => {
    if (!value || value.trim().length === 0) {
      return 'Project ID is required.'
    }

    return true
  },
}

const gcpRegionQuestion = (defaultRegion?: string): inquirer.InputQuestion => ({
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

const serviceNameQuestion: inquirer.InputQuestion = {
  message: 'Enter Cloud Run service name:',
  name: 'serviceName',
  type: 'input',
  validate: (value: string) => {
    if (!value || value.trim().length === 0) {
      return 'Service name is required.'
    }

    return true
  },
}

const datadogSiteQuestion: inquirer.ListQuestion = {
  choices: DATADOG_SITES,
  message: 'Select a Datadog Site:',
  name: CI_SITE_ENV_VAR,
  type: 'list',
}

// Exported prompt functions
export const requestGCPProject = async (): Promise<string> => {
  try {
    const answer = await inquirer.prompt(gcpProjectQuestion)

    return answer.project
  } catch (e) {
    if (e instanceof Error) {
      throw new Error(`Couldn't get GCP project. ${e.message}`)
    }
    throw e
  }
}

export const requestGCPRegion = async (defaultRegion?: string): Promise<string> => {
  try {
    const answer = await inquirer.prompt(gcpRegionQuestion(defaultRegion))

    return answer.region
  } catch (e) {
    if (e instanceof Error) {
      throw new Error(`Couldn't get GCP region. ${e.message}`)
    }
    throw e
  }
}

export const requestServiceName = async (): Promise<string> => {
  try {
    const answer = await inquirer.prompt(serviceNameQuestion)

    return answer.serviceName
  } catch (e) {
    if (e instanceof Error) {
      throw new Error(`Couldn't get service name. ${e.message}`)
    }
    throw e
  }
}

export const requestSite = async (): Promise<void> => {
  try {
    const envSite = process.env[CI_SITE_ENV_VAR]
    let selectedDatadogSite = envSite
    if (!isValidDatadogSite(envSite)) {
      const datadogSiteAnswer = await inquirer.prompt(datadogSiteQuestion)
      selectedDatadogSite = datadogSiteAnswer[CI_SITE_ENV_VAR]
      process.env[CI_SITE_ENV_VAR] = selectedDatadogSite
    }
  } catch (e) {
    if (e instanceof Error) {
      throw new Error(`Couldn't set Datadog Environment Variables. ${e.message}`)
    }
    throw e
  }
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
