import {readFile, writeFile} from 'fs/promises'
import path from 'path'

import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import inquirer from 'inquirer'

import {Suite, Test} from './interfaces'
import {DefaultReporter} from './reporters/default'
import {DEFAULT_COMMAND_CONFIG} from './run-tests-command'
import {getTestConfigs} from './test'
import {fetchApiOrBrowserTest, transformBackendToApiSpec} from './utils/internal'
import {getReporter, normalizePublicId} from './utils/public'

export class ImportCommand extends Command {
  public static paths = [['synthetics', 'import']]

  public static usage = Command.Usage({
    category: 'Synthetics',
    description: 'Import any existing Synthetic tests from Datadog.',
  })

  private datadogSite = Option.String('--datadogSite', {description: 'The Datadog instance to which request is sent.'})
  private subdomain = Option.String('--subdomain', {
    description:
      'The name of the custom subdomain set to access your Datadog application. If the URL used to access Datadog is `myorg.datadoghq.com`, the `subdomain` value needs to be set to `myorg`.',
  })
  private files = Option.Array('-f,--files', {
    description: `Glob pattern to detect Synthetic test files.`,
  })
  private publicIds = Option.Array('-p,--public-id', {description: 'Specify tests to import.'})

  public async execute() {
    console.log('Importing tests from Datadog...\n')

    const apiKey = process.env.DD_API_KEY ?? process.env.DATADOG_API_KEY ?? ''
    const appKey = process.env.DD_APP_KEY ?? process.env.DATADOG_APP_KEY ?? ''
    const datadogSite = this.datadogSite ?? process.env.DATADOG_SITE ?? 'datadoghq.com'
    const subdomain = this.subdomain ?? process.env.DATADOG_SUBDOMAIN ?? 'app'
    const files = this.files ?? []

    const reporter = getReporter([new DefaultReporter(this)])
    const config = {
      ...DEFAULT_COMMAND_CONFIG,
      apiKey,
      appKey,
      datadogSite,
      subdomain,
      files,
    }

    const publicIds = new Set(this.publicIds ?? [])
    const tests = await Promise.all([...publicIds].map((publicId) => fetchApiOrBrowserTest(publicId, config)))

    // Only supports `*.synthetics.json` files.
    const testConfigs = (await getTestConfigs(config, reporter)).filter(
      (t) => t.suite && path.extname(t.suite) === '.json'
    )

    const fileNameByPublicId = new Map<string, string>()
    testConfigs.forEach((t) => {
      if (!('id' in t)) {
        return
      }

      const publicId = extractPublicId(t.id)
      if (publicIds.has(publicId) && t.suite) {
        fileNameByPublicId.set(publicId, t.suite)
      }
    })

    const testConfigFileNames = [...new Set(testConfigs.flatMap((t) => (t.suite ? [t.suite] : [])))]

    const testsFoundInCodebase: Test[] = []
    const testsNotFoundInCodebase: Test[] = []
    const testByPublicId = new Map<string, Test>()
    tests.forEach((t) => {
      testByPublicId.set(t.public_id, t)
      if (fileNameByPublicId.has(t.public_id)) {
        testsFoundInCodebase.push(t)
      } else {
        testsNotFoundInCodebase.push(t)
      }
    })

    if (testsFoundInCodebase.length > 0) {
      const testListStr = testsFoundInCodebase
        .map((t) => `  - [${chalk.bold.dim(t.public_id)}] ${chalk.bold.cyan(t.name)}`)
        .join('\n')

      console.log(`The following tests were already listed in your codebase:\n${testListStr}\n`)

      for (const fileName of testConfigFileNames) {
        const currentContent = JSON.parse(await readFile(fileName, 'utf-8')) as Suite['content']
        const newContent = {
          tests: currentContent.tests.map((t) => {
            if (!('id' in t)) {
              return t
            }

            const publicId = extractPublicId(t.id)

            // Replace the `id` with a `testDefinition`
            return testByPublicId.has(publicId)
              ? {...t, id: undefined, testDefinition: cleanTest(testByPublicId.get(publicId) as Test)}
              : t
          }),
        }
        await writeFile(fileName, JSON.stringify(newContent, undefined, 2))
      }

      const fileListStr = testConfigFileNames.map((file) => `  - ${file}`).join('\n')

      console.log(
        `${chalk.green(
          `The corresponding references were replaced by test definitions in the following files:`
        )}\n${fileListStr}\n`
      )
    }

    if (testsNotFoundInCodebase.length > 0) {
      const testListStr = testsNotFoundInCodebase
        .map((t) => `- [${chalk.bold.dim(t.public_id)}] ${chalk.bold.cyan(t.name)}`)
        .join('\n')

      console.log(`The following tests were not already listed in your codebase:\n${testListStr}\n`)

      const answers = await inquirer.prompt<inquirer.Answers>([
        {
          name: 'createOrEdit',
          message: 'Would you like to save them in a new file or an existing test file?',
          type: 'list',
          choices: [
            {name: 'Create a new test file', value: 'create'},
            {name: 'Add to an existing test file', value: 'edit'},
          ],
        },
        {
          name: 'newFileName',
          message: 'Choose a name for the new test file:',
          type: 'input',
          when: (current) => current.createOrEdit === 'create',
          default: 'tests.synthetics.json',
        },
        {
          name: 'existingFileName',
          message: 'Choose the existing test file:',
          type: 'list',
          when: (current) => current.createOrEdit === 'edit',
          choices: testConfigFileNames.map((fileName) => ({value: fileName})),
        },
      ])

      if (answers.createOrEdit === 'create') {
        const newFileName = answers.newFileName as string
        const content = {tests: testsNotFoundInCodebase.map((t) => ({testDefinition: cleanTest(t)}))}
        await writeFile(newFileName, JSON.stringify(content, undefined, 2))
        console.log(`\n${chalk.green(`The tests were written in ${chalk.underline(newFileName)}`)}\n`)
      } else {
        const existingFileName = answers.existingFileName as string
        const currentContent = JSON.parse(await readFile(existingFileName, 'utf-8')) as Suite['content']
        const newContent = {
          tests: [...currentContent.tests, ...testsNotFoundInCodebase.map((t) => ({testDefinition: cleanTest(t)}))],
        }
        await writeFile(existingFileName, JSON.stringify(newContent, undefined, 2))
        console.log(`\n${chalk.green(`The tests were written in ${chalk.underline(existingFileName)}`)}\n`)
      }
    }
  }
}

const cleanTest = (test: Test) => {
  // Remove fields that do not make sense for an ephemeral test
  const testCopy = {...test} as Record<string, unknown>
  delete testCopy.public_id
  delete testCopy.created_at
  delete testCopy.status
  delete testCopy.modified_at
  delete testCopy.monitor_id
  delete testCopy.creator

  return transformBackendToApiSpec(testCopy)
}

const extractPublicId = (id: string) => {
  const publicId = normalizePublicId(id)
  if (!publicId) {
    throw new Error(`Invalid public ID: ${id}`)
  }

  return publicId
}
