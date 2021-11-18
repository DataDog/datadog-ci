import {Lambda} from 'aws-sdk'
import {TAG_VERSION_NAME} from './constants'
import {TagConfiguration} from './interfaces'
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

export const calculateTagUpdateRequest = async (lambda: Lambda, functionARN: string) => {
  const config: TagConfiguration = {}

  const versionTagPresent = await hasVersionTag(lambda, functionARN)

  if (!versionTagPresent) {
    config.tagResourceRequest = {
      Resource: functionARN,
      Tags: {
        [TAG_VERSION_NAME]: `v${version}`,
      },
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
