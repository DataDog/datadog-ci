import fs from 'fs'

import upath from 'upath'

import {Metadata, SpanTag, SpanTags} from './interfaces'
import {
  CI_ENV_VARS,
  CI_JOB_NAME,
  CI_JOB_URL,
  CI_NODE_NAME,
  CI_NODE_LABELS,
  CI_PIPELINE_ID,
  CI_PIPELINE_NAME,
  CI_PIPELINE_NUMBER,
  CI_PIPELINE_URL,
  CI_PROVIDER_NAME,
  CI_STAGE_NAME,
  CI_WORKSPACE_PATH,
  GIT_BRANCH,
  GIT_COMMIT_AUTHOR_DATE,
  GIT_COMMIT_AUTHOR_EMAIL,
  GIT_COMMIT_AUTHOR_NAME,
  GIT_COMMIT_COMMITTER_DATE,
  GIT_COMMIT_COMMITTER_EMAIL,
  GIT_COMMIT_COMMITTER_NAME,
  GIT_COMMIT_MESSAGE,
  GIT_REPOSITORY_URL,
  GIT_SHA,
  GIT_TAG,
  GIT_HEAD_SHA,
  GIT_PULL_REQUEST_BASE_BRANCH,
  PR_NUMBER,
  GIT_PULL_REQUEST_BASE_BRANCH_HEAD_SHA,
  GIT_PULL_REQUEST_BASE_BRANCH_SHA,
  CI_JOB_ID,
} from './tags'
import {getUserCISpanTags, getUserGitSpanTags} from './user-provided-git'
import {
  normalizeRef,
  removeEmptyValues,
  removeUndefinedValues,
  filterSensitiveInfoFromRepository,
  getGitHubEventPayload,
} from './utils'
import { BaseContext } from "clipanion";
import chalk from "chalk";

export const CI_ENGINES = {
  APPVEYOR: 'appveyor',
  AWSCODEPIPELINE: 'awscodepipeline',
  AZURE: 'azurepipelines',
  BITBUCKET: 'bitbucket',
  BITRISE: 'bitrise',
  BUDDY: 'buddy',
  BUILDKITE: 'buildkite',
  CIRCLECI: 'circleci',
  CODEFRESH: 'codefresh',
  GITHUB: 'github',
  GITLAB: 'gitlab',
  JENKINS: 'jenkins',
  TRAVIS: 'travisci',
  TEAMCITY: 'teamcity',
}

export const envDDGithubJobName = 'DD_GITHUB_JOB_NAME'

// DD_GITHUB_JOB_NAME is an override that is required for adding custom tags and metrics
// to GHA jobs if the 'name' property is used. It's ok for it to be missing in case the name property is not used.
const envAllowedToBeMissing = [envDDGithubJobName]

export const githubWellKnownDiagnosticDirs = [
  '/home/runner/actions-runner/cached/_diag', // for SaaS
  '/home/runner/actions-runner/_diag', // for self-hosted
]

const githubJobDisplayNameRegex = /"jobDisplayName":\s*"([^"]+)"/

// Receives a string with the form 'John Doe <john.doe@gmail.com>'
// and returns { name: 'John Doe', email: 'john.doe@gmail.com' }
const parseEmailAndName = (emailAndName: string | undefined) => {
  if (!emailAndName) {
    return {name: '', email: ''}
  }
  let name = ''
  let email = ''
  const matchNameAndEmail = emailAndName.match(/(?:"?([^"]*)"?\s)?(?:<?(.+@[^>]+)>?)/)
  if (matchNameAndEmail) {
    name = matchNameAndEmail[1]
    email = matchNameAndEmail[2]
  }

  return {name, email}
}

const resolveTilde = (filePath: string | undefined) => {
  if (!filePath || typeof filePath !== 'string') {
    return ''
  }
  // '~/folder/path' or '~'
  if (filePath[0] === '~' && (filePath[1] === '/' || filePath.length === 1)) {
    return filePath.replace('~', process.env.HOME ?? '')
  }

  return filePath
}

