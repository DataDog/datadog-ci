import {createServer, Server} from 'http'

import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import inquirer from 'inquirer'
import open from 'open'

import {getCommonAppBaseURL} from '../../helpers/app'
import * as validation from '../../helpers/validation'

import {EphemeralTriggerConfig, Test} from './interfaces'
import {DefaultReporter} from './reporters/default'
import {DEFAULT_COMMAND_CONFIG} from './run-tests-command'
import {getTestConfigs} from './test'
import {getReporter} from './utils/public'

// XXX: we may want to rename this command to `edit-test`, so that it can also be used for API tests
export class RecordTestCommand extends Command {
  public static paths = [['synthetics', 'record-test']]

  public static usage = Command.Usage({
    category: 'Synthetics',
    description: 'Record a new Synthetic browser test on Datadog.',
  })

  private datadogSite = Option.String('--datadogSite', {description: 'The Datadog instance to which request is sent.'})
  private startUrl = Option.String('--startUrl', {
    description: 'The URL to start recording the test from.',
    required: false,
  })
  private subdomain = Option.String('--subdomain', {
    description:
      'The name of the custom subdomain set to access your Datadog application. If the URL used to access Datadog is `myorg.datadoghq.com`, the `subdomain` value needs to be set to `myorg`.',
  })
  private port = Option.String('--port', {
    description: 'The port to listen on for the recorded test.',
    validator: validation.isInteger(),
  })
  private files = Option.Array('-f,--files', {
    description: `Glob pattern to detect Synthetic test files.`,
  })

  public async execute() {
    console.log('Recording a new Synthetic browser test on Datadog...\n')

    const datadogSite = this.datadogSite ?? 'datadoghq.com'

    const reporter = getReporter([new DefaultReporter(this)])
    const config = {...DEFAULT_COMMAND_CONFIG, files: this.files ?? []}

    const testConfigs = await getTestConfigs(config, reporter)

    // XXX: should we allow the user to edit non-ephemeral tests?
    const ephemeralTests = testConfigs.filter((t): t is EphemeralTriggerConfig => 'testDefinition' in t)

    const answers = await inquirer.prompt<inquirer.Answers>([
      {
        name: 'createOrEdit',
        message: 'Do you want to create a new test or edit an existing one?',
        type: 'list',
        choices: [
          {name: 'Create a new test', value: 'create'},
          {name: 'Edit an existing test', value: 'edit'},
        ],
      },
      {
        name: 'testToEdit',
        message: 'Select a test to edit:',
        type: 'list',
        when: (current) => current.createOrEdit === 'edit',
        choices: ephemeralTests.map((t) => ({
          name: t.testDefinition.name,
          value: t,
        })),
      },
    ])

    const shouldCreateNew = answers.createOrEdit === 'create'

    console.log()

    const {server, port} = await startServer(this.port)

    const params = new URLSearchParams({port: port.toString()})
    if (shouldCreateNew && this.startUrl) {
      params.append('startUrl', formatUrl(this.startUrl))
    }

    const baseUrl = getCommonAppBaseURL(datadogSite, this.subdomain)
    const quickRecorderLink = `${baseUrl}synthetics/browser/quick-recorder?${params.toString()}`

    console.log('Opening the quick recorder in your browser:', quickRecorderLink)
    await open(quickRecorderLink)

    if (!shouldCreateNew) {
      const selectedTriggerConfig = answers.testToEdit as EphemeralTriggerConfig
      console.log(`Serving the selected test on port ${port}...\n`)
      await serveSelectedTest(server, selectedTriggerConfig.testDefinition)

      if (selectedTriggerConfig.suite) {
        console.log(
          chalk.green(
            `You can now copy steps from the UI and save them in ${chalk.underline(selectedTriggerConfig.suite)}\n`
          )
        )
      }
    }
  }
}

const formatUrl = (url: string) => {
  return url.startsWith('http') ? url : `https://${url}`
}

const startServer = async (port?: number) =>
  new Promise<{server: Server; port: number}>((resolve, reject) => {
    const server = createServer()
    server.listen(port ?? 0)
    server.on('listening', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to start the server'))
      } else {
        resolve({server, port: address.port})
      }
    })
  })

const serveSelectedTest = async (server: Server, test: Test) =>
  new Promise<void>((resolve) => {
    server.on('request', (req, res) => {
      const chunks: Uint8Array[] = []
      req.on('data', (chunk: Uint8Array) => {
        chunks.push(chunk)
      })
      req.on('end', () => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Headers', '*')
        res.writeHead(200)

        if (req.method === 'OPTIONS') {
          return res.end()
        }

        res.write(JSON.stringify(test))
        res.end()

        server.close()
        resolve()
      })
    })
  })
