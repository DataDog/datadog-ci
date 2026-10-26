import type {RepositoryData} from '../format-git-sourcemaps-data'

import type {MultipartPayload, MultipartStringValue} from '../../upload'

import {TrackedFilesMatcher} from '../format-git-sourcemaps-data'

// Several files share a file name, so the expected order exercises the grouping done by TrackedFilesMatcher.
const trackedFiles = ['src/a/main.c', 'lib/util.c', 'src/b/main.c', 'README.md', 'test/main.c']

export const makeFakeRepositoryData = (): RepositoryData => ({
  hash: 'fake-git-hash',
  remote: 'fake-git-remote',
  trackedFilesMatcher: new TrackedFilesMatcher(trackedFiles),
})

// Byte-for-byte expected value of the 'repository' multipart part for makeFakeRepositoryData().
export const expectedRepositoryValue =
  '{"data":[{"files":["src/a/main.c","src/b/main.c","test/main.c","lib/util.c","README.md"],' +
  '"hash":"fake-git-hash","repository_url":"fake-git-remote"}],"version":1}'

// Asserts that every uploaded payload carries the unchanged 'repository' part, and that the tracked files
// list was only serialized once for the whole command run.
export const expectRepositoryPartBuiltOnce = (
  payloads: MultipartPayload[],
  rawTrackedFilesListSpy: jest.SpyInstance
) => {
  expect(payloads.length).toBeGreaterThanOrEqual(2)
  for (const payload of payloads) {
    const repository = payload.content.get('repository') as MultipartStringValue
    expect(repository.type).toBe('string')
    expect(repository.options).toEqual({filename: 'repository', contentType: 'application/json'})
    expect(repository.value).toBe(expectedRepositoryValue)
  }
  expect(rawTrackedFilesListSpy).toHaveBeenCalledTimes(1)
}
