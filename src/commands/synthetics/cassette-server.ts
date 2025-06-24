import {promises as fs} from 'fs'
import * as http from 'http'
import {URL} from 'url'

import axios from 'axios'
import {Command, Option} from 'clipanion'
import yaml from 'js-yaml'

interface CassetteEntry {
  request: {
    method: string
    url: string
    headers?: Record<string, string>
  }
  response: {
    statusCode: number
    statusMessage?: string
    headers?: Record<string, string>
    body?: any
  }
}

interface CassetteServerOptions {
  cassetteFile: string
  port?: number
  mockOnError?: boolean
}

export class CassetteServerCommand extends Command {
  public static paths = [['synthetics', 'cassette-server']]

  public static usage = Command.Usage({
    category: 'Cassette Server',
    description: 'Start a server to serve cassettes from a YAML file and redirect to real resources if not found.',
    details: `
      This command starts a server that serves cassette entries from a YAML file (multi-requests).
      If a cassette is not found for a request, it redirects to the real resource.
      For a given method+URL, responses are served sequentially (round-robin) if multiple entries exist.
    `,
    examples: [
      [
        'Start the server with default port (3000)',
        'datadog-ci synthetics cassette-server --cassette-file ./cassette1.yaml',
      ],
      [
        'Start the server with a custom port',
        'datadog-ci synthetics cassette-server --cassette-file ./cassette1.yaml --port 8080',
      ],
    ],
  })

  private cassetteFile = Option.String('--cassette-file', {
    description: 'YAML file containing the cassette entries',
    required: true,
  })

  private port = Option.String('--port', {
    description: 'Port to run the server on (default: 3000)',
  })

  private mockOnError = Option.Boolean('--mock-on-error', false, {
    description: 'If enabled, proxy requests by default, but serve a cassette if the proxied response is a 500 error.',
  })

  public async execute() {
    const options: CassetteServerOptions = {
      cassetteFile: this.cassetteFile,
      port: this.port ? parseInt(this.port, 10) : undefined,
      mockOnError: this.mockOnError,
    }

    try {
      await startCassetteServer(options)

      return 0
    } catch (error) {
      console.error('Error starting cassette server:', error)

      return 1
    }
  }
}

const startCassetteServer = async (options: CassetteServerOptions) => {
  const {cassetteFile, port = 3000, mockOnError = false} = options
  if (mockOnError) {
    console.log('Mocking on server errors only')
  }

  // Charger et parser le fichier YAML au démarrage
  let cassetteEntries: CassetteEntry[] = []
  try {
    const fileContent = await fs.readFile(cassetteFile, 'utf-8')
    cassetteEntries = yaml.loadAll(fileContent) as CassetteEntry[]
  } catch (e) {
    throw new Error(`Could not load cassette file: ${e}`)
  }

  // Build a map from (method, fullUrl) to array of entries, and an index for each
  const cassetteMap = new Map<string, CassetteEntry[]>()
  const cassetteIndexes = new Map<string, number>()
  console.log('Loading cassette entries\n')
  for (const entry of cassetteEntries) {
    const entryUrl = entry.request.url
    const host = entry.request.headers?.host || ''
    let key = ''
    if (/^https?:\/\//.test(entryUrl)) {
      // Absolute URL, use as is
      key = `${entry.request.method.toUpperCase()} ${entryUrl}`
    } else if (host) {
      // Relative URL, but host is present in headers
      key = `${entry.request.method.toUpperCase()} https://${host}${entryUrl}`
    } else {
      // Relative URL, no host, match only on method + path
      key = `${entry.request.method.toUpperCase()} ${entryUrl}`
    }
    if (!cassetteMap.has(key)) {
      console.log(key)
      cassetteMap.set(key, [])
      cassetteIndexes.set(key, 0)
    }
    cassetteMap.get(key)?.push(entry)
  }


  // Helper: Serve a cassette response for a given key
  const serveCassette = (key: string, res: http.ServerResponse): boolean => {
    const responses = cassetteMap.get(key)
    if (responses && responses.length > 0) {
      let idx = cassetteIndexes.get(key) || 0
      if (idx >= responses.length) {
        idx = 0
      }
      const response = responses[idx].response
      cassetteIndexes.set(key, idx + 1)
      const cassetteHeaders = response.headers ?? {}

      // // Prepare response body
      const responseBody = typeof response.body === 'string' ? response.body : JSON.stringify(response.body)

      // // Set Content-Length header
      cassetteHeaders['content-length'] = Buffer.byteLength(responseBody).toString()

      res.writeHead(response.statusCode, cassetteHeaders)
      res.end(typeof response.body === 'string' ? response.body : JSON.stringify(response.body))

      return true
    }

    return false
  }

  // Helper: Proxy a request, return true if handled, false if error and mockOnError fallback is needed
  const proxyRequest = async (req: http.IncomingMessage, res: http.ServerResponse, key: string): Promise<boolean> => {
    const targetUrl = req.url && req.url.startsWith('/') ? req.url.slice(1) : req.url || ''
    try {
      const parsedTarget = new URL(targetUrl)
      // Set Host header to target host
      const headers = {...req.headers, host: parsedTarget.host}
      const axiosResponse = await axios({
        method: req.method,
        url: targetUrl,
        headers,
        responseType: 'stream',
        data: ['GET', 'HEAD'].includes((req.method || '').toUpperCase()) ? undefined : req,
        validateStatus: () => true,
      })

      if (axiosResponse.status === 500) {
        console.log('The forwarded request returned a 500 error, will try to serve a cassette')

        return false
      } else {
        res.writeHead(axiosResponse.status, axiosResponse.headers as any)
        axiosResponse.data.pipe(res)

        return true
      }
    } catch (err) {
      res.writeHead(502)
      res.end('Proxy error: ' + String(err))

      return true // handled as error
    }
  }

  const server = http.createServer((req, res) => {
    if (!req.url || !req.method) {
      res.writeHead(400)
      res.end('Missing URL or method')

      return
    }
    const method = req.method.toUpperCase()
    const urlForKey = req.url.startsWith('/') ? req.url.slice(1) : req.url
    const key = `${method} ${urlForKey}`

    // If mockOnError: proxy first, fallback to cassette on 500
    if (mockOnError) {
      void (async () => {
        const handled = await proxyRequest(req, res, key)
        if (!handled) {
          // Proxy returned 500, try cassette
          if (!serveCassette(key, res)) {
            // No cassette, return 500
            res.writeHead(500)
            res.end('No cassette found for this request after proxy 500 error')
          }
        }
      })()

      return
    }

    // Default: serve cassette if present, else proxy
    if (serveCassette(key, res)) {
      return
    }
    void proxyRequest(req, res, key)
  })

  return new Promise<void>((resolve, reject) => {
    server.listen(port, () => {
      console.log(`\nCassette server (YAML, sequential) listening on port ${port}`)
      resolve()
    })
    server.on('error', (error) => {
      reject(error)
    })
  })
}
