import fs from 'fs'

import type {SpanTags} from '../interfaces'

import upath from 'upath'

import {getCISpanTags} from '../ci'
import {
  CI_GIT_MERGE_COMMIT_SHA,
  CI_WORKSPACE_PATH,
  GIT_BRANCH,
  GIT_HEAD_SHA,
  GIT_REPOSITORY_URL,
  GIT_SHA,
  GIT_TAG,
} from '../tags'
import {getUserCISpanTags, getUserGitSpanTags} from '../user-provided-git'
import {normalizeGitSha} from '../utils'

import {getGitMetadata, getGitRoot} from './format-git-span-data'

const canonicalPath = (value: string) => {
  const resolved = upath.resolve(value)
  try {
    return upath.normalize(fs.realpathSync.native(resolved))
  } catch {
    // CI may describe a host workspace that is not mounted in the current container.
    return resolved
  }
}

const sameSha = (left?: string, right?: string) => !!left && !!right && normalizeGitSha(left) === normalizeGitSha(right)

// A readable checkout supplies Git identity as one source; CI still supplies workflow relationships.
export const getRepositoryTags = async (
  ciTags?: SpanTags,
  repositoryPath?: string,
  includeCiTags = true
): Promise<SpanTags> => {
  const provider: SpanTags = includeCiTags ? {...(ciTags ?? getCISpanTags()), ...getUserCISpanTags()} : {}
  const checkout = {...(await getGitMetadata(repositoryPath))}
  const overrides = getUserGitSpanTags()
  const selectedSha = overrides[GIT_SHA] || checkout[GIT_SHA] || provider[GIT_SHA]
  let selectedProvider = provider

  if (checkout[GIT_SHA]) {
    const workspace = provider[CI_WORKSPACE_PATH]
    const root = workspace ? await getGitRoot(repositoryPath) : undefined
    const matchingRoot = !!workspace && !!root && canonicalPath(workspace) === canonicalPath(root)
    const providerRevisions = [provider[GIT_SHA], provider[CI_GIT_MERGE_COMMIT_SHA], provider[GIT_HEAD_SHA]].filter(
      Boolean
    )
    const matchingRevision =
      providerRevisions.length === 0 || providerRevisions.some((sha) => sameSha(sha, selectedSha))
    const relatedCheckout = (!workspace || !root || matchingRoot) && matchingRevision
    selectedProvider = Object.fromEntries(
      Object.entries(provider).filter(([key]) => {
        const relationship = key.startsWith('git.commit.head.') || key.startsWith('git.pull_request.')

        return !key.startsWith('git.') || (relationship && relatedCheckout)
      })
    )

    if (
      matchingRoot &&
      !checkout[GIT_BRANCH] &&
      [provider[GIT_SHA], provider[CI_GIT_MERGE_COMMIT_SHA]].some((sha) => sameSha(sha, checkout[GIT_SHA]))
    ) {
      // Matched detached CI checkouts may use an internal mirror; retain their canonical CI identity.
      for (const key of [GIT_BRANCH, GIT_TAG, GIT_REPOSITORY_URL] as const) {
        if (provider[key]) {
          checkout[key] = provider[key]
        }
      }
    }
  }

  const tags = {...selectedProvider, ...checkout, ...overrides}
  if (overrides[GIT_SHA] && !sameSha(overrides[GIT_SHA], checkout[GIT_SHA] || provider[GIT_SHA])) {
    for (const key of Object.keys(tags) as (keyof SpanTags)[]) {
      const commitField = key.startsWith('git.commit.') && key !== GIT_SHA && !key.startsWith('git.commit.head.')
      if ((commitField || key === GIT_TAG) && !Object.prototype.hasOwnProperty.call(overrides, key)) {
        delete tags[key]
      }
    }
  }

  return tags
}