export const getCISpanTags = (): SpanTags | undefined => {
  const env = process.env
  let tags: SpanTags = {}

  if (env.DRONE) {
    const {
      DRONE_BUILD_NUMBER,
      DRONE_BUILD_LINK,
      DRONE_STEP_NAME,
      DRONE_STAGE_NAME,
      DRONE_WORKSPACE,
      DRONE_GIT_HTTP_URL,
      DRONE_COMMIT_SHA,
      DRONE_BRANCH,
      DRONE_TAG,
      DRONE_COMMIT_AUTHOR_NAME,
      DRONE_COMMIT_AUTHOR_EMAIL,
      DRONE_COMMIT_MESSAGE,
      DRONE_PULL_REQUEST,
      DRONE_TARGET_BRANCH,
    } = env
    tags = {
      [CI_PROVIDER_NAME]: 'drone',
      [CI_PIPELINE_NUMBER]: DRONE_BUILD_NUMBER,
      [CI_PIPELINE_URL]: DRONE_BUILD_LINK,
      [CI_JOB_NAME]: DRONE_STEP_NAME,
      [CI_STAGE_NAME]: DRONE_STAGE_NAME,
      [CI_WORKSPACE_PATH]: DRONE_WORKSPACE,
      [GIT_REPOSITORY_URL]: DRONE_GIT_HTTP_URL,
      [GIT_SHA]: DRONE_COMMIT_SHA,
      [GIT_BRANCH]: DRONE_BRANCH,
      [GIT_TAG]: DRONE_TAG,
      [GIT_COMMIT_AUTHOR_NAME]: DRONE_COMMIT_AUTHOR_NAME,
      [GIT_COMMIT_AUTHOR_EMAIL]: DRONE_COMMIT_AUTHOR_EMAIL,
      [GIT_COMMIT_MESSAGE]: DRONE_COMMIT_MESSAGE,
    }

    if (DRONE_PULL_REQUEST) {
      tags[PR_NUMBER] = DRONE_PULL_REQUEST
      tags[GIT_PULL_REQUEST_BASE_BRANCH] = DRONE_TARGET_BRANCH
    }
  }

  if (env.CIRCLECI) {
    const {
      CIRCLE_BUILD_NUM,
      CIRCLE_WORKFLOW_ID,
      CIRCLE_PROJECT_REPONAME,
      CIRCLE_BUILD_URL,
      CIRCLE_WORKING_DIRECTORY,
      CIRCLE_BRANCH,
      CIRCLE_TAG,
      CIRCLE_SHA1,
      CIRCLE_REPOSITORY_URL,
      CIRCLE_JOB,
      CIRCLE_PR_NUMBER,
      CIRCLE_PULL_REQUEST,
    } = env

    const pipelineUrl = `https://app.circleci.com/pipelines/workflows/${CIRCLE_WORKFLOW_ID}`

    tags = {
      [CI_JOB_URL]: CIRCLE_BUILD_URL,
      [CI_JOB_ID]: CIRCLE_BUILD_NUM,
      [CI_PIPELINE_ID]: CIRCLE_WORKFLOW_ID,
      [CI_PIPELINE_NAME]: CIRCLE_PROJECT_REPONAME,
      [CI_PIPELINE_URL]: pipelineUrl,
      [CI_JOB_NAME]: CIRCLE_JOB,
      [CI_PROVIDER_NAME]: CI_ENGINES.CIRCLECI,
      [CI_WORKSPACE_PATH]: CIRCLE_WORKING_DIRECTORY,
      [GIT_SHA]: CIRCLE_SHA1,
      [GIT_REPOSITORY_URL]: CIRCLE_REPOSITORY_URL,
      [GIT_TAG]: CIRCLE_TAG,
      [GIT_BRANCH]: CIRCLE_BRANCH,
      [CI_ENV_VARS]: JSON.stringify({
        CIRCLE_WORKFLOW_ID,
        // Snapshots are generated automatically and are sort sensitive
        CIRCLE_BUILD_NUM,
      }),
    }

    if (CIRCLE_PR_NUMBER || CIRCLE_PULL_REQUEST) {
      tags[PR_NUMBER] = CIRCLE_PR_NUMBER || CIRCLE_PULL_REQUEST?.split('/').pop()
    }
  }

  if (env.TRAVIS) {
    const {
      TRAVIS_PULL_REQUEST_BRANCH,
      TRAVIS_BRANCH,
      TRAVIS_COMMIT,
      TRAVIS_REPO_SLUG,
      TRAVIS_TAG,
      TRAVIS_JOB_WEB_URL,
      TRAVIS_BUILD_ID,
      TRAVIS_BUILD_NUMBER,
      TRAVIS_BUILD_WEB_URL,
      TRAVIS_BUILD_DIR,
      TRAVIS_COMMIT_MESSAGE,
      TRAVIS_EVENT_TYPE,
      TRAVIS_PULL_REQUEST,
      TRAVIS_PULL_REQUEST_SHA,
    } = env
    tags = {
      [CI_JOB_URL]: TRAVIS_JOB_WEB_URL,
      [CI_PIPELINE_ID]: TRAVIS_BUILD_ID,
      [CI_PIPELINE_NAME]: TRAVIS_REPO_SLUG,
      [CI_PIPELINE_NUMBER]: TRAVIS_BUILD_NUMBER,
      [CI_PIPELINE_URL]: TRAVIS_BUILD_WEB_URL,
      [CI_PROVIDER_NAME]: CI_ENGINES.TRAVIS,
      [CI_WORKSPACE_PATH]: TRAVIS_BUILD_DIR,
      [GIT_SHA]: TRAVIS_COMMIT,
      [GIT_TAG]: TRAVIS_TAG,
      [GIT_BRANCH]: TRAVIS_PULL_REQUEST_BRANCH || TRAVIS_BRANCH,
      [GIT_REPOSITORY_URL]: `https://github.com/${TRAVIS_REPO_SLUG}.git`,
      [GIT_COMMIT_MESSAGE]: TRAVIS_COMMIT_MESSAGE,
    }

    if (TRAVIS_EVENT_TYPE === 'pull_request') {
      tags[PR_NUMBER] = TRAVIS_PULL_REQUEST
      tags[GIT_PULL_REQUEST_BASE_BRANCH] = normalizeRef(TRAVIS_BRANCH)
      tags[GIT_HEAD_SHA] = TRAVIS_PULL_REQUEST_SHA
    }
  }

  if (env.GITLAB_CI) {
    const {
      CI_PIPELINE_ID: GITLAB_CI_PIPELINE_ID,
      CI_PROJECT_PATH,
      CI_PIPELINE_IID,
      CI_PIPELINE_URL: GITLAB_CI_PIPELINE_URL,
      CI_PROJECT_DIR,
      CI_COMMIT_REF_NAME,
      CI_COMMIT_TAG,
      CI_COMMIT_SHA,
      CI_REPOSITORY_URL,
      CI_JOB_URL: GITLAB_CI_JOB_URL,
      CI_JOB_STAGE,
      CI_JOB_NAME: GITLAB_CI_JOB_NAME,
      CI_COMMIT_MESSAGE,
      CI_COMMIT_TIMESTAMP,
      CI_COMMIT_AUTHOR,
      CI_JOB_ID: GITLAB_CI_JOB_ID,
      CI_PROJECT_URL: GITLAB_CI_PROJECT_URL,
      CI_RUNNER_ID,
      CI_RUNNER_TAGS,
      CI_MERGE_REQUEST_IID,
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME,
      CI_MERGE_REQUEST_SOURCE_BRANCH_SHA,
      CI_MERGE_REQUEST_DIFF_BASE_SHA,
      CI_MERGE_REQUEST_TARGET_BRANCH_SHA,
    } = env

    const {name, email} = parseEmailAndName(CI_COMMIT_AUTHOR)

    tags = {
      [CI_JOB_NAME]: GITLAB_CI_JOB_NAME,
      [CI_JOB_URL]: GITLAB_CI_JOB_URL,
      [CI_JOB_ID]: GITLAB_CI_JOB_ID,
      [CI_PIPELINE_ID]: GITLAB_CI_PIPELINE_ID,
      [CI_PIPELINE_NAME]: CI_PROJECT_PATH,
      [CI_PIPELINE_NUMBER]: CI_PIPELINE_IID,
      [CI_PIPELINE_URL]: GITLAB_CI_PIPELINE_URL,
      [CI_PROVIDER_NAME]: CI_ENGINES.GITLAB,
      [CI_WORKSPACE_PATH]: CI_PROJECT_DIR,
      [CI_STAGE_NAME]: CI_JOB_STAGE,
      [GIT_BRANCH]: CI_COMMIT_REF_NAME,
      [GIT_SHA]: CI_COMMIT_SHA,
      [GIT_REPOSITORY_URL]: CI_REPOSITORY_URL,
      [GIT_TAG]: CI_COMMIT_TAG,
      [GIT_COMMIT_MESSAGE]: CI_COMMIT_MESSAGE,
      [GIT_COMMIT_AUTHOR_NAME]: name,
      [GIT_COMMIT_AUTHOR_EMAIL]: email,
      [GIT_COMMIT_AUTHOR_DATE]: CI_COMMIT_TIMESTAMP,
      [CI_ENV_VARS]: JSON.stringify({
        CI_PROJECT_URL: GITLAB_CI_PROJECT_URL,
        // Snapshots are generated automatically and are sort sensitive
        CI_PIPELINE_ID: GITLAB_CI_PIPELINE_ID,
        CI_JOB_ID: GITLAB_CI_JOB_ID,
      }),
      [CI_NODE_LABELS]: CI_RUNNER_TAGS,
      [CI_NODE_NAME]: CI_RUNNER_ID,
    }

    if (CI_MERGE_REQUEST_IID) {
      tags[PR_NUMBER] = CI_MERGE_REQUEST_IID
      tags[GIT_PULL_REQUEST_BASE_BRANCH] = CI_MERGE_REQUEST_TARGET_BRANCH_NAME
      tags[GIT_PULL_REQUEST_BASE_BRANCH_SHA] = CI_MERGE_REQUEST_DIFF_BASE_SHA
      tags[GIT_PULL_REQUEST_BASE_BRANCH_HEAD_SHA] = CI_MERGE_REQUEST_TARGET_BRANCH_SHA
      tags[GIT_HEAD_SHA] = CI_MERGE_REQUEST_SOURCE_BRANCH_SHA
    }
  }

  if (env.GITHUB_ACTIONS || env.GITHUB_ACTION) {
    const {
      GITHUB_RUN_ID,
      GITHUB_WORKFLOW,
      GITHUB_RUN_NUMBER,
      GITHUB_WORKSPACE,
      GITHUB_HEAD_REF,
      GITHUB_JOB,
      GITHUB_REF,
      GITHUB_SHA,
      GITHUB_REPOSITORY,
      GITHUB_SERVER_URL,
      GITHUB_RUN_ATTEMPT,
      DD_GITHUB_JOB_NAME,
      GITHUB_BASE_REF,
    } = env
    const repositoryUrl = `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}.git`
    let pipelineURL = `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`

    // Some older versions of enterprise might not have this yet.
    if (GITHUB_RUN_ATTEMPT) {
      pipelineURL += `/attempts/${GITHUB_RUN_ATTEMPT}`
    }

    tags = {
      [CI_JOB_NAME]: GITHUB_JOB,
      [CI_JOB_ID]: GITHUB_JOB,
      [CI_JOB_URL]: filterSensitiveInfoFromRepository(
        `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/commit/${GITHUB_SHA}/checks`
      ),
      [CI_PIPELINE_ID]: GITHUB_RUN_ID,
      [CI_PIPELINE_NAME]: GITHUB_WORKFLOW,
      [CI_PIPELINE_NUMBER]: GITHUB_RUN_NUMBER,
      [CI_PIPELINE_URL]: filterSensitiveInfoFromRepository(pipelineURL),
      [CI_PROVIDER_NAME]: CI_ENGINES.GITHUB,
      [CI_WORKSPACE_PATH]: GITHUB_WORKSPACE,
      [GIT_SHA]: GITHUB_SHA,
      [GIT_REPOSITORY_URL]: repositoryUrl,
      [GIT_BRANCH]: GITHUB_HEAD_REF || GITHUB_REF || '',
      [CI_ENV_VARS]: JSON.stringify({
        GITHUB_SERVER_URL: filterSensitiveInfoFromRepository(GITHUB_SERVER_URL),
        // Snapshots are generated automatically and are sort sensitive
        GITHUB_REPOSITORY,
        GITHUB_RUN_ID,
        GITHUB_RUN_ATTEMPT,
        DD_GITHUB_JOB_NAME,
      }),
    }

    if (GITHUB_BASE_REF) {
      // GITHUB_BASE_REF is defined if it's a pull_request or pull_request_target trigger
      tags[GIT_PULL_REQUEST_BASE_BRANCH] = GITHUB_BASE_REF
      try {
        const eventPayload = getGitHubEventPayload()
        tags[GIT_HEAD_SHA] = eventPayload?.pull_request?.head?.sha
        tags[GIT_PULL_REQUEST_BASE_BRANCH_HEAD_SHA] = eventPayload?.pull_request?.base?.sha
        tags[PR_NUMBER] = eventPayload?.pull_request?.number?.toString()
      } catch (e) {
        // ignore malformed event content
      }
    }
  }

  if (env.JENKINS_URL) {
    const {
      WORKSPACE,
      BUILD_TAG,
      JOB_NAME,
      BUILD_NUMBER,
      BUILD_URL,
      GIT_BRANCH: JENKINS_GIT_BRANCH,
      GIT_COMMIT,
      GIT_URL,
      GIT_URL_1,
      DD_CUSTOM_TRACE_ID,
      DD_CUSTOM_PARENT_ID,
      NODE_NAME,
      NODE_LABELS,
      CHANGE_ID,
      CHANGE_TARGET,
    } = env

    tags = {
      [CI_PIPELINE_ID]: BUILD_TAG,
      [CI_PIPELINE_NUMBER]: BUILD_NUMBER,
      [CI_PIPELINE_URL]: BUILD_URL,
      [CI_PROVIDER_NAME]: CI_ENGINES.JENKINS,
      [CI_WORKSPACE_PATH]: WORKSPACE,
      [GIT_SHA]: GIT_COMMIT,
      [GIT_REPOSITORY_URL]: GIT_URL || GIT_URL_1,
      [GIT_BRANCH]: JENKINS_GIT_BRANCH,
      [CI_NODE_NAME]: NODE_NAME,
      [CI_ENV_VARS]: JSON.stringify({
        DD_CUSTOM_TRACE_ID,
        DD_CUSTOM_PARENT_ID,
      }),
    }

    if (NODE_LABELS) {
      let nodeLabels
      try {
        nodeLabels = JSON.stringify(NODE_LABELS.split(' '))
        tags[CI_NODE_LABELS] = nodeLabels
      } catch (e) {
        // ignore errors
      }
    }

    let finalPipelineName = ''
    if (JOB_NAME) {
      // Job names can contain parameters, e.g. jobName/KEY1=VALUE1,KEY2=VALUE2/branchName
      const jobNameAndParams = JOB_NAME.split('/')
      if (jobNameAndParams.length > 1 && jobNameAndParams[1].includes('=')) {
        finalPipelineName = jobNameAndParams[0]
      } else {
        const normalizedBranch = normalizeRef(JENKINS_GIT_BRANCH)
        finalPipelineName = JOB_NAME.replace(`/${normalizedBranch}`, '')
      }
      tags[CI_PIPELINE_NAME] = finalPipelineName
    }

    if (CHANGE_ID) {
      tags[PR_NUMBER] = CHANGE_ID
      tags[GIT_PULL_REQUEST_BASE_BRANCH] = CHANGE_TARGET
    }
  }

  if (env.BUILDKITE) {
    const {
      BUILDKITE_AGENT_ID,
      BUILDKITE_BRANCH,
      BUILDKITE_COMMIT,
      BUILDKITE_REPO,
      BUILDKITE_TAG,
      BUILDKITE_BUILD_ID,
      BUILDKITE_PIPELINE_SLUG,
      BUILDKITE_BUILD_NUMBER,
      BUILDKITE_BUILD_URL,
      BUILDKITE_JOB_ID,
      BUILDKITE_BUILD_CHECKOUT_PATH,
      BUILDKITE_BUILD_AUTHOR,
      BUILDKITE_BUILD_AUTHOR_EMAIL,
      BUILDKITE_MESSAGE,
      BUILDKITE_PULL_REQUEST,
      BUILDKITE_PULL_REQUEST_BASE_BRANCH,
    } = env

    const extraTags = Object.keys(env)
      .filter((envVar) => envVar.startsWith('BUILDKITE_AGENT_META_DATA_'))
      .map((metadataKey) => {
        const key = metadataKey.replace('BUILDKITE_AGENT_META_DATA_', '').toLowerCase()

        return `${key}:${env[metadataKey]}`
      })

    tags = {
      [CI_NODE_NAME]: BUILDKITE_AGENT_ID,
      [CI_PROVIDER_NAME]: CI_ENGINES.BUILDKITE,
      [CI_PIPELINE_ID]: BUILDKITE_BUILD_ID,
      [CI_PIPELINE_NAME]: BUILDKITE_PIPELINE_SLUG,
      [CI_PIPELINE_NUMBER]: BUILDKITE_BUILD_NUMBER,
      [CI_PIPELINE_URL]: BUILDKITE_BUILD_URL,
      [CI_JOB_URL]: `${BUILDKITE_BUILD_URL}#${BUILDKITE_JOB_ID}`,
      [CI_JOB_ID]: BUILDKITE_JOB_ID,
      [GIT_SHA]: BUILDKITE_COMMIT,
      [CI_WORKSPACE_PATH]: BUILDKITE_BUILD_CHECKOUT_PATH,
      [GIT_REPOSITORY_URL]: BUILDKITE_REPO,
      [GIT_TAG]: BUILDKITE_TAG,
      [GIT_BRANCH]: BUILDKITE_BRANCH,
      [GIT_COMMIT_AUTHOR_NAME]: BUILDKITE_BUILD_AUTHOR,
      [GIT_COMMIT_AUTHOR_EMAIL]: BUILDKITE_BUILD_AUTHOR_EMAIL,
      [GIT_COMMIT_MESSAGE]: BUILDKITE_MESSAGE,
      [CI_ENV_VARS]: JSON.stringify({
        BUILDKITE_BUILD_ID,
        BUILDKITE_JOB_ID,
      }),
    }
    if (extraTags.length) {
      tags[CI_NODE_LABELS] = JSON.stringify(extraTags)
    }

    if (BUILDKITE_PULL_REQUEST && BUILDKITE_PULL_REQUEST !== 'false') {
      tags[PR_NUMBER] = BUILDKITE_PULL_REQUEST
      tags[GIT_PULL_REQUEST_BASE_BRANCH] = BUILDKITE_PULL_REQUEST_BASE_BRANCH
    }
  }

  if (env.BITRISE_BUILD_SLUG) {
    const {
      BITRISE_GIT_COMMIT,
      GIT_CLONE_COMMIT_HASH,
      BITRISEIO_GIT_BRANCH_DEST,
      BITRISE_GIT_BRANCH,
      BITRISE_BUILD_SLUG,
      BITRISE_TRIGGERED_WORKFLOW_ID,
      BITRISE_BUILD_NUMBER,
      BITRISE_BUILD_URL,
      BITRISE_SOURCE_DIR,
      GIT_REPOSITORY_URL: BITRISE_GIT_REPOSITORY_URL,
      BITRISE_GIT_TAG,
      BITRISE_GIT_MESSAGE,
      BITRISE_PULL_REQUEST,
    } = env

    tags = {
      [CI_PROVIDER_NAME]: CI_ENGINES.BITRISE,
      [CI_PIPELINE_ID]: BITRISE_BUILD_SLUG,
      [CI_PIPELINE_NAME]: BITRISE_TRIGGERED_WORKFLOW_ID,
      [CI_PIPELINE_NUMBER]: BITRISE_BUILD_NUMBER,
      [CI_PIPELINE_URL]: BITRISE_BUILD_URL,
      [GIT_SHA]: BITRISE_GIT_COMMIT || GIT_CLONE_COMMIT_HASH,
      [GIT_REPOSITORY_URL]: BITRISE_GIT_REPOSITORY_URL,
      [CI_WORKSPACE_PATH]: BITRISE_SOURCE_DIR,
      [GIT_TAG]: BITRISE_GIT_TAG,
      [GIT_BRANCH]: BITRISE_GIT_BRANCH,
      [GIT_COMMIT_MESSAGE]: BITRISE_GIT_MESSAGE,
    }

    if (BITRISE_PULL_REQUEST) {
      tags[PR_NUMBER] = BITRISE_PULL_REQUEST
      tags[GIT_PULL_REQUEST_BASE_BRANCH] = BITRISEIO_GIT_BRANCH_DEST
    }
  }

  if (env.BITBUCKET_COMMIT) {
    const {
      BITBUCKET_REPO_FULL_NAME,
      BITBUCKET_BUILD_NUMBER,
      BITBUCKET_BRANCH,
      BITBUCKET_COMMIT,
      BITBUCKET_GIT_SSH_ORIGIN,
      BITBUCKET_GIT_HTTP_ORIGIN,
      BITBUCKET_TAG,
      BITBUCKET_PIPELINE_UUID,
      BITBUCKET_PR_ID,
      BITBUCKET_PR_DESTINATION_BRANCH,
      BITBUCKET_CLONE_DIR,
    } = env

    const url = `https://bitbucket.org/${BITBUCKET_REPO_FULL_NAME}/addon/pipelines/home#!/results/${BITBUCKET_BUILD_NUMBER}`

    tags = {
      [CI_PROVIDER_NAME]: CI_ENGINES.BITBUCKET,
      [GIT_SHA]: BITBUCKET_COMMIT,
      [CI_PIPELINE_NUMBER]: BITBUCKET_BUILD_NUMBER,
      [CI_PIPELINE_NAME]: BITBUCKET_REPO_FULL_NAME,
      [CI_JOB_URL]: url,
      [CI_PIPELINE_URL]: url,
      [GIT_BRANCH]: BITBUCKET_BRANCH,
      [GIT_TAG]: BITBUCKET_TAG,
      [GIT_REPOSITORY_URL]: BITBUCKET_GIT_SSH_ORIGIN || BITBUCKET_GIT_HTTP_ORIGIN,
      [CI_WORKSPACE_PATH]: BITBUCKET_CLONE_DIR,
      [CI_PIPELINE_ID]: BITBUCKET_PIPELINE_UUID && BITBUCKET_PIPELINE_UUID.replace(/{|}/gm, ''),
    }

    if (BITBUCKET_PR_ID) {
      tags[PR_NUMBER] = BITBUCKET_PR_ID
      tags[GIT_PULL_REQUEST_BASE_BRANCH] = BITBUCKET_PR_DESTINATION_BRANCH
    }
  }

  if (env.CF_BUILD_ID) {
    const {
      CF_BUILD_ID,
      CF_PIPELINE_NAME,
      CF_BUILD_URL,
      CF_STEP_NAME,
      CF_BRANCH,
      CF_PULL_REQUEST_ID,
      CF_PULL_REQUEST_NUMBER,
      CF_PULL_REQUEST_TARGET,
    } = env

    tags = {
      [CI_PROVIDER_NAME]: CI_ENGINES.CODEFRESH,
      [CI_PIPELINE_ID]: CF_BUILD_ID,
      [CI_PIPELINE_URL]: CF_BUILD_URL,
      [CI_PIPELINE_NAME]: CF_PIPELINE_NAME,
      [CI_JOB_NAME]: CF_STEP_NAME,
      [GIT_BRANCH]: CF_BRANCH,
      [CI_ENV_VARS]: JSON.stringify({CF_BUILD_ID}),
    }

    const isTag = CF_BRANCH && CF_BRANCH.includes('tags/')
    const refKey = isTag ? GIT_TAG : GIT_BRANCH
    const ref = normalizeRef(CF_BRANCH)

    tags[refKey] = ref

    if (CF_PULL_REQUEST_NUMBER || CF_PULL_REQUEST_ID) {
      tags[PR_NUMBER] = CF_PULL_REQUEST_NUMBER || CF_PULL_REQUEST_ID
      tags[GIT_PULL_REQUEST_BASE_BRANCH] = CF_PULL_REQUEST_TARGET
    }
  }

  if (env.TEAMCITY_VERSION) {
    const {BUILD_URL, TEAMCITY_BUILDCONF_NAME, TEAMCITY_PULLREQUEST_NUMBER, TEAMCITY_PULLREQUEST_TARGET_BRANCH} = env

    tags = {
      [CI_PROVIDER_NAME]: CI_ENGINES.TEAMCITY,
      [CI_JOB_URL]: BUILD_URL,
      [CI_JOB_NAME]: TEAMCITY_BUILDCONF_NAME,
    }

    if (TEAMCITY_PULLREQUEST_NUMBER) {
      tags[PR_NUMBER] = TEAMCITY_PULLREQUEST_NUMBER
      tags[GIT_PULL_REQUEST_BASE_BRANCH] = TEAMCITY_PULLREQUEST_TARGET_BRANCH
    }
  }

  if (env.TF_BUILD) {
    const {
      BUILD_SOURCESDIRECTORY,
      BUILD_BUILDID,
      BUILD_DEFINITIONNAME,
      SYSTEM_TEAMFOUNDATIONSERVERURI,
      SYSTEM_TEAMPROJECTID,
      SYSTEM_JOBID,
      SYSTEM_TASKINSTANCEID,
      SYSTEM_PULLREQUEST_SOURCEBRANCH,
      BUILD_SOURCEBRANCH,
      BUILD_SOURCEBRANCHNAME,
      SYSTEM_PULLREQUEST_PULLREQUESTNUMBER,
      SYSTEM_PULLREQUEST_SOURCECOMMITID,
      SYSTEM_PULLREQUEST_SOURCEREPOSITORYURI,
      SYSTEM_PULLREQUEST_TARGETBRANCH,
      BUILD_REPOSITORY_URI,
      BUILD_SOURCEVERSION,
      BUILD_REQUESTEDFORID,
      BUILD_REQUESTEDFOREMAIL,
      BUILD_SOURCEVERSIONMESSAGE,
      SYSTEM_STAGEDISPLAYNAME,
      SYSTEM_JOBDISPLAYNAME,
    } = env

    tags = {
      [CI_PROVIDER_NAME]: CI_ENGINES.AZURE,
      [CI_PIPELINE_ID]: BUILD_BUILDID,
      [CI_PIPELINE_NAME]: BUILD_DEFINITIONNAME,
      [CI_PIPELINE_NUMBER]: BUILD_BUILDID,
      [GIT_SHA]: SYSTEM_PULLREQUEST_SOURCECOMMITID || BUILD_SOURCEVERSION,
      [CI_WORKSPACE_PATH]: BUILD_SOURCESDIRECTORY,
      [GIT_REPOSITORY_URL]: SYSTEM_PULLREQUEST_SOURCEREPOSITORYURI || BUILD_REPOSITORY_URI,
      [GIT_BRANCH]: SYSTEM_PULLREQUEST_SOURCEBRANCH || BUILD_SOURCEBRANCH || BUILD_SOURCEBRANCHNAME,
      [GIT_COMMIT_AUTHOR_NAME]: BUILD_REQUESTEDFORID,
      [GIT_COMMIT_AUTHOR_EMAIL]: BUILD_REQUESTEDFOREMAIL,
      [GIT_COMMIT_MESSAGE]: BUILD_SOURCEVERSIONMESSAGE,
      [CI_STAGE_NAME]: SYSTEM_STAGEDISPLAYNAME,
      [CI_JOB_NAME]: SYSTEM_JOBDISPLAYNAME,
      [CI_JOB_ID]: SYSTEM_JOBID,
      [CI_ENV_VARS]: JSON.stringify({
        SYSTEM_TEAMPROJECTID,
        BUILD_BUILDID,
        SYSTEM_JOBID,
      }),
    }

    if (SYSTEM_TEAMFOUNDATIONSERVERURI && SYSTEM_TEAMPROJECTID && BUILD_BUILDID) {
      const baseUrl = `${SYSTEM_TEAMFOUNDATIONSERVERURI}${SYSTEM_TEAMPROJECTID}/_build/results?buildId=${BUILD_BUILDID}`
      const pipelineUrl = baseUrl
      const jobUrl = `${baseUrl}&view=logs&j=${SYSTEM_JOBID}&t=${SYSTEM_TASKINSTANCEID}`

      tags = {
        ...tags,
        [CI_PIPELINE_URL]: pipelineUrl,
        [CI_JOB_URL]: jobUrl,
      }
    }

    if (SYSTEM_PULLREQUEST_PULLREQUESTNUMBER) {
      tags[PR_NUMBER] = SYSTEM_PULLREQUEST_PULLREQUESTNUMBER
      tags[GIT_PULL_REQUEST_BASE_BRANCH] = SYSTEM_PULLREQUEST_TARGETBRANCH?.replace('refs/heads/', '')
      tags[GIT_HEAD_SHA] = SYSTEM_PULLREQUEST_SOURCECOMMITID
    }
  }

  if (env.APPVEYOR) {
    const {
      APPVEYOR_REPO_NAME,
      APPVEYOR_REPO_PROVIDER,
      APPVEYOR_BUILD_FOLDER,
      APPVEYOR_BUILD_ID,
      APPVEYOR_BUILD_NUMBER,
      APPVEYOR_REPO_COMMIT,
      APPVEYOR_PULL_REQUEST_HEAD_COMMIT,
      APPVEYOR_PULL_REQUEST_HEAD_REPO_BRANCH,
      APPVEYOR_PULL_REQUEST_NUMBER,
      APPVEYOR_REPO_BRANCH,
      APPVEYOR_REPO_TAG_NAME,
      APPVEYOR_REPO_COMMIT_AUTHOR,
      APPVEYOR_REPO_COMMIT_AUTHOR_EMAIL,
      APPVEYOR_REPO_COMMIT_MESSAGE,
      APPVEYOR_REPO_COMMIT_MESSAGE_EXTENDED,
    } = env

    const pipelineUrl = `https://ci.appveyor.com/project/${APPVEYOR_REPO_NAME}/builds/${APPVEYOR_BUILD_ID}`

    tags = {
      [CI_PROVIDER_NAME]: CI_ENGINES.APPVEYOR,
      [CI_PIPELINE_URL]: pipelineUrl,
      [CI_PIPELINE_ID]: APPVEYOR_BUILD_ID,
      [CI_PIPELINE_NAME]: APPVEYOR_REPO_NAME,
      [CI_PIPELINE_NUMBER]: APPVEYOR_BUILD_NUMBER,
      [CI_JOB_URL]: pipelineUrl,
      [CI_WORKSPACE_PATH]: APPVEYOR_BUILD_FOLDER,
      [GIT_COMMIT_AUTHOR_NAME]: APPVEYOR_REPO_COMMIT_AUTHOR,
      [GIT_COMMIT_AUTHOR_EMAIL]: APPVEYOR_REPO_COMMIT_AUTHOR_EMAIL,
      [GIT_COMMIT_MESSAGE]: `${APPVEYOR_REPO_COMMIT_MESSAGE || ''}\n${APPVEYOR_REPO_COMMIT_MESSAGE_EXTENDED || ''}`,
    }

    if (APPVEYOR_REPO_PROVIDER === 'github') {
      tags = {
        ...tags,
        [GIT_REPOSITORY_URL]: `https://github.com/${APPVEYOR_REPO_NAME}.git`,
        [GIT_SHA]: APPVEYOR_REPO_COMMIT,
        [GIT_TAG]: APPVEYOR_REPO_TAG_NAME,
        [GIT_BRANCH]: APPVEYOR_PULL_REQUEST_HEAD_REPO_BRANCH || APPVEYOR_REPO_BRANCH,
      }
    }

    if (APPVEYOR_PULL_REQUEST_HEAD_REPO_BRANCH) {
      tags[PR_NUMBER] = APPVEYOR_PULL_REQUEST_NUMBER
      tags[GIT_PULL_REQUEST_BASE_BRANCH] = normalizeRef(APPVEYOR_REPO_BRANCH)
      tags[GIT_HEAD_SHA] = APPVEYOR_PULL_REQUEST_HEAD_COMMIT
    }
  }

  if (env.BUDDY) {
    const {
      BUDDY_PIPELINE_NAME,
      BUDDY_PIPELINE_ID,
      BUDDY_EXECUTION_ID,
      BUDDY_SCM_URL,
      BUDDY_EXECUTION_BRANCH,
      BUDDY_EXECUTION_TAG,
      BUDDY_EXECUTION_REVISION,
      BUDDY_EXECUTION_URL,
      BUDDY_EXECUTION_REVISION_MESSAGE,
      BUDDY_EXECUTION_REVISION_COMMITTER_NAME,
      BUDDY_EXECUTION_REVISION_COMMITTER_EMAIL,
      BUDDY_RUN_PR_NO,
      BUDDY_RUN_PR_BASE_BRANCH,
    } = env

    tags = {
      [CI_PROVIDER_NAME]: CI_ENGINES.BUDDY,
      [CI_PIPELINE_ID]: `${BUDDY_PIPELINE_ID || ''}/${BUDDY_EXECUTION_ID || ''}`,
      [CI_PIPELINE_NAME]: BUDDY_PIPELINE_NAME,
      [CI_PIPELINE_NUMBER]: `${BUDDY_EXECUTION_ID || ''}`, // gets parsed to int again later using parsePipelineNumber
      [CI_PIPELINE_URL]: BUDDY_EXECUTION_URL,
      [GIT_SHA]: BUDDY_EXECUTION_REVISION,
      [GIT_BRANCH]: BUDDY_EXECUTION_BRANCH,
      [GIT_TAG]: BUDDY_EXECUTION_TAG,
      [GIT_REPOSITORY_URL]: BUDDY_SCM_URL,
      [GIT_COMMIT_MESSAGE]: BUDDY_EXECUTION_REVISION_MESSAGE,
      [GIT_COMMIT_COMMITTER_EMAIL]: BUDDY_EXECUTION_REVISION_COMMITTER_EMAIL,
      [GIT_COMMIT_COMMITTER_NAME]: BUDDY_EXECUTION_REVISION_COMMITTER_NAME,
    }

    if (BUDDY_RUN_PR_NO) {
      tags[PR_NUMBER] = BUDDY_RUN_PR_NO
      tags[GIT_PULL_REQUEST_BASE_BRANCH] = BUDDY_RUN_PR_BASE_BRANCH
    }
  }

  if (env.CODEBUILD_INITIATOR?.startsWith('codepipeline')) {
    const {
      CODEBUILD_BUILD_ARN,
      DD_ACTION_EXECUTION_ID,
      DD_PIPELINE_EXECUTION_ID,
      CODEBUILD_SOURCE_VERSION,
      CODEBUILD_RESOLVED_SOURCE_VERSION,
      CODEBUILD_WEBHOOK_BASE_REF,
    } = env

    tags = {
      [CI_PROVIDER_NAME]: CI_ENGINES.AWSCODEPIPELINE,
      [CI_JOB_ID]: DD_ACTION_EXECUTION_ID,
      [CI_PIPELINE_ID]: DD_PIPELINE_EXECUTION_ID,
      [CI_ENV_VARS]: JSON.stringify({CODEBUILD_BUILD_ARN, DD_PIPELINE_EXECUTION_ID, DD_ACTION_EXECUTION_ID}),
    }

    const prMatch = (CODEBUILD_SOURCE_VERSION ?? '').match(/^pr\/(\d+)$/)
    if (prMatch) {
      tags[PR_NUMBER] = prMatch?.[1]
      tags[GIT_PULL_REQUEST_BASE_BRANCH] = CODEBUILD_WEBHOOK_BASE_REF
      tags[GIT_HEAD_SHA] = CODEBUILD_RESOLVED_SOURCE_VERSION
    }
  }

  if (tags[CI_WORKSPACE_PATH]) {
    tags[CI_WORKSPACE_PATH] = resolveTilde(tags[CI_WORKSPACE_PATH])
  }
  if (tags[GIT_REPOSITORY_URL]) {
    tags[GIT_REPOSITORY_URL] = filterSensitiveInfoFromRepository(tags[GIT_REPOSITORY_URL])
  }

  if (tags[GIT_TAG]) {
    tags[GIT_TAG] = normalizeRef(tags[GIT_TAG])
  }

  if (tags[GIT_BRANCH]) {
    // Here we handle the case where GIT_BRANCH actually contains a tag
    const branch = tags[GIT_BRANCH] || ''
    if (branch.startsWith('tags/') || branch.includes('/tags/')) {
      if (!tags[GIT_TAG]) {
        tags[GIT_TAG] = normalizeRef(branch)
      }
      tags[GIT_BRANCH] = ''
    } else {
      tags[GIT_BRANCH] = normalizeRef(branch)
    }
  }

  return removeEmptyValues(tags)
}

