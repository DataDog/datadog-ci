import {spawn} from 'child_process'
import {once} from 'events'
import {promises as fs} from 'fs'
import http from 'http'

import upath from 'upath'

import {CommandContext} from '../../helpers/interfaces'

interface ReportedBuild {
  outputDirectory: string // the path to the assets directory, absolute or relative to the CWD
  publicPath: string // the public prefix
}

const REPORT_BUILD_PATHNAME = '/_datadog-ci_/build'

export const UnconfiguredBuildPluginError = new Error(`
We couldn't detect the Datadog Build plugins within your build. Did you add it?
If not, you can learn more about it here: https://github.com/DataDog/build-plugins#readme
`)

export const MalformedBuildError = new Error(
  `Invalid payload. Expected payload is {\"outputDirectory\": string, \"publicPath\": string}`
)

const MIME_TYPES = {
  default: 'application/octet-stream',
  html: 'text/html; charset=UTF-8',
  js: 'application/javascript',
  css: 'text/css',
  png: 'image/png',
  jpg: 'image/jpg',
  gif: 'image/gif',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
} as const
type Extension = keyof typeof MIME_TYPES
const isMIMEType = (mime: string): mime is Extension => {
  return Object.keys(MIME_TYPES).includes(mime as Extension)
}

type File =
  | {
      found: true
      ext: string
      content: string
    }
  | {
      found: false
    }

const routeVerbs = ['get', 'post', 'put', 'patch', 'delete'] as const
type RouteVerb = typeof routeVerbs[number]
const isRouteVerb = (verb: string): verb is RouteVerb => {
  return routeVerbs.includes(verb as RouteVerb)
}

export type Routes = Record<
  string,
  {
    [key in RouteVerb]?: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>
  }
>

export type RequestHandlerOptions = {
  builds: ReportedBuild[]
  root?: string
  routes?: Routes
}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath)

    return true
  } catch {
    return false
  }
}

const prepareFile = async (root = process.cwd(), builds: ReportedBuild[], requestUrl: string): Promise<File> => {
  const staticPath = upath.isAbsolute(root) ? root : upath.resolve(process.cwd(), root)

  for (const build of builds) {
    if (requestUrl.startsWith(build.publicPath)) {
      const url = new URL(requestUrl, 'http://127.0.0.1')
      const filePath = upath.join(
        upath.resolve(staticPath, build.outputDirectory), // absolute path to the assets directory
        upath.relative(build.publicPath, url.pathname), // relative path to the file
        url.pathname.endsWith('/') ? 'index.html' : '' // add index.html if the path ends with a slash
      )

      // Verify path is within the intended directory
      const directDescendant = filePath.startsWith(upath.resolve(staticPath, build.outputDirectory))
      // Check if the file exists (only if it's withing the intended directory)
      const found = directDescendant && (await fileExists(filePath))

      if (directDescendant && found) {
        return {
          found: true,
          ext: upath.extname(filePath).substring(1).toLowerCase(),
          content: await fs.readFile(filePath, {encoding: 'utf-8'}),
        }
      }
    }
  }

  return {
    found: false,
  }
}

const getRequestHandler = ({builds, root, routes}: RequestHandlerOptions) => async (
  req: http.IncomingMessage,
  res: http.ServerResponse
) => {
  try {
    // Handle routes.
    const route = routes?.[req.url || '/']
    if (route) {
      const verb = req.method?.toLowerCase() ?? ''
      if (isRouteVerb(verb)) {
        const handler = route[verb]
        if (handler) {
          await handler(req, res)

          return
        }
      }
    }

    // Fallback to files.
    const file = await prepareFile(root, builds, req.url || '/')
    if (file.found) {
      const mimeType = isMIMEType(file.ext) ? MIME_TYPES[file.ext] : MIME_TYPES.default
      res.writeHead(200, {'Content-Type': mimeType})
      res.end(file.content)

      return
    }

    res.writeHead(404)
    res.end()
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    res.writeHead(500, {'Content-Type': MIME_TYPES.html})
    res.end(`Internal Server Error: ${errorMessage}`)
  }
}

const getRequestBody = async (req: http.IncomingMessage): Promise<string> => {
  const chunks: string[] = []
  req.on('data', (chunk: string) => chunks.push(chunk))
  await once(req, 'end')

  return chunks.join('')
}

const getReportedBuild = (payload: string): ReportedBuild => {
  const reportedBuild = JSON.parse(payload)
  if (
    'outputDirectory' in reportedBuild &&
    typeof reportedBuild.outputDirectory === 'string' &&
    'publicPath' in reportedBuild &&
    typeof reportedBuild.publicPath === 'string'
  ) {
    return reportedBuild
  }
  throw MalformedBuildError
}

const spawnDevServer = async (): Promise<{builds: ReportedBuild[]; server: http.Server; url: string}> => {
  const builds: ReportedBuild[] = []
  const requestHandler = getRequestHandler({
    builds,
    root: process.cwd(),
    routes: {
      [REPORT_BUILD_PATHNAME]: {
        post: async (req, res) => {
          const body = await getRequestBody(req)
          const reportedBuild = getReportedBuild(body)
          builds.push(reportedBuild)

          res.end()
        },
      },
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const server = http.createServer(requestHandler)
  server.listen()

  await once(server, 'listening')

  return {builds, server, url: getBuildReportUrl(server)}
}

export const buildAssets = async (
  buildCommand: string,
  context: CommandContext
): Promise<{
  builds: ReportedBuild[]
  devServerUrl: string
  stop: () => Promise<void>
}> => {
  const {builds, server, url} = await spawnDevServer()

  // Spawn the build command process with the BUILD_PLUGINS_S8S_PORT environment variable.
  const buildCommandProcess = spawn(buildCommand, [], {
    env: {
      DATADOG_SYNTHETICS_REPORT_BUILD_URL: url,
      ...process.env,
    },
    shell: process.env.SHELL ?? process.env.ComSpec ?? true,
    stdio: ['inherit', 'pipe', 'pipe'],
  })

  buildCommandProcess.stdout?.pipe(context.stdout)
  buildCommandProcess.stderr?.pipe(context.stderr)

  // Wait for the build command to finish
  await once(buildCommandProcess, 'close')

  if (builds.length === 0) {
    await stopDevServer(server)
    throw UnconfiguredBuildPluginError
  }

  // Once the build server is ready, return its URL with the advertised public prefix to run the tests against it.
  return {
    builds,
    devServerUrl: url,
    stop: async () => stopDevServer(server),
  }
}

const getBuildReportUrl = (server: http.Server): string => {
  // net.Server can be listening on a named pipe, in which case the address is a string
  // or not listening yet, in which case the address is null, which we cast to the 'undefined' string
  // to meet the same condition as if it was a named pipe, and throw.
  const serverAddress = server.address() ?? 'undefined'
  if (typeof serverAddress === 'string') {
    throw new Error('Server address is not valid')
  }

  const url = new URL(
    serverAddress.family === 'IPv6'
      ? `http://[${serverAddress.address}]:${serverAddress.port}`
      : `http://${serverAddress.address}:${serverAddress.port}`
  )

  url.pathname = REPORT_BUILD_PATHNAME

  return url.href
}

const stopDevServer = async (server: http.Server) => {
  if (server.listening) {
    const serverClosed = once(server, 'close')
    server.close()
    await serverClosed
  }
}
