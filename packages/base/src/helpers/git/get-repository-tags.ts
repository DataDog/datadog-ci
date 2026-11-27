import fs from 'fs'

import type {SpanTags} from '../interfaces'

import upath from 'upath'

import {CI_ENGINES, getCISpanTags} from '../ci'
import {
  CI_GIT_MERGE_COMMIT_SHA,
  CI_PROVIDER_NAME,
  CI_WORKSPACE_PATH,
  GIT_BRANCH,
  GIT_HEAD_SHA,
  GIT_PULL_REQUEST_BASE_BRANCH_SHA,
  GIT_REPOSITORY_URL,
  GIT_SHA,
  GIT_TAG,
  PR_NUMBER,
} from '../tags'
import {getUserCISpanTags, getUserGitSpanTags} from '../user-provided-git'
import {filterSensitiveInfoFromRepository, isValidGitSha, normalizeGitSha} from '../utils'

import {getGitCommitParents, getGitMetadata, getGitRoot} from './format-git-span-data'

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

const sameRepository = (left?: string, right?: string) => {
  const normalize = (value?: string) => {
    const remote = filterSensitiveInfoFromRepository(value)
    const scp = remote && /^git@([^/:]+):([^/~].*)$/.exec(remote)
    if (scp && /[?#%]/.test(scp[2])) {
      return remote
    }
    try {
      const url = new URL(scp ? `https://${scp[1]}/${scp[2]}` : remote || '')
      const path = url.pathname.replace(/(?:\.git)?\/?$/, '')
      if (url.protocol === 'ssh:') {
        if ((url.port && url.port !== '22') || /^\/(~|%7e)/i.test(url.pathname) || url.search || url.hash) {
          return remote
        }

        return `https://${url.hostname.toLowerCase()}${path}`
      }
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        return `${url.origin}${path}`
      }
    } catch {
      // Local paths, SSH aliases and unsupported remote forms retain their literal identity.
    }

    return remote
  }

  return !!left && !!right && normalize(left) === normalize(right)
}

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
    const matchingRepository =
      matchingRoot || sameRepository(checkout[GIT_REPOSITORY_URL], provider[GIT_REPOSITORY_URL])
    const providerRevisions = [provider[GIT_SHA], provider[CI_GIT_MERGE_COMMIT_SHA], provider[GIT_HEAD_SHA]].filter(
      Boolean
    )
    let matchingRevision = providerRevisions.length === 0 || providerRevisions.some((sha) => sameSha(sha, selectedSha))
    let verifiedBitbucketMerge = false
    if (
      !matchingRevision &&
      matchingRepository &&
      provider[CI_PROVIDER_NAME] === CI_ENGINES.BITBUCKET &&
      /^\d+$/.test(provider[PR_NUMBER] || '') &&
      isValidGitSha(provider[GIT_SHA]) &&
      sameSha(selectedSha, checkout[GIT_SHA])
    ) {
      const parents = await getGitCommitParents(checkout[GIT_SHA], repositoryPath)
      const destination = provider[GIT_PULL_REQUEST_BASE_BRANCH_SHA]
      verifiedBitbucketMerge =
        parents?.length === 2 &&
        parents[0] !== parents[1] &&
        parents.some((parent) => sameSha(parent, provider[GIT_SHA])) &&
        (!destination ||
          (isValidGitSha(destination) &&
            !sameSha(destination, provider[GIT_SHA]) &&
            parents.some((parent) => sameSha(parent, destination))))
      matchingRevision = verifiedBitbucketMerge
    }
    const knownRepositoryMismatch =
      !!checkout[GIT_REPOSITORY_URL] && !!provider[GIT_REPOSITORY_URL] && !matchingRepository
    const relatedCheckout = !knownRepositoryMismatch && (!workspace || !root || matchingRepository) && matchingRevision
    selectedProvider = Object.fromEntries(
      Object.entries(provider).filter(([key]) => {
        const relationship =
          key === PR_NUMBER || key.startsWith('git.commit.head.') || key.startsWith('git.pull_request.')

        return relationship ? relatedCheckout : !key.startsWith('git.')
      })
    )

    if (
      matchingRepository &&
      !checkout[GIT_BRANCH] &&
      (verifiedBitbucketMerge || providerRevisions.some((sha) => sameSha(sha, checkout[GIT_SHA])))
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