export const getCIMetadata = (tagSizeLimits?: {[key in keyof SpanTags]?: number}): Metadata | undefined => {
  const tags = {
    ...getCISpanTags(),
    ...getUserCISpanTags(),
    ...getUserGitSpanTags(),
  }

  if (!tags || !Object.keys(tags).length) {
    return
  }

  if (tagSizeLimits) {
    for (const key of Object.keys(tagSizeLimits)) {
      const tagToLimit = key as SpanTag
      const originalTag = tags[tagToLimit]
      if (!!originalTag) {
        tags[tagToLimit] = originalTag.substring(0, tagSizeLimits[tagToLimit])
      }
    }
  }

  const metadata: Metadata = {
    ci: removeUndefinedValues({
      job: removeUndefinedValues({
        id: tags[CI_JOB_ID],
        name: tags[CI_JOB_NAME],
        url: tags[CI_JOB_URL],
      }),
      pipeline: removeUndefinedValues({
        id: tags[CI_PIPELINE_ID],
        name: tags[CI_PIPELINE_NAME],
        number: parseNumber(tags[CI_PIPELINE_NUMBER]),
        url: tags[CI_PIPELINE_URL],
      }),
      provider: removeUndefinedValues({
        name: tags[CI_PROVIDER_NAME],
      }),
      stage: removeUndefinedValues({
        name: tags[CI_STAGE_NAME],
      }),
      workspace_path: tags[CI_WORKSPACE_PATH],
    }),

    git: removeUndefinedValues({
      branch: tags[GIT_BRANCH],
      commit: removeUndefinedValues({
        author: removeUndefinedValues({
          date: tags[GIT_COMMIT_AUTHOR_DATE],
          email: tags[GIT_COMMIT_AUTHOR_EMAIL],
          name: tags[GIT_COMMIT_AUTHOR_NAME],
        }),
        committer: removeUndefinedValues({
          date: tags[GIT_COMMIT_COMMITTER_DATE],
          email: tags[GIT_COMMIT_COMMITTER_EMAIL],
          name: tags[GIT_COMMIT_COMMITTER_NAME],
        }),
        message: tags[GIT_COMMIT_MESSAGE],
        sha: tags[GIT_SHA],
      }),
      repository_url: tags[GIT_REPOSITORY_URL],
      tag: tags[GIT_TAG],
    }),
  }

  return metadata
}

