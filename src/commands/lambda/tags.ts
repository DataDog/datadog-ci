import {Lambda} from 'aws-sdk'
import path from 'path'
import {TAG_VERSION_NAME} from './constants'
import { TagConfiguration } from './interfaces'
// tslint:disable-next-line
const {version} = require(path.join(__dirname, '../../../package.json'))

export const applyTagConfig = async (lambda: Lambda, config: TagConfiguration) => {
  const {tagResourceRequest} = config
  if (tagResourceRequest !== undefined) {
    await lambda.tagResource(tagResourceRequest).promise()
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

export const hasVersionTag = async (lambda: Lambda, functionARN: string): Promise<boolean> => {
  const args: Lambda.ListTagsRequest = {
    Resource: functionARN,
  }
  const result = await lambda.listTags(args).promise()
  const {Tags} = result

  return Tags !== undefined && Tags[TAG_VERSION_NAME] === `v${version}`
}
