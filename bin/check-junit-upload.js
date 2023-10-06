'use strict'

const { client, v2 } = require("@datadog/datadog-api-client")

const configuration = client.createConfiguration();
const apiInstance = new v2.CIVisibilityTestsApi(configuration);

const params = {
  filterQuery: `test_level:test @test.service:${process.env.DD_SERVICE} @git.commit.sha:${process.env.GITHUB_SHA}`,
  filterFrom: new Date(new Date().getTime() + -300 * 1000), // Last 5 minutes
  filterTo: new Date(),
  pageLimit: 5,
};

const CHECK_INTERVAL_SECONDS = 10 // 10 seconds
const MAX_NUM_CHECKS = 10

function getTestData () {
  console.log(`Querying CI Visibility tests with ${params.filterQuery}`)
  return apiInstance
    .listCIAppTestEvents(params)
    .then(data => data.data)
    .catch(error => console.error(error))
}

function waitFor (waitSeconds) {
  return new Promise(resolve => setTimeout(() => resolve(), waitSeconds * 1000))
} 

async function checkJunitUpload () {
  let numChecks = 0
  let isSuccess = false
  while (numChecks++ < MAX_NUM_CHECKS && !isSuccess) {
    const data = await getTestData()
    if (data.length > 0) {
      isSuccess = true
      console.log(`The API returned ${data.length} tests.`)
    } else {
      console.log(`Attempt number ${numChecks} failed, retrying in ${CHECK_INTERVAL_SECONDS} seconds.`)
      await waitFor(CHECK_INTERVAL_SECONDS)
    }
  }
  process.exit(isSuccess ? 0 : 1)
}

checkJunitUpload()