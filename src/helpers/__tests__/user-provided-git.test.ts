import {
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
} from '../tags'

import {getUserGitMetadata} from '../user-provided-git'

describe('getUserGitMetadata', () => {
  it('reads user defined git metadata successfully', () => {
    process.env.DD_GIT_COMMIT_SHA = 'DD_GIT_COMMIT_SHA'
    process.env.DD_GIT_REPOSITORY_URL = 'DD_GIT_REPOSITORY_URL'
    process.env.DD_GIT_BRANCH = 'DD_GIT_BRANCH'
    process.env.DD_GIT_TAG = 'DD_GIT_TAG'
    process.env.DD_GIT_COMMIT_MESSAGE = 'DD_GIT_COMMIT_MESSAGE'
    process.env.DD_GIT_COMMIT_AUTHOR_NAME = 'DD_GIT_COMMIT_AUTHOR_NAME'
    process.env.DD_GIT_COMMIT_AUTHOR_EMAIL = 'DD_GIT_COMMIT_AUTHOR_EMAIL'
    process.env.DD_GIT_COMMIT_AUTHOR_DATE = 'DD_GIT_COMMIT_AUTHOR_DATE'
    process.env.DD_GIT_COMMIT_COMMITTER_NAME = 'DD_GIT_COMMIT_COMMITTER_NAME'
    process.env.DD_GIT_COMMIT_COMMITTER_EMAIL = 'DD_GIT_COMMIT_COMMITTER_EMAIL'
    process.env.DD_GIT_COMMIT_COMMITTER_DATE = 'DD_GIT_COMMIT_COMMITTER_DATE'
    const result = getUserGitMetadata()
    expect(result).toEqual({
      [GIT_REPOSITORY_URL]: 'DD_GIT_REPOSITORY_URL',
      [GIT_BRANCH]: 'DD_GIT_BRANCH',
      [GIT_SHA]: 'DD_GIT_COMMIT_SHA',
      [GIT_TAG]: 'DD_GIT_TAG',
      [GIT_COMMIT_MESSAGE]: 'DD_GIT_COMMIT_MESSAGE',
      [GIT_COMMIT_COMMITTER_DATE]: 'DD_GIT_COMMIT_COMMITTER_NAME',
      [GIT_COMMIT_COMMITTER_EMAIL]: 'DD_GIT_COMMIT_COMMITTER_EMAIL',
      [GIT_COMMIT_COMMITTER_NAME]: 'DD_GIT_COMMIT_COMMITTER_DATE',
      [GIT_COMMIT_AUTHOR_DATE]: 'DD_GIT_COMMIT_AUTHOR_DATE',
      [GIT_COMMIT_AUTHOR_EMAIL]: 'DD_GIT_COMMIT_AUTHOR_EMAIL',
      [GIT_COMMIT_AUTHOR_NAME]: 'DD_GIT_COMMIT_AUTHOR_NAME',
    })
  })
  it('does not include empty values', () => {
    delete process.env.DD_GIT_COMMIT_SHA
    const result = getUserGitMetadata()
    expect(result).toEqual({
      [GIT_REPOSITORY_URL]: 'DD_GIT_REPOSITORY_URL',
      [GIT_BRANCH]: 'DD_GIT_BRANCH',
      [GIT_TAG]: 'DD_GIT_TAG',
      [GIT_COMMIT_MESSAGE]: 'DD_GIT_COMMIT_MESSAGE',
      [GIT_COMMIT_COMMITTER_DATE]: 'DD_GIT_COMMIT_COMMITTER_NAME',
      [GIT_COMMIT_COMMITTER_EMAIL]: 'DD_GIT_COMMIT_COMMITTER_EMAIL',
      [GIT_COMMIT_COMMITTER_NAME]: 'DD_GIT_COMMIT_COMMITTER_DATE',
      [GIT_COMMIT_AUTHOR_DATE]: 'DD_GIT_COMMIT_AUTHOR_DATE',
      [GIT_COMMIT_AUTHOR_EMAIL]: 'DD_GIT_COMMIT_AUTHOR_EMAIL',
      [GIT_COMMIT_AUTHOR_NAME]: 'DD_GIT_COMMIT_AUTHOR_NAME',
    })
  })
  it('returns an empty object is no user git is defined', () => {
    delete process.env.DD_GIT_REPOSITORY_URL
    delete process.env.DD_GIT_BRANCH
    delete process.env.DD_GIT_TAG
    delete process.env.DD_GIT_COMMIT_MESSAGE
    delete process.env.DD_GIT_COMMIT_AUTHOR_NAME
    delete process.env.DD_GIT_COMMIT_AUTHOR_EMAIL
    delete process.env.DD_GIT_COMMIT_AUTHOR_DATE
    delete process.env.DD_GIT_COMMIT_COMMITTER_NAME
    delete process.env.DD_GIT_COMMIT_COMMITTER_EMAIL
    delete process.env.DD_GIT_COMMIT_COMMITTER_DATE

    const result = getUserGitMetadata()
    expect(result).toEqual({})
  })
})
