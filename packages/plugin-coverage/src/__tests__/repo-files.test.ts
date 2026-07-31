import {execFileSync} from 'child_process'
import fs from 'fs'
import os from 'os'

import upath from 'upath'

import {
  findFileInSearchRoots,
  gitBlobSha,
  statFileOnDisk,
  toRepositoryRelativePath,
  MAX_ATTACHED_FILE_SIZE,
} from '../repo-files'

const makeTempDir = () => upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'coverage-repo-files-')))

describe('gitBlobSha', () => {
  test('matches the well-known sha of an empty blob', () => {
    expect(gitBlobSha(Buffer.alloc(0))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
  })

  test('matches the well-known sha of "hello\\n"', () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(gitBlobSha(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
  })

  test('matches `git hash-object` for the coverage config content', () => {
    const dir = makeTempDir()
    const file = upath.join(dir, 'code-coverage.datadog.yml')
    const content = Buffer.from('schema-version: v1\nignore:\n  - "**/test*"\n')
    fs.writeFileSync(file, content)

    const expected = execFileSync('git', ['hash-object', file], {encoding: 'utf8'}).trim()

    expect(gitBlobSha(content)).toBe(expected)
  })

  test('is sensitive to content, including trailing whitespace', () => {
    expect(gitBlobSha(Buffer.from('a'))).not.toBe(gitBlobSha(Buffer.from('a\n')))
  })

  test('handles binary content and non-ascii bytes', () => {
    const content = Buffer.from([0x00, 0xff, 0xc3, 0xa9])

    expect(gitBlobSha(content)).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('statFileOnDisk', () => {
  test('returns the size and the normalized absolute path', () => {
    const dir = makeTempDir()
    const file = upath.join(dir, 'CODEOWNERS')
    fs.writeFileSync(file, '* @team\n')

    expect(statFileOnDisk(file)).toEqual({path: file, absolutePath: file, size: 8})
  })

  test('honours the reported path override', () => {
    const dir = makeTempDir()
    const file = upath.join(dir, 'CODEOWNERS')
    fs.writeFileSync(file, '* @team\n')

    expect(statFileOnDisk(file, '.github/CODEOWNERS')).toMatchObject({path: '.github/CODEOWNERS', absolutePath: file})
  })

  test('returns undefined for a missing file', () => {
    expect(statFileOnDisk(upath.join(makeTempDir(), 'nope.yml'))).toBeUndefined()
  })

  test('returns undefined for a directory', () => {
    expect(statFileOnDisk(makeTempDir())).toBeUndefined()
  })

  test('returns undefined when the file exists but is not readable', () => {
    const dir = makeTempDir()
    const file = upath.join(dir, 'code-coverage.datadog.yml')
    fs.writeFileSync(file, 'schema-version: v1\n')
    // chmod does not restrict root, so the permission failure is simulated instead
    const accessSync = jest.spyOn(fs, 'accessSync').mockImplementation(() => {
      throw Object.assign(new Error('EACCES: permission denied'), {code: 'EACCES'})
    })

    try {
      expect(statFileOnDisk(file)).toBeUndefined()
    } finally {
      accessSync.mockRestore()
    }
  })
})

describe('statFileOnDisk with symlinks', () => {
  test('returns undefined for a dangling symlink', () => {
    const dir = makeTempDir()
    const file = upath.join(dir, 'code-coverage.datadog.yml')
    fs.symlinkSync(upath.join(dir, 'missing-target.yml'), file)

    expect(statFileOnDisk(file)).toBeUndefined()
  })

  test('follows a symlink to a real file', () => {
    const dir = makeTempDir()
    const target = upath.join(dir, 'generated.yml')
    const file = upath.join(dir, 'code-coverage.datadog.yml')
    fs.writeFileSync(target, 'schema-version: v1\n')
    fs.symlinkSync(target, file)

    expect(statFileOnDisk(file)).toMatchObject({absolutePath: file, size: 19})
  })
})

describe('findFileInSearchRoots', () => {
  test('returns undefined when no candidate exists in any root', () => {
    expect(findFileInSearchRoots(['code-coverage.datadog.yml'], [makeTempDir()])).toBeUndefined()
  })

  test('reports the candidate path, not the absolute one', () => {
    const dir = makeTempDir()
    fs.mkdirSync(upath.join(dir, '.github'))
    fs.writeFileSync(upath.join(dir, '.github/CODEOWNERS'), '* @team\n')

    expect(findFileInSearchRoots(['.github/CODEOWNERS', 'CODEOWNERS'], [dir])).toMatchObject({
      path: '.github/CODEOWNERS',
      absolutePath: upath.join(dir, '.github/CODEOWNERS'),
    })
  })

  test('prefers earlier roots over earlier candidates', () => {
    const firstRoot = makeTempDir()
    const secondRoot = makeTempDir()
    fs.writeFileSync(upath.join(firstRoot, 'code-coverage.datadog.yaml'), 'schema-version: v1\n')
    fs.writeFileSync(upath.join(secondRoot, 'code-coverage.datadog.yml'), 'schema-version: v1\n')

    expect(
      findFileInSearchRoots(['code-coverage.datadog.yml', 'code-coverage.datadog.yaml'], [firstRoot, secondRoot])
    ).toMatchObject({path: 'code-coverage.datadog.yaml'})
  })

  test('prefers the first candidate within a single root', () => {
    const dir = makeTempDir()
    fs.writeFileSync(upath.join(dir, 'code-coverage.datadog.yml'), 'schema-version: v1\n')
    fs.writeFileSync(upath.join(dir, 'code-coverage.datadog.yaml'), 'schema-version: v1\n')

    expect(findFileInSearchRoots(['code-coverage.datadog.yml', 'code-coverage.datadog.yaml'], [dir])).toMatchObject({
      path: 'code-coverage.datadog.yml',
    })
  })

  test('skips a root where the candidate is a directory', () => {
    const firstRoot = makeTempDir()
    const secondRoot = makeTempDir()
    fs.mkdirSync(upath.join(firstRoot, 'code-coverage.datadog.yml'))
    fs.writeFileSync(upath.join(secondRoot, 'code-coverage.datadog.yml'), 'schema-version: v1\n')

    expect(findFileInSearchRoots(['code-coverage.datadog.yml'], [firstRoot, secondRoot])).toMatchObject({
      absolutePath: upath.join(secondRoot, 'code-coverage.datadog.yml'),
    })
  })
})

describe('toRepositoryRelativePath', () => {
  test('makes a path inside the repository relative to its root', () => {
    expect(toRepositoryRelativePath('/repo/build/generated/cc.yml', '/repo')).toBe('build/generated/cc.yml')
  })

  test('keeps the absolute path when it is outside the repository', () => {
    expect(toRepositoryRelativePath('/elsewhere/cc.yml', '/repo')).toBe('/elsewhere/cc.yml')
  })

  test('keeps the absolute path when there is no repository', () => {
    expect(toRepositoryRelativePath('/elsewhere/cc.yml', undefined)).toBe('/elsewhere/cc.yml')
  })

  test('keeps the absolute path when it is the repository root itself', () => {
    expect(toRepositoryRelativePath('/repo', '/repo')).toBe('/repo')
  })
})

describe('MAX_ATTACHED_FILE_SIZE', () => {
  test('is 1 MiB, matching the backend cap', () => {
    expect(MAX_ATTACHED_FILE_SIZE).toBe(1024 * 1024)
  })
})
