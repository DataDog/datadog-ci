import {Command, Option} from 'clipanion'
import * as http from 'http'
import {promises as fs} from 'fs'
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

  public async execute() {
    const options: CassetteServerOptions = {
      cassetteFile: this.cassetteFile,
      port: this.port ? parseInt(this.port, 10) : undefined,
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
  const {cassetteFile, port = 3000} = options

  // Charger et parser le fichier YAML au démarrage
  let cassetteEntries: CassetteEntry[] = []
  try {
    const fileContent = await fs.readFile(cassetteFile, 'utf-8')
    cassetteEntries = yaml.loadAll(fileContent) as CassetteEntry[]
  } catch (e) {
    throw new Error(`Could not load cassette file: ${e}`)
  }

  // Build a map from (method, url) to array of entries, and an index for each
  const cassetteMap = new Map<string, CassetteEntry[]>()
  const cassetteIndexes = new Map<string, number>()
  for (const entry of cassetteEntries) {
    const key = `${entry.request.method.toUpperCase()} ${entry.request.url}`
    if (!cassetteMap.has(key)) {
      cassetteMap.set(key, [])
      cassetteIndexes.set(key, 0)
    }
    cassetteMap.get(key)!.push(entry)
  }

  const server = http.createServer(async (req, res) => {
    if (!req.url || !req.method) {
      res.writeHead(400)
      res.end('Missing URL or method')
      return
    }

    const method = req.method.toUpperCase()
    const key = `${method} ${req.url}`;  // Use the full URL including query parameters
    const responses = cassetteMap.get(key)

    if (responses && responses.length > 0) {
      // Serve all responses as an array
      res.writeHead(200, {'Content-Type': 'application/json'})
      res.end(JSON.stringify(responses.map((r) => r.response)))
      return
    }

    // Si pas trouvé, rediriger vers la vraie ressource (ici, on met juste le path)
    res.writeHead(307, {Location: req.url})
    res.end()
  })

  return new Promise<void>((resolve, reject) => {
    server.listen(port, () => {
      console.log(`Cassette server (YAML, sequential) listening on port ${port}`)
      resolve()
    })
    server.on('error', (error) => {
      reject(error)
    })
  })
} 