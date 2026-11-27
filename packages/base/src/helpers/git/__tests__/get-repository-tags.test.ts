import type {SpanTags} from '../../interfaces'
import {
  CI_GIT_MERGE_COMMIT_SHA,
  CI_PROVIDER_NAME,
  CI_WORKSPACE_PATH,
  GIT_BRANCH,
  GIT_COMMIT_MESSAGE,
  GIT_HEAD_SHA,
  GIT_PULL_REQUEST_BASE_BRANCH_SHA,
  GIT_REPOSITORY_URL,
  GIT_SHA,
  GIT_TAG,
  PR_NUMBER,
} from '../../tags'

import {getGitCommitParents, getGitMetadata, getGitRoot} from '../format-git-span-data'
import {getRepositoryTags} from '../get-repository-tags'

jest.mock('../format-git-span-data')

describe('repository metadata precedence', () => {
  const checkoutSha = 'b'.repeat(40)
  const mergeSha = 'a'.repeat(40)
  const headSha = 'c'.repeat(40)
  const provider: SpanTags = {
    [CI_PROVIDER_NAME]: 'github',
    [CI_WORKSPACE_PATH]: '/workspace',
    [CI_GIT_MERGE_COMMIT_SHA]: mergeSha,
    [GIT_SHA]: mergeSha,
    [GIT_HEAD_SHA]: headSha,
    [GIT_PULL_REQUEST_BASE_BRANCH_SHA]: 'd'.repeat(40),
    [GIT_REPOSITORY_URL]: 'https://github.com/example/workflow',
    [GIT_BRANCH]: 'workflow-branch',
    [GIT_TAG]: 'workflow-tag',
    [GIT_COMMIT_MESSAGE]: 'workflow commit',
    [PR_NUMBER]: '42',
  }

  beforeEach(() => {
    process.env = {}
    jest.mocked(getGitMetadata).mockResolvedValue({
      [GIT_SHA]: checkoutSha,
      [GIT_BRANCH]: 'checkout-branch',
      [GIT_REPOSITORY_URL]: 'https://github.com/example/checkout',
      [GIT_COMMIT_MESSAGE]: 'checkout commit',
    })
    jest.mocked(getGitRoot).mockResolvedValue('/workspace/nested')
    jest.mocked(getGitCommitParents).mockResolvedValue(undefined)
  })

  test('selects the checkout while retaining CI workflow context and the separate merge SHA', async () => {
    expect(await getRepositoryTags(provider)).toEqual({
      [CI_PROVIDER_NAME]: 'github',
      [CI_WORKSPACE_PATH]: '/workspace',
      [CI_GIT_MERGE_COMMIT_SHA]: mergeSha,
      [GIT_SHA]: checkoutSha,
      [GIT_BRANCH]: 'checkout-branch',
      [GIT_REPOSITORY_URL]: 'https://github.com/example/checkout',
      [GIT_COMMIT_MESSAGE]: 'checkout commit',
    })
  })

  test('uses CI Git metadata only when the checkout cannot be read', async () => {
    jest.mocked(getGitMetadata).mockResolvedValue({})
    expect(await getRepositoryTags(provider)).toEqual(provider)
  })

  test.each([undefined, '/unmounted/workspace'])(
    'drops another repository’s PR relationships when CI workspace matching is unavailable: %s',
    async (workspace) => {
      jest.mocked(getGitRoot).mockResolvedValue(undefined)
      const tags = await getRepositoryTags({
        ...provider,
        [CI_PROVIDER_NAME]: 'buddy',
        [CI_WORKSPACE_PATH]: workspace,
        [GIT_SHA]: checkoutSha,
      })

      expect(tags[GIT_SHA]).toBe(checkoutSha)
      expect(tags[GIT_REPOSITORY_URL]).toBe('https://github.com/example/checkout')
      expect(tags[CI_PROVIDER_NAME]).toBe('buddy')
      expect(tags[PR_NUMBER]).toBeUndefined()
      expect(tags[GIT_HEAD_SHA]).toBeUndefined()
      expect(tags[GIT_PULL_REQUEST_BASE_BRANCH_SHA]).toBeUndefined()
    }
  )

  test.each(['https://github.com/example/workflow.git', 'git@github.com:example/workflow.git'])(
    'keeps same-repository PR relationships without a workspace path: %s',
    async (remote) => {
      jest.mocked(getGitMetadata).mockResolvedValue({[GIT_SHA]: headSha, [GIT_REPOSITORY_URL]: remote})
      const tags = await getRepositoryTags({...provider, [CI_PROVIDER_NAME]: 'buddy', [CI_WORKSPACE_PATH]: undefined})

      expect(tags[GIT_SHA]).toBe(headSha)
      expect(tags[PR_NUMBER]).toBe('42')
      expect(tags[GIT_HEAD_SHA]).toBe(headSha)
      expect(tags[GIT_PULL_REQUEST_BASE_BRANCH_SHA]).toBe('d'.repeat(40))
    }
  )

  test('does not fill missing checkout fields with fields from a different CI revision', async () => {
    jest.mocked(getGitMetadata).mockResolvedValue({[GIT_SHA]: checkoutSha})
    const tags = await getRepositoryTags(provider)
    expect(tags[GIT_SHA]).toBe(checkoutSha)
    expect(tags[GIT_REPOSITORY_URL]).toBeUndefined()
    expect(tags[GIT_BRANCH]).toBeUndefined()
    expect(tags[GIT_TAG]).toBeUndefined()
    expect(tags[GIT_COMMIT_MESSAGE]).toBeUndefined()
    expect(tags[GIT_HEAD_SHA]).toBeUndefined()
    expect(tags[GIT_PULL_REQUEST_BASE_BRANCH_SHA]).toBeUndefined()
  })

  test('keeps explicit Git overrides authoritative and drops metadata belonging to another commit', async () => {
    process.env = {
      DD_GIT_COMMIT_SHA: headSha,
      DD_GIT_BRANCH: 'explicit',
      DD_GIT_REPOSITORY_URL: 'https://example.com/explicit',
    }
    const tags = await getRepositoryTags(provider)
    expect(tags).toMatchObject({
      [GIT_SHA]: headSha,
      [GIT_BRANCH]: 'explicit',
      [GIT_REPOSITORY_URL]: 'https://example.com/explicit',
    })
    expect(tags[GIT_COMMIT_MESSAGE]).toBeUndefined()
    expect(tags[GIT_TAG]).toBeUndefined()
  })

  test('retains explicitly supplied commit metadata for an overridden SHA', async () => {
    process.env = {DD_GIT_COMMIT_SHA: headSha, DD_GIT_COMMIT_MESSAGE: 'explicit commit'}
    expect(await getRepositoryTags(provider)).toMatchObject({
      [GIT_SHA]: headSha,
      [GIT_COMMIT_MESSAGE]: 'explicit commit',
    })
  })

  test.each([mergeSha, headSha])(
    'preserves canonical CI identity for a matched detached checkout: %s',
    async (ciSha) => {
      jest
        .mocked(getGitMetadata)
        .mockResolvedValue({[GIT_SHA]: mergeSha, [GIT_REPOSITORY_URL]: 'https://mirror.internal/repo'})
      jest.mocked(getGitRoot).mockResolvedValue('/workspace')
      expect(await getRepositoryTags({...provider, [GIT_SHA]: ciSha})).toMatchObject({
        [GIT_SHA]: mergeSha,
        [GIT_BRANCH]: 'workflow-branch',
        [GIT_REPOSITORY_URL]: 'https://github.com/example/workflow',
      })
    }
  )

  test('does not apply the detached exception to a different checkout root', async () => {
    jest
      .mocked(getGitMetadata)
      .mockResolvedValue({[GIT_SHA]: mergeSha, [GIT_REPOSITORY_URL]: 'https://example.com/nested'})
    const tags = await getRepositoryTags(provider)
    expect(tags[GIT_REPOSITORY_URL]).toBe('https://example.com/nested')
    expect(tags[GIT_BRANCH]).toBeUndefined()
    expect(tags[PR_NUMBER]).toBeUndefined()
  })

  test('preserves CI identity for a detached PR-head checkout', async () => {
    jest
      .mocked(getGitMetadata)
      .mockResolvedValue({[GIT_SHA]: headSha, [GIT_REPOSITORY_URL]: 'https://mirror.internal/repo'})
    jest.mocked(getGitRoot).mockResolvedValue('/workspace')
    expect(await getRepositoryTags(provider)).toMatchObject({
      [GIT_SHA]: headSha,
      [GIT_HEAD_SHA]: headSha,
      [GIT_BRANCH]: 'workflow-branch',
      [GIT_REPOSITORY_URL]: provider[GIT_REPOSITORY_URL],
      [PR_NUMBER]: '42',
    })
  })

  test.each([mergeSha, headSha])('preserves a detached checkout remounted in a container: %s', async (sha) => {
    jest.mocked(getGitMetadata).mockResolvedValue({
      [GIT_SHA]: sha,
      [GIT_REPOSITORY_URL]: `${provider[GIT_REPOSITORY_URL]}.git`,
    })
    jest.mocked(getGitRoot).mockResolvedValue('/container/repository')
    expect(await getRepositoryTags(provider)).toMatchObject({
      [GIT_SHA]: sha,
      [GIT_BRANCH]: 'workflow-branch',
      [GIT_REPOSITORY_URL]: provider[GIT_REPOSITORY_URL],
      [CI_WORKSPACE_PATH]: '/workspace',
      [GIT_HEAD_SHA]: headSha,
      [PR_NUMBER]: '42',
    })
  })

  test('requires a matching revision when a remounted repository URL matches', async () => {
    jest.mocked(getGitMetadata).mockResolvedValue({
      [GIT_SHA]: checkoutSha,
      [GIT_REPOSITORY_URL]: provider[GIT_REPOSITORY_URL],
    })
    const tags = await getRepositoryTags(provider)
    expect(tags[GIT_BRANCH]).toBeUndefined()
    expect(tags[GIT_HEAD_SHA]).toBeUndefined()
    expect(tags[PR_NUMBER]).toBeUndefined()
  })

  test.each([
    'git@github.com:example/workflow.git',
    'ssh://git@github.com/example/workflow.git',
    'ssh://git@github.com:22/example/workflow.git',
    'ssh://git@GITHUB.COM/example/workflow',
  ])('matches an equivalent SSH remote in a remounted checkout: %s', async (remote) => {
    jest.mocked(getGitMetadata).mockResolvedValue({[GIT_SHA]: headSha, [GIT_REPOSITORY_URL]: remote})
    expect(await getRepositoryTags(provider)).toMatchObject({
      [GIT_SHA]: headSha,
      [GIT_BRANCH]: 'workflow-branch',
      [GIT_HEAD_SHA]: headSha,
      [GIT_REPOSITORY_URL]: provider[GIT_REPOSITORY_URL],
      [GIT_PULL_REQUEST_BASE_BRANCH_SHA]: 'd'.repeat(40),
      [PR_NUMBER]: '42',
    })
  })

  test.each([
    ['ssh://git@github.com:2222/example/workflow.git', 'https://github.com/example/workflow'],
    ['git@github.com:~user/workflow.git', 'https://github.com/~user/workflow'],
    ['ssh://git@github.com/~user/workflow.git', 'https://github.com/~user/workflow'],
    ['git@github-alias:example/workflow.git', 'https://github.com/example/workflow'],
    ['git@github.com:example/Workflow.git', 'https://github.com/example/workflow'],
    ['git@github.com:example/workflow.git?ref=other', 'https://github.com/example/workflow'],
    ['ssh://git@github.com/example/workflow.git#other', 'https://github.com/example/workflow'],
    ['ssh://git@github.com/%7Euser/workflow.git', 'https://github.com/%7Euser/workflow'],
  ])('does not assume SSH aliases, ports or paths are equivalent: %s', async (remote, ciUrl) => {
    jest.mocked(getGitMetadata).mockResolvedValue({[GIT_SHA]: headSha, [GIT_REPOSITORY_URL]: remote})
    const tags = await getRepositoryTags({...provider, [GIT_REPOSITORY_URL]: ciUrl})
    expect(tags[GIT_REPOSITORY_URL]).toBe(remote)
    expect(tags[GIT_BRANCH]).toBeUndefined()
    expect(tags[PR_NUMBER]).toBeUndefined()
  })

  test.each([false, true])('retains verified Bitbucket merge PR context (remounted: %s)', async (remounted) => {
    jest
      .mocked(getGitMetadata)
      .mockResolvedValue({[GIT_SHA]: mergeSha, [GIT_REPOSITORY_URL]: provider[GIT_REPOSITORY_URL]})
    jest.mocked(getGitRoot).mockResolvedValue(remounted ? '/container/repository' : '/workspace')
    jest.mocked(getGitCommitParents).mockResolvedValue([headSha, 'd'.repeat(40)])
    expect(
      await getRepositoryTags({
        ...provider,
        [CI_PROVIDER_NAME]: 'bitbucket',
        [GIT_SHA]: headSha,
        [CI_GIT_MERGE_COMMIT_SHA]: undefined,
        [GIT_HEAD_SHA]: undefined,
      })
    ).toMatchObject({
      [GIT_SHA]: mergeSha,
      [GIT_BRANCH]: 'workflow-branch',
      [GIT_PULL_REQUEST_BASE_BRANCH_SHA]: 'd'.repeat(40),
      [PR_NUMBER]: '42',
    })
  })

  test.each([
    undefined,
    [headSha],
    ['e'.repeat(40), 'd'.repeat(40)],
    [headSha, 'e'.repeat(40)],
    [headSha, headSha],
    [headSha, 'd'.repeat(40), 'e'.repeat(40)],
  ])('rejects an unverified Bitbucket merge relationship: %j', async (parents) => {
    jest
      .mocked(getGitMetadata)
      .mockResolvedValue({[GIT_SHA]: mergeSha, [GIT_REPOSITORY_URL]: provider[GIT_REPOSITORY_URL]})
    jest.mocked(getGitCommitParents).mockResolvedValue(parents)
    const tags = await getRepositoryTags({
      ...provider,
      [CI_PROVIDER_NAME]: 'bitbucket',
      [GIT_SHA]: headSha,
      [CI_GIT_MERGE_COMMIT_SHA]: undefined,
      [GIT_HEAD_SHA]: undefined,
    })
    expect(tags[GIT_SHA]).toBe(mergeSha)
    expect(tags[GIT_BRANCH]).toBeUndefined()
    expect(tags[PR_NUMBER]).toBeUndefined()
    expect(tags[GIT_PULL_REQUEST_BASE_BRANCH_SHA]).toBeUndefined()
  })

  test('can verify a Bitbucket merge with only its source revision available', async () => {
    jest
      .mocked(getGitMetadata)
      .mockResolvedValue({[GIT_SHA]: mergeSha, [GIT_REPOSITORY_URL]: provider[GIT_REPOSITORY_URL]})
    jest.mocked(getGitCommitParents).mockResolvedValue(['d'.repeat(40), headSha])
    const tags = await getRepositoryTags({
      ...provider,
      [CI_PROVIDER_NAME]: 'bitbucket',
      [GIT_SHA]: headSha,
      [CI_GIT_MERGE_COMMIT_SHA]: undefined,
      [GIT_HEAD_SHA]: undefined,
      [GIT_PULL_REQUEST_BASE_BRANCH_SHA]: undefined,
    })
    expect(tags[GIT_SHA]).toBe(mergeSha)
    expect(tags[GIT_BRANCH]).toBe('workflow-branch')
    expect(tags[PR_NUMBER]).toBe('42')
    expect(getGitCommitParents).toHaveBeenCalledTimes(1)
    expect(getGitCommitParents).toHaveBeenCalledWith(mergeSha, undefined)
  })

  test.each(['other-provider', 'invalid-pr', 'unrelated-repository', 'explicit-revision', 'invalid-source'])(
    'does not inspect merge parents for an ineligible checkout: %s',
    async (reason) => {
      jest.mocked(getGitMetadata).mockResolvedValue({
        [GIT_SHA]: mergeSha,
        [GIT_REPOSITORY_URL]:
          reason === 'unrelated-repository' ? 'https://github.com/other/repository' : provider[GIT_REPOSITORY_URL],
      })
      jest.mocked(getGitCommitParents).mockResolvedValue([headSha, 'd'.repeat(40)])
      if (reason === 'explicit-revision') {
        process.env.DD_GIT_COMMIT_SHA = checkoutSha
      }
      const tags = await getRepositoryTags({
        ...provider,
        [CI_PROVIDER_NAME]: reason === 'other-provider' ? 'github' : 'bitbucket',
        [PR_NUMBER]: reason === 'invalid-pr' ? 'not-a-number' : '42',
        [GIT_SHA]: reason === 'invalid-source' ? 'HEAD' : headSha,
        [CI_GIT_MERGE_COMMIT_SHA]: undefined,
        [GIT_HEAD_SHA]: undefined,
      })
      expect(tags[PR_NUMBER]).toBeUndefined()
      expect(getGitCommitParents).not.toHaveBeenCalled()
    }
  )

  test.each([
    ['https://github.com/example/workflow-other', 'https://github.com/example/workflow'],
    ['https://example.git', 'https://example'],
    ['file:///tmp/workflow.git', 'file:///tmp/workflow'],
    ['/tmp/workflow.git', '/tmp/workflow'],
  ])('does not equate unrelated repository URLs: %s and %s', async (checkoutUrl, ciUrl) => {
    jest.mocked(getGitMetadata).mockResolvedValue({[GIT_SHA]: mergeSha, [GIT_REPOSITORY_URL]: checkoutUrl})
    const tags = await getRepositoryTags({...provider, [GIT_REPOSITORY_URL]: ciUrl})
    expect(tags[GIT_REPOSITORY_URL]).toBe(checkoutUrl)
    expect(tags[GIT_BRANCH]).toBeUndefined()
    expect(tags[PR_NUMBER]).toBeUndefined()
  })

  test('retains explicit PR-number overrides for an unrelated checkout', async () => {
    process.env.DD_PR_NUMBER = '99'
    expect((await getRepositoryTags(provider))[PR_NUMBER]).toBe('99')
  })

  test('does not apply the detached exception to a different checkout revision', async () => {
    jest
      .mocked(getGitMetadata)
      .mockResolvedValue({[GIT_SHA]: checkoutSha, [GIT_REPOSITORY_URL]: 'https://example.com/other'})
    jest.mocked(getGitRoot).mockResolvedValue('/workspace')
    const tags = await getRepositoryTags(provider)
    expect(tags[GIT_REPOSITORY_URL]).toBe('https://example.com/other')
    expect(tags[GIT_BRANCH]).toBeUndefined()
    expect(tags[GIT_HEAD_SHA]).toBeUndefined()
  })

  test('retains PR relationships when the source revision belongs to the selected checkout', async () => {
    jest.mocked(getGitMetadata).mockResolvedValue({[GIT_SHA]: headSha, [GIT_BRANCH]: 'source'})
    jest.mocked(getGitRoot).mockResolvedValue('/workspace')
    expect(await getRepositoryTags(provider)).toMatchObject({
      [GIT_HEAD_SHA]: headSha,
      [GIT_PULL_REQUEST_BASE_BRANCH_SHA]: 'd'.repeat(40),
    })
  })

  test.each([
    [headSha, undefined],
    [checkoutSha, checkoutSha],
  ])('checks partial CI revision metadata before retaining its PR head: %s', async (ciHead, expectedHead) => {
    jest.mocked(getGitRoot).mockResolvedValue('/workspace')
    const tags = await getRepositoryTags({
      ...provider,
      [GIT_SHA]: undefined,
      [CI_GIT_MERGE_COMMIT_SHA]: undefined,
      [GIT_HEAD_SHA]: ciHead,
    })
    expect(tags[GIT_HEAD_SHA]).toBe(expectedHead)
  })

  test('does not let a partial CI PR head bypass an explicit revision override', async () => {
    process.env = {DD_GIT_COMMIT_SHA: headSha}
    jest.mocked(getGitRoot).mockResolvedValue('/workspace')
    const tags = await getRepositoryTags({
      ...provider,
      [GIT_SHA]: undefined,
      [CI_GIT_MERGE_COMMIT_SHA]: undefined,
      [GIT_HEAD_SHA]: checkoutSha,
    })
    expect(tags[GIT_SHA]).toBe(headSha)
    expect(tags[GIT_HEAD_SHA]).toBeUndefined()
  })

  test('honors the no-CI option without suppressing explicit Git overrides', async () => {
    process.env = {DD_CI_PROVIDER_NAME: 'override-provider', DD_GIT_BRANCH: 'explicit'}
    const tags = await getRepositoryTags(provider, undefined, false)
    expect(tags[CI_PROVIDER_NAME]).toBeUndefined()
    expect(tags[CI_GIT_MERGE_COMMIT_SHA]).toBeUndefined()
    expect(tags[GIT_BRANCH]).toBe('explicit')
  })
})
