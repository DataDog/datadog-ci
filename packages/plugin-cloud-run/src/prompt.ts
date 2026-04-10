import type {ConfirmConfig, InputConfig, SelectConfig} from '@datadog/datadog-ci-base/helpers/inquirer'

import {DATADOG_SITES} from '@datadog/datadog-ci-base/constants'
import {loadPrompts} from '@datadog/datadog-ci-base/helpers/inquirer'

export const requestGCPProject = async (): Promise<string> => {
  const {input} = await loadPrompts()
  const question: InputConfig = {
    message: 'Enter GCP Project ID:',
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return 'Project ID is required.'
      }

      return true
    },
  }

  return input(question)
}

export const requestGCPRegion = async (defaultRegion?: string): Promise<string> => {
  const {input} = await loadPrompts()
  const question: InputConfig = {
    default: defaultRegion || 'us-central1',
    message: 'Enter GCP Region:',
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return 'Region is required.'
      }

      return true
    },
  }

  return input(question)
}

export const requestServiceName = async (): Promise<string> => {
  const {input} = await loadPrompts()
  const question: InputConfig = {
    message: 'Enter Cloud Run service name:',
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return 'Service name is required.'
      }

      return true
    },
  }

  return input(question)
}

export const requestSite = async (): Promise<string> => {
  const {select} = await loadPrompts()
  const question: SelectConfig = {
    choices: DATADOG_SITES,
    message: 'Select a Datadog Site:',
  }

  return select(question)
}

export const requestConfirmation = async (message: string, defaultValue = true) => {
  const {confirm} = await loadPrompts()
  const question: ConfirmConfig = {
    message,
    default: defaultValue,
  }

  return confirm(question)
}
