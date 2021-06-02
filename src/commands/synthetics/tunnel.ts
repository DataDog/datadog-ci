import {timingSafeEqual} from 'crypto'
import {once} from 'events'
import {Socket} from 'net'
import {Duplex} from 'stream'

import chalk from 'chalk'
import {AuthContext, Connection as SSHConnection, Server as SSHServer, ServerChannel as SSHServerChannel} from 'ssh2'
import {ParsedKey, SSH2Stream, SSH2StreamConfig} from 'ssh2-streams'
import {Config as MultiplexerConfig, Server as Multiplexer} from 'yamux-js'

import {ProxyConfiguration} from '../../helpers/utils'

import {generateOpenSSHKeys, parseSSHKey} from './crypto'
import {MainReporter} from './interfaces'
import {WebSocket} from './websocket'

const MAX_CONCURRENT_FORWARDED_CONNECTIONS = 50

export interface TunnelInfo {
  host: string
  id: string
  privateKey: string
}

export class Tunnel {
  private connected = false
  private forwardSockets: Socket[] = []
  private log: (message: string) => void
  private logError: (message: string) => void
  private multiplexer?: Multiplexer
  private privateKey: string
  private publicKey: ParsedKey
  private sshStreamConfig: SSH2StreamConfig
  private ws: WebSocket

  constructor(private url: string, private testIDs: string[], proxy: ProxyConfiguration, reporter: MainReporter) {
    this.log = (message: string) => reporter.log(`[${chalk.bold.blue('Tunnel')}] ${message}\n`)
    this.logError = (message: string) => reporter.error(`[${chalk.bold.red('Tunnel')}] ${message}\n`)

    // Setup SSH
    const {privateKey: hostPrivateKey} = generateOpenSSHKeys()
    const parsedHostPrivateKey = parseSSHKey(hostPrivateKey)

    const {publicKey, privateKey} = generateOpenSSHKeys()
    this.publicKey = parseSSHKey(publicKey)
    this.privateKey = privateKey

    this.sshStreamConfig = {
      algorithms: {
        serverHostKey: [parsedHostPrivateKey.type],
      },
      hostKeys: {
        // Typings are wrong for host keys
        [parsedHostPrivateKey.type]: parsedHostPrivateKey as any,
      },
      server: true,
    }

    this.ws = new WebSocket(this.url, proxy)
  }

  /**
   * keepAlive will return a promise that tracks the state of the tunnel (and reject in case of error)
   */
  public async keepAlive() {
    if (!this.ws || !this.ws.keepAlive()) {
      throw new Error('No WebSocket connection')
    }

    return this.ws.keepAlive()
  }

  /**
   * start the tunnel:
   *   - get the pre-signed URL to connect to the tunnel service
   *   - Set up SSH
   *   - establish a WebSocket connection to the tunnel service
   */
  public async start() {
    this.log(`Opening tunnel for ${chalk.bold.dim(...this.testIDs)}…`)

    this.log('Generating encryption key, setting up SSH and opening WebSocket connection…')
    try {
      // Establish a WebSocket connection to the tunnel service
      await this.ws.connect()
      // @todo: in case of reconnect, add tunnel ID to WebSocket URL to re-use the same tunnel (in the tunnel service)

      const connectionInfo = await this.forwardWebSocketToSSH()

      return connectionInfo
    } catch (err) {
      this.logError('Tunnel setup failed, cleaning up and exiting…')
      await this.stop() // Clean up
      throw err
    }
  }

  /**
   * stop the tunnel
   */
  public async stop() {
    this.log('Shutting down tunnel…')

    if (this.multiplexer) {
      this.multiplexer.close()
    }

    await this.ws.close()
    this.forwardSockets.filter((s) => !!s).forEach((s) => s.destroy())
  }

  // Authenticate SSH with key authentication - username should be the test ID
  private authenticateSSHConnection(ctx: AuthContext) {
    const allowedUsers = this.testIDs.map((testId) => Buffer.from(testId))
    // Ensure username is allowed
    const user = Buffer.from(ctx.username)
    if (!allowedUsers.some((allowedUser) => user.length === allowedUser.length && timingSafeEqual(user, allowedUser))) {
      return ctx.reject()
    }

    // Only allow key authentication
    if (ctx.method !== 'publickey') {
      return ctx.reject()
    }

    const allowedPubSSHKey = Buffer.from(this.publicKey.getPublicSSH())
    if (
      ctx.key.algo !== this.publicKey.type ||
      ctx.key.data.length !== allowedPubSSHKey.length ||
      !timingSafeEqual(ctx.key.data, allowedPubSSHKey) ||
      (ctx.signature && this.publicKey.verify(ctx.blob, ctx.signature) !== true)
    ) {
      // Invalid key authentication
      return ctx.reject()
    }

    // A connection without a signature is only to check for public key validity
    if (!ctx.signature) {
      return ctx.accept()
    }

    // Username is allowed and key authentication was successful
    if (!this.connected) {
      // Limit to one log per tunnel
      this.connected = true
      this.log(`Successfully connected for test ${ctx.username}`)
    }
    ctx.accept()
  }

