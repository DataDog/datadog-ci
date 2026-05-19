import {DATADOG_SITES} from '@datadog/datadog-ci-base/constants'
import {confirm, input, select} from '@inquirer/prompts'

export const requestGCPProject = () =>
  input({
    message: 'Enter GCP Project ID:',
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Project ID is required.'
      }

      return true
    },
  })

export const requestGCPRegion = (defaultRegion?: string) =>
  input({
    default: defaultRegion || 'us-central1',
    message: 'Enter GCP Region:',
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Region is required.'
      }

      return true
    },
  })

export const requestServiceName = () =>
  input({
    message: 'Enter Cloud Run service name:',
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Service name is required.'
      }

      return true
    },
  })

export const requestSite = () => select<string>({choices: DATADOG_SITES, message: 'Select a Datadog Site:'})

export const requestConfirmation = (message: string, defaultValue = true) => confirm({default: defaultValue, message})
