import {Lambda} from 'aws-sdk'
import {ENV_TAG, SERVICE_TAG, TAG_VERSION_NAME, VERSION_TAG} from './constants'
import {InstrumentationSettings, TagConfiguration} from './interfaces'

// tslint:disable-next-line
const {version} = require('../../../package.json')

export const applyTagConfig = async (lambda: Lambda, config: TagConfiguration) => {
  const {tagResourceRequest, untagResourceRequest} = config
  if (tagResourceRequest !== undefined) {
    await lambda.tagResource(tagResourceRequest).promise()
  }
  if (untagResourceRequest !== undefined) {
    await lambda.untagResource(untagResourceRequest).promise()
  }
}

export const calculateTagUpdateRequest = async (lambda: Lambda, functionARN: string, userProvidedEnvironment: string | undefined, userProvidedService: string | undefined, userProvidedVersion: string | undefined) => {
  const config: TagConfiguration = {}

  const versionTagPresent = await hasVersionTag(lambda, functionARN)
  const userProvidedVersionTagForDeploymentTracking = userProvidedVersion
  const userProvidedServiceTag = userProvidedService
  const userProvidedEnvTag = userProvidedEnvironment


  if (!versionTagPresent || userProvidedVersionTagForDeploymentTracking !== undefined || userProvidedServiceTag !== undefined || userProvidedEnvTag !== undefined) {
    config.tagResourceRequest = {
      Resource: functionARN,
      Tags: {
      },
    }
    if (!versionTagPresent){

      config.tagResourceRequest.Tags[TAG_VERSION_NAME] = `v${version}`
    }
    if (userProvidedVersionTagForDeploymentTracking !== undefined){
      config.tagResourceRequest.Tags[VERSION_TAG] = userProvidedVersionTagForDeploymentTracking
    }
    if (userProvidedServiceTag !== undefined){
      config.tagResourceRequest.Tags[SERVICE_TAG] = userProvidedServiceTag
    }
    if (userProvidedEnvTag !== undefined){
      config.tagResourceRequest.Tags[ENV_TAG] = userProvidedEnvTag
    }

    return config
  }

  return
}

export const calculateTagRemoveRequest = async (lambda: Lambda, functionARN: string) => {
  const config: TagConfiguration = {}
  const versionTagPresent = await hasVersionTag(lambda, functionARN)
  if (versionTagPresent) {
    config.untagResourceRequest = {
      Resource: functionARN,
      TagKeys: [TAG_VERSION_NAME],
    }

    return config
  }

  return
}

export const hasVersionTag = async (lambda: Lambda, functionARN: string): Promise<boolean> => {
  const args: Lambda.ListTagsRequest = {
    Resource: functionARN,
  }
  const result = await lambda.listTags(args).promise()
  const {Tags} = result

  return Tags !== undefined && Tags[TAG_VERSION_NAME] === `v${version}`
}