const parseNumber = (numberStr: string | undefined): number | undefined => {
  if (numberStr) {
    const number = parseInt(numberStr, 10)

    return isFinite(number) ? number : undefined
  }
}

export const getCIEnv = (): {ciEnv: Record<string, string>; provider: string} => {
  if (process.env.CIRCLECI) {
    return {
      ciEnv: filterEnv(['CIRCLE_WORKFLOW_ID', 'CIRCLE_BUILD_NUM']),
      provider: 'circleci',
    }
  }

  if (process.env.GITLAB_CI) {
    return {
      ciEnv: filterEnv(['CI_PROJECT_URL', 'CI_PIPELINE_ID', 'CI_JOB_ID']),
      provider: 'gitlab',
    }
  }

  if (process.env.GITHUB_ACTIONS || process.env.GITHUB_ACTION) {
    return {
      ciEnv: filterEnv([
        'GITHUB_SERVER_URL',
        'GITHUB_REPOSITORY',
        'GITHUB_RUN_ID',
        'GITHUB_RUN_ATTEMPT',
        'GITHUB_JOB',
        envDDGithubJobName,
      ]),
      provider: 'github',
    }
  }

  if (process.env.BUILDKITE) {
    return {
      ciEnv: filterEnv(['BUILDKITE_BUILD_ID', 'BUILDKITE_JOB_ID']),
      provider: 'buildkite',
    }
  }

  if (process.env.TEAMCITY_VERSION) {
    return {
      ciEnv: filterEnv(['DATADOG_BUILD_ID']),
      provider: 'teamcity',
    }
  }

  if (process.env.JENKINS_URL) {
    return {
      ciEnv: filterEnv(['DD_CUSTOM_PARENT_ID', 'DD_CUSTOM_TRACE_ID']),
      provider: 'jenkins',
    }
  }

  if (process.env.TF_BUILD) {
    return {
      ciEnv: filterEnv(['SYSTEM_TEAMPROJECTID', 'BUILD_BUILDID', 'SYSTEM_JOBID']),
      provider: 'azurepipelines',
    }
  }

  throw new Error(
    'Only providers [GitHub, GitLab, CircleCI, Buildkite, Jenkins, TeamCity, AzurePipelines] are supported'
  )
}