  private forwardProxiedPacketsFromSSH(client: SSHConnection) {
    client
      .on('session', (accept, reject) => {
        accept()
      })
      .on('tcpip', (accept, reject, info) => {
        // Forward packets
        // See https://github.com/mscdex/ssh2/issues/479#issuecomment-250416559
        let src: SSHServerChannel
        const dest = new Socket()
        this.forwardSockets.push(dest)
        dest.on('connect', () => {
          src = accept()
          if (!src) {
            return dest.end()
          }
          src.pipe(dest).pipe(src)

          src.on('close', () => {
            dest.destroy()
          })
        })
        dest.on('error', (error) => {
          if (!src) {
            if ((error as any).code === 'ENOTFOUND') {
              this.logError(`Unable to resolve host ${(error as any).hostname}`)
            } else {
              this.logError(`Forwarding channel error: "${error.message}"`)
            }
            reject()
          }
        })
        dest.on('close', () => {
          if (src) {
            src.close()
          } else {
            reject()
          }
        })
        dest.connect(info.destPort, info.destIP)
      })
      .on('request', (accept, reject, name, info) => {
        if (accept) {
          accept()
        }
      })
  }

  private async forwardWebSocketToSSH(): Promise<TunnelInfo> {
    const connectionInfo = await this.getConnectionInfo()
    this.log(`Websocket connection to tunnel ${connectionInfo.id} opened, proxy is ready!`)

    // Stop any existing multiplexing
    if (this.multiplexer) {
      this.multiplexer.close()
    }

    // Set up multiplexing
    const multiplexerConfig: MultiplexerConfig = {
      // Increase maximum backlog size to more easily handle
      // running multiple large browser tests in parallel.
      acceptBacklog: 2048,
      enableKeepAlive: false,
    }
    this.multiplexer = new Multiplexer((stream) => {
      stream.on('error', (err) => {
        this.logError('Error in multiplexing')
        throw err
      })

      this.processSSHStream(stream)
    }, multiplexerConfig)

    // Pipe WebSocket to multiplexing
    const duplex = this.ws.duplex()
    this.multiplexer.on('error', (error) => console.error('Multiplexer error:', error.message))
    duplex.on('error', (error) => console.error('Websocket error:', error.message))
    duplex.pipe(this.multiplexer).pipe(duplex)

    // @todo: re-set forwarding in case of reconnection

    return connectionInfo
  }

  private async getConnectionInfo() {
    const rawConnectionInfo = await this.ws.waitForFirstMessage()

    try {
      const connectionInfo: TunnelInfo = {
        privateKey: this.privateKey,
        ...JSON.parse(rawConnectionInfo.toString()),
      }

      return connectionInfo
    } catch {
      throw new Error(`Unexpected response from tunnel service: ${rawConnectionInfo.toString()}\n`)
    }
  }

  private async processSSHStream(stream: Duplex) {
    // Process SSH stream - see https://github.com/mscdex/ssh2/blob/v0.8.x/lib/server.js#L24
    const sshStream = new SSH2Stream(this.sshStreamConfig)
    const client: SSHConnection = new (SSHServer as any).IncomingClient(sshStream, stream) // Typing does not include IncomingClient
    stream.pipe(sshStream).pipe(stream)
    sshStream.setMaxListeners(MAX_CONCURRENT_FORWARDED_CONNECTIONS)
    stream.setMaxListeners(MAX_CONCURRENT_FORWARDED_CONNECTIONS)

    stream
      .once('close', () => {
        // Since joyent/node#993bb93e0a, we have to "read past EOF" in order to
        // get an `end` event on streams. thankfully adding this does not
        // negatively affect node versions pre-joyent/node#993bb93e0a.
        sshStream.read()
      })
      .on('error', (err) => {
        ;(sshStream as any).reset() // Typing does not include reset
        sshStream.emit('error', err)
      })

    const onClientPreHeaderError = (_: Error) => undefined // Silence pre-header errors
    client.on('error', onClientPreHeaderError)
    await once(sshStream, 'header')
    client.removeListener('error', onClientPreHeaderError)

    client
      .on('authentication', (ctx) => this.authenticateSSHConnection(ctx))
      .on('ready', () => this.forwardProxiedPacketsFromSSH(client))
      .on('end', () => {
        this.log('Proxy closed without error.')
      })
      .on('close', () => {
        this.log('Proxy closed without error.')
      })
      .on('error', (err) => {
        this.logError('SSH error in proxy!')
        throw err
      })
  }
}
