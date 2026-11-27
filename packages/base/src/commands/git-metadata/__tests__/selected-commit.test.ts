import {execFileSync} from 'child_process'
import fs from 'fs'
import os from 'os'

import type FormData from 'form-data'

import {simpleGit} from 'simple-git'
import upath from 'upath'

import {getRepositoryTags} from '../../../helpers/git/get-repository-tags'
import type {RequestBuilder} from '../../../helpers/interfaces'
import {Logger, LogLevel} from '../../../helpers/logger'
import {GIT_SHA} from '../../../helpers/tags'

import {getCommitInfo} from '../git'
import {uploadToGitDB} from '../gitdb'

describe('selected commit upload', () => {
  const originalEnv = process.env
  const originalCwd = process.cwd()
  const repositoryURL = 'https://github.com/example/application'
  const logger = new Logger(() => {}, LogLevel.INFO)
  let directory: string

  const git = (args: string[], input?: string | Buffer) =>
    execFileSync('git', args, {cwd: directory, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']}).trim()

  const createHistory = (oldSelectedCommit = false) => {
    git(['init', '--initial-branch=main', '.'])
    git(['remote', 'add', 'origin', repositoryURL])
    const now = Math.floor(Date.now() / 1000)
    const commit = (branch: string, mark: number, date: number, parent?: number) => {
      const message = `commit ${mark}`
      const content = `file ${mark}`

      return [
        `commit refs/heads/${branch}`,
        `mark :${mark}`,
        `committer Test <test@example.com> ${date} +0000`,
        `data ${Buffer.byteLength(message)}`,
        message,
        ...(parent ? [`from :${parent}`] : []),
        `M 100644 inline file-${mark}.txt`,
        `data ${Buffer.byteLength(content)}`,
        content,
        '',
        '',
      ].join('\n')
    }
    // fast-import creates isolated test objects without invoking a machine's signing agent.
    git(
      ['fast-import', '--quiet'],
      commit('main', 1, now - 100) +
        commit('main', 2, now - 50, 1) +
        commit('selected', 3, oldSelectedCommit ? now - 90 * 86400 : now - 25, 1)
    )

    return {head: git(['rev-parse', 'HEAD']), selected: git(['rev-parse', 'selected'])}
  }

  const captureUpload = (knownAfterSearch = Infinity) => {
    const packfiles: Buffer[] = []
    const declarations: string[] = []
    const searched: string[][] = []
    const request = jest.fn<ReturnType<RequestBuilder>, Parameters<RequestBuilder>>(async (config) => {
      let known: {id: string; type: string}[] = []
      if (typeof config.data === 'string') {
        const candidates = JSON.parse(config.data).data as {id: string; type: string}[]
        searched.push(candidates.map((commit) => commit.id))
        if (searched.length >= knownAfterSearch) {
          known = candidates
        }
      } else {
        const form = config.data as FormData
        const body = form.getBuffer()
        const declaration = /name="pushedSha"[\s\S]*?\r\n\r\n([^\r\n]+)/.exec(body.toString('latin1'))!
        declarations.push(JSON.parse(declaration[1]).data.id)
        const start = body.indexOf('\r\n\r\n', body.indexOf('name="packfile"')) + 4
        const end = body.lastIndexOf(`\r\n--${form.getBoundary()}--`)
        packfiles.push(body.subarray(start, end))
      }

      return {config, data: {data: known}, headers: {}, status: 200, statusText: 'OK'}
    })

    return {request, packfiles, declarations, searched}
  }

  const unpack = (packfiles: Buffer[]) => {
    const target = upath.join(directory, 'uploaded.git')
    git(['init', '--bare', target])
    for (const packfile of packfiles) {
      git([`--git-dir=${target}`, 'index-pack', '--stdin'], packfile)
    }

    return target
  }

  beforeEach(() => {
    process.env = Object.fromEntries(
      Object.entries(originalEnv).filter(([key]) => !key.startsWith('GIT_') && !key.startsWith('DD_GIT_'))
    )
    directory = fs.mkdtempSync(upath.join(os.tmpdir(), 'selected-commit-'))
    process.chdir(directory)
  })

  afterEach(() => {
    jest.restoreAllMocks()
    process.chdir(originalCwd)
    process.env = originalEnv
    fs.rmSync(directory, {recursive: true, force: true})
  })

  test.each([false, true])('uploads the reported override, including an old selected tip: %s', async (old) => {
    const {head, selected} = createHistory(old)
    process.env.DD_GIT_COMMIT_SHA = selected.toUpperCase()
    const tags = await getRepositoryTags({}, directory, false)
    const info = await getCommitInfo(simpleGit(directory), repositoryURL)
    const {request, packfiles, declarations, searched} = captureUpload()

    await uploadToGitDB(logger, request, simpleGit(directory), false, repositoryURL)

    expect(tags[GIT_SHA]).toBe(selected)
    expect(info.hash).toBe(selected)
    expect(info.trackedFiles).toEqual(['file-1.txt', 'file-3.txt'])
    expect(searched[0]).toContain(selected)
    expect(searched.flat()).not.toContain(head)
    expect(declarations.length).toBeGreaterThan(0)
    expect(declarations.every((sha) => sha === tags[GIT_SHA])).toBe(true)
    const target = unpack(packfiles)
    expect(git([`--git-dir=${target}`, 'cat-file', '-t', selected])).toBe('commit')
    expect(() => git([`--git-dir=${target}`, 'cat-file', '-t', head])).toThrow()
  })

  test('uses an explicitly passed report revision instead of an ambient override', async () => {
    const {head, selected} = createHistory()
    process.env.DD_GIT_COMMIT_SHA = head
    const {request, packfiles, declarations} = captureUpload()

    await uploadToGitDB(logger, request, simpleGit(directory), false, repositoryURL, selected)

    expect(declarations).toEqual([selected])
    const target = unpack(packfiles)
    expect(git([`--git-dir=${target}`, 'cat-file', '-t', selected])).toBe('commit')
    expect(() => git([`--git-dir=${target}`, 'cat-file', '-t', head])).toThrow()
  })

  test('keeps HEAD upload behavior when no revision is selected', async () => {
    const {head, selected} = createHistory()
    const {request, packfiles, declarations} = captureUpload()

    await uploadToGitDB(logger, request, simpleGit(directory), false, repositoryURL)

    expect(declarations).toEqual([head])
    const target = unpack(packfiles)
    expect(git([`--git-dir=${target}`, 'cat-file', '-t', head])).toBe('commit')
    expect(() => git([`--git-dir=${target}`, 'cat-file', '-t', selected])).toThrow()
  })

  test.each(['a'.repeat(40), '--all'])(
    'does not upload HEAD for an unavailable or invalid selection: %s',
    async (sha) => {
      createHistory()
      process.env.DD_GIT_COMMIT_SHA = sha
      const {request} = captureUpload()

      await expect(uploadToGitDB(logger, request, simpleGit(directory), false, repositoryURL)).rejects.toThrow()
      expect(request).not.toHaveBeenCalled()
    }
  )

  test('rejects a selected object that is not a commit', async () => {
    createHistory()
    process.env.DD_GIT_COMMIT_SHA = git(['rev-parse', 'selected^{tree}'])
    const {request} = captureUpload()

    await expect(uploadToGitDB(logger, request, simpleGit(directory), false, repositoryURL)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  test.each([false, true])('keeps the selection after unshallowing; backend has all commits: %s', async (known) => {
    const {head, selected} = createHistory()
    process.env.DD_GIT_COMMIT_SHA = selected
    const client = simpleGit(directory)
    const fetch = jest.spyOn(client, 'fetch').mockResolvedValue({} as Awaited<ReturnType<typeof client.fetch>>)
    jest.spyOn(client, 'revparse').mockResolvedValue('true')
    const {request, declarations, searched} = captureUpload(known ? 2 : undefined)

    await uploadToGitDB(logger, request, client, false, repositoryURL)

    expect(fetch).toHaveBeenCalledWith([
      '--shallow-since="1 month ago"',
      '--update-shallow',
      '--filter=blob:none',
      '--recurse-submodules=no',
      'origin',
      selected,
    ])
    expect(searched).toHaveLength(2)
    expect(searched.every((commits) => commits.includes(selected) && !commits.includes(head))).toBe(true)
    expect(declarations).toEqual(known ? [] : [selected])
  })

  test('keeps the 1,000-commit search limit when adding a date-filtered selected tip', async () => {
    const {selected} = createHistory(true)
    process.env.DD_GIT_COMMIT_SHA = selected
    const client = simpleGit(directory)
    const history = await client.log()
    jest.spyOn(client, 'log').mockResolvedValue({
      ...history,
      all: Array.from({length: 1000}, (_, index) => ({
        ...history.all[0],
        hash: (index + 1).toString(16).padStart(40, '0'),
      })),
      total: 1000,
    })
    const request = jest.fn<ReturnType<RequestBuilder>, Parameters<RequestBuilder>>(async (config) => ({
      config,
      data: JSON.parse(config.data as string),
      headers: {},
      status: 200,
      statusText: 'OK',
    }))

    await uploadToGitDB(logger, request, client, false, repositoryURL)

    expect(request).toHaveBeenCalledTimes(1)
    const commits = JSON.parse(request.mock.calls[0][0].data as string).data
    expect(commits).toHaveLength(1000)
    expect(commits[0].id).toBe(selected)
  })
})