export const getCIProvider = (): string => {
  if (process.env.CIRCLECI) {
    return CI_ENGINES.CIRCLECI
  }

  if (process.env.GITLAB_CI) {
    return CI_ENGINES.GITLAB
  }

  if (process.env.GITHUB_ACTIONS || process.env.GITHUB_ACTION) {
    return CI_ENGINES.GITHUB
  }

  if (process.env.BUILDKITE) {
    return CI_ENGINES.BUILDKITE
  }

  if (process.env.BUDDY) {
    return CI_ENGINES.BUDDY
  }

  if (process.env.TEAMCITY_VERSION) {
    return CI_ENGINES.TEAMCITY
  }

  if (process.env.JENKINS_URL) {
    return CI_ENGINES.JENKINS
  }

  if (process.env.TF_BUILD) {
    return CI_ENGINES.AZURE
  }

  if (process.env.CF_BUILD_ID) {
    return CI_ENGINES.CODEFRESH
  }

  if (process.env.APPVEYOR) {
    return CI_ENGINES.APPVEYOR
  }

  if (process.env.BITBUCKET_COMMIT) {
    return CI_ENGINES.BITBUCKET
  }

  if (process.env.BITRISE_BUILD_SLUG) {
    return CI_ENGINES.BITRISE
  }

  if (process.env.CODEBUILD_INITIATOR?.startsWith('codepipeline')) {
    return CI_ENGINES.AWSCODEPIPELINE
  }

  return 'unknown'
}

