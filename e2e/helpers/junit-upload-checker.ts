import {client, v2} from '@datadog/datadog-api-client'

const CHECK_INTERVAL_SECONDS = 10
const MAX_NUM_ATTEMPTS = 10

interface CheckJunitUploadOptions {
  service: string
  commitSha: string
  testLevel: string
  extraFilter: string
}

const waitFor = (waitSeconds: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000))
}

export const checkJunitUpload = async (options: CheckJunitUploadOptions): Promise<void> => {
  const {service, commitSha, testLevel, extraFilter} = options

  const configuration = client.createConfiguration()
  const apiInstance = new v2.CIVisibilityTestsApi(configuration)

  const baseFilterQuery = `@test.service:${service} @git.commit.sha:${commitSha}`
  const finalFilterQuery = `${baseFilterQuery} test_level:${testLevel} ${extraFilter}`

  const params = {
    filterQuery: finalFilterQuery,
    filterFrom: new Date(new Date().getTime() + -300 * 1000), // Last 5 minutes
    filterTo: new Date(),
    pageLimit: 5,
  }

  let numAttempts = 0
  let data: unknown[] = []

  while (numAttempts++ < MAX_NUM_ATTEMPTS) {
    console.log(`Querying CI Visibility tests with ${finalFilterQuery}.`)

    try {
      const response = await apiInstance.listCIAppTestEvents(params)
      data = response.data || []
    } catch (error) {
      console.error(error)
      data = []
    }

    if (data.length > 0) {
      console.log(`Successful check: the API returned ${data.length} ${testLevel}s.`)

      return
    }

    const isLastAttempt = numAttempts === MAX_NUM_ATTEMPTS
    if (!isLastAttempt) {
      console.log(`Attempt number ${numAttempts} failed, retrying in ${CHECK_INTERVAL_SECONDS} seconds.`)
      await waitFor(CHECK_INTERVAL_SECONDS)
    }
  }

  throw new Error(`Failed check: the API did not return any ${testLevel}s for filter: ${finalFilterQuery}`)
}
