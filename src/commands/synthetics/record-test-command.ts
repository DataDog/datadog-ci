import {writeFile} from 'fs/promises'
import {createServer, Server} from 'http'

import {Command, Option} from 'clipanion'
import open from 'open'

import {getCommonAppBaseURL} from '../../helpers/app'
import * as validation from '../../helpers/validation'

export class RecordTestCommand extends Command {
  public static paths = [['synthetics', 'record-test']]

  public static usage = Command.Usage({
    category: 'Synthetics',
    description: 'Record a new Synthetic browser test on Datadog.',
  })

  private datadogSite = Option.String('--datadogSite', {description: 'The Datadog instance to which request is sent.'})
  private startUrl = Option.String('--startUrl', {description: 'The URL to start recording the test from.'})
  private subdomain = Option.String('--subdomain', {
    description:
      'The name of the custom subdomain set to access your Datadog application. If the URL used to access Datadog is `myorg.datadoghq.com`, the `subdomain` value needs to be set to `myorg`.',
  })
  private port = Option.String('--port', {
    description: 'The port to listen on for the recorded test.',
    validator: validation.isInteger(),
  })

  public async execute() {
    console.log('Recording a new Synthetic browser test on Datadog...\n')

    const {server, port} = await startServer(this.port)

    const params = new URLSearchParams({port: port.toString()})
    if (this.startUrl) {
      params.append('startUrl', formatUrl(this.startUrl))
    }

    const baseUrl = getCommonAppBaseURL(this.datadogSite ?? 'datadoghq.com', this.subdomain)
    const quickRecorderLink = `${baseUrl}synthetics/browser/quick-recorder?${params.toString()}`

    console.log('Opening the quick recorder in your browser:', quickRecorderLink)
    await open(quickRecorderLink)

    console.log(`Listening on port ${port} for the recorded test...\n`)
    const recordedTest = await waitForRecordedTest(server)

    const testFilePath = './recorded-test.json'
    console.log('Saving the recorded test to:', testFilePath)
    await writeFile(testFilePath, JSON.stringify(recordedTest, undefined, 2))
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

const waitForRecordedTest = async (server: Server) =>
  new Promise<Record<string, unknown>>((resolve) => {
    server.on('request', (req, res) => {
      const chunks: Uint8Array[] = []
      req.on('data', (chunk: Uint8Array) => {
        chunks.push(chunk)
      })
      req.on('end', () => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Headers', '*')
        res.writeHead(200)
        res.end()

        if (req.method === 'OPTIONS') {
          return
        }

        server.close()

        const body = Buffer.concat(chunks).toString()
        const payload = JSON.parse(body) as Record<string, unknown>
        delete payload._authentication_token

        resolve(payload)
      })
    })
  })