const filterEnv = (values: string[]): Record<string, string> => {
  const ciEnvs: Record<string, string> = {}
  const requiredMissing: string[] = []

  values.forEach((envKey) => {
    const envValue = process.env[envKey]
    if (envValue) {
      ciEnvs[envKey] = envValue
    } else if (!envAllowedToBeMissing.includes(envKey)) {
      requiredMissing.push(envKey)
    }
  })

  if (requiredMissing.length > 0) {
    // Get the missing values for better error
    throw new Error(`Missing environment variables [${requiredMissing.toString()}]`)
  }

  return ciEnvs
}

export const isInteractive = ({stream = process.stdout}: {stream?: NodeJS.WriteStream} = {}) => {
  return Boolean(!('CI' in process.env) && process.env.TERM !== 'dumb' && stream && stream.isTTY)
}

export const shouldGetGithubJobDisplayName = (): boolean => {
  return getCIProvider() === CI_ENGINES.GITHUB && process.env.DD_GITHUB_JOB_NAME === undefined
}

/**
 * Extracts the job display name from the GitHub Actions diagnostic log files.
 *
 * @returns The job display name, or an empty string if not found.
 */
export const getGithubJobDisplayNameFromLogs = (context: BaseContext, ciEnv: Record<string, string>) => {
  if (!shouldGetGithubJobDisplayName()) {
    return
  }
  context.stdout.write('Determining github job name\n')

  let foundDiagDir = ''
  let workerLogFiles: string[] = []

  // 1. Iterate through well known directories to check for worker logs
  for (const currentDir of githubWellKnownDiagnosticDirs) {
    try {
      const files = fs.readdirSync(currentDir, {withFileTypes: true})
      const potentialLogs = files
        .filter((file) => file.isFile() && file.name.startsWith('Worker_') && file.name.endsWith('.log'))
        .map((file) => file.name)

      if (potentialLogs.length > 0) {
        foundDiagDir = currentDir
        workerLogFiles = potentialLogs
        break
      }
    } catch (error) {
      // If the directory does not exist, just try the next one
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        continue
      }
      let errMessage = 'error reading Github diagnostic log files'
      if (error instanceof Error) {
        errMessage += `: ${error.message}`
      } else {
        errMessage += `: ${String(error)}`
      }
      context.stderr.write(`${chalk.yellow.bold('[WARNING]')} ${errMessage}`)

      return
    }
  }
  if (workerLogFiles.length === 0 || foundDiagDir === '') {
    context.stderr.write(`${chalk.yellow.bold('[WARNING]')} could not find Github diagnostic log files`)
  }

  // 2. Get the job display name via regex
  for (const logFile of workerLogFiles) {
    const filePath = upath.join(foundDiagDir, logFile)
    const content = fs.readFileSync(filePath, 'utf-8')

    const match = content.match(githubJobDisplayNameRegex)

    if (match && match[1]) {
      // match[1] is the captured group with the display name
      ciEnv[envDDGithubJobName] = match[1]

      return
    }
  }

  context.stderr.write(
    `${chalk.yellow.bold('[WARNING]')} could not find "jobDisplayName" attribute in Github diagnostic logs`
  )
}
